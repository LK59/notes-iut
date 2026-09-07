import type { PremiereConnexionResponse, ReleveResponse } from "./types";
import { cacheGet, cacheSet, clearCache, clearServiceWorkerCaches } from "./offlineCache";
import { PremiereConnexionSchema, ReleveResponseSchema } from "./schemas";

/** Erreur HTTP "normale" (réponse reçue du serveur) — distincte d'une vraie panne réseau. */
export class HttpError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  constructor(status: number, message: string, code = "HTTP_ERROR", retryable = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Vraie panne réseau (hors-ligne, timeout, coupure) par opposition à une réponse reçue du
 * serveur. Une requête qui échoue faute de réseau ne prouve rien sur l'état de la session :
 * la traiter comme un « non authentifié » renvoyait l'utilisateur sur l'écran de connexion
 * au moindre réveil en 4G faible, alors que tout le cache hors-ligne était disponible.
 */
export function isNetworkFailure(err: unknown): boolean {
  return !(err instanceof HttpError);
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

// /api/login et /api/refresh renvoient un job_id immédiatement (voir pollAuthJob plus bas) :
// le vrai login CAS tourne en fond côté serveur, donc chaque requête HTTP (POST initial et
// polls de statut) reste courte et le timeout par défaut suffit partout.
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Sur connexion instable (typiquement iOS Safari en 4G faible), un fetch sans timeout peut
 * rester pendant indéfiniment. On force une erreur réseau explicite au bout d'un délai donné,
 * traitée comme une panne par withOfflineFallback().
 */
export async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(path, {
      credentials: "include",
      signal: controller.signal,
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Délai dépassé — connexion trop lente ou instable.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  // /api/refresh est lui-même le mécanisme de reauth — pas de boucle infinie. Ses statuts
  // (ainsi que ceux de /api/login) peuvent aussi renvoyer 401 (identifiants invalides / token
  // expiré) : pas de reauth silencieuse à tenter non plus, l'utilisateur n'est pas encore
  // connecté à ce stade.
  const isAuthPath =
    path === "/api/login" ||
    path === "/api/refresh" ||
    path.startsWith("/api/login/status/") ||
    path.startsWith("/api/refresh/status/");
  if (resp.status === 401 && !isAuthPath) {
    if (!retried && (await trySilentReauth())) {
      return request<T>(path, init, true);
    }
    onUnauthorized?.();
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const apiError = body?.error;
    const message = apiError?.message || body.detail || messageForStatus(resp.status);
    const code = apiError?.code || (resp.status === 401 ? "SESSION_EXPIRED" : "HTTP_ERROR");
    throw new HttpError(resp.status, message, code, Boolean(apiError?.retryable));
  }
  return resp.json();
}

function messageForStatus(status: number): string {
  if (status === 401) return "Ta session a expiré. Reconnecte-toi.";
  if (status === 429) return "Trop de tentatives. Réessaie dans quelques minutes.";
  if (status === 503) return "Un service externe ne répond pas. Réessaie plus tard.";
  if (status >= 500) return "Le serveur a rencontré une erreur.";
  return `Erreur ${status}`;
}

function _invalidPayloadError(detail: string): HttpError {
  return new HttpError(502, detail, "SCODOC_INVALID_RESPONSE", true);
}

function validateSemestresPayload(data: unknown): PremiereConnexionResponse {
  const result = PremiereConnexionSchema.safeParse(data);
  if (!result.success) {
    throw _invalidPayloadError(
      "Le portail de notes a renvoyé une réponse invalide. Réessaie dans quelques minutes."
    );
  }
  return normalizeSemestres(result.data as unknown as PremiereConnexionResponse);
}

/**
 * ScoDoc renvoie `formsemestre_id` en NOMBRE, alors que tout le client le manipule en
 * chaîne (valeur d'un <select>, segment d'URL, clé de cache et de requête). Dès que
 * l'utilisateur changeait de semestre, les comparaisons `===` échouaient en silence :
 * plus de tendance vs semestre précédent, titre absent de l'export, semestre courant non
 * exclu de la comparaison, et un second fetch du relevé déjà chargé. On normalise donc une
 * fois pour toutes ici, à la frontière de l'API, plutôt que de rustiner chaque comparaison.
 *
 * L'ordre est rétabli au passage : la liste sert de source de vérité au semestre « courant »
 * (le dernier), au semestre précédent et au graphique d'évolution, et rien ne garantit
 * l'ordre côté portail (réinscription, redoublement, changement de formation).
 */
function normalizeSemestres(data: PremiereConnexionResponse): PremiereConnexionResponse {
  const semestres = (data.semestres ?? [])
    .map((s) => ({ ...s, formsemestre_id: String(s.formsemestre_id) }))
    .sort((a, b) => {
      const annee = String(a.annee_scolaire ?? "").localeCompare(String(b.annee_scolaire ?? ""));
      if (annee !== 0) return annee;
      const numero = Number(a.semestre_id ?? 0) - Number(b.semestre_id ?? 0);
      if (numero !== 0) return numero;
      return Number(a.formsemestre_id) - Number(b.formsemestre_id);
    });
  return { ...data, semestres };
}

function validateRelevePayload(data: unknown): ReleveResponse {
  const result = ReleveResponseSchema.safeParse(data);
  if (!result.success) {
    throw _invalidPayloadError(
      "Le portail de notes a renvoyé un relevé invalide. Réessaie dans quelques minutes."
    );
  }
  return result.data as unknown as ReleveResponse;
}

/**
 * Reconnexion silencieuse via le cookie remember httpOnly (géré par le serveur).
 * Retourne true si une nouvelle session a été créée avec succès.
 */
let reauthInFlight: Promise<boolean> | null = null;
function trySilentReauth(): Promise<boolean> {
  if (!reauthInFlight) {
    reauthInFlight = pollAuthJob("/api/refresh", "/api/refresh/status/")
      .then(() => true)
      .catch(() => false)
      .finally(() => { reauthInFlight = null; });
  }
  return reauthInFlight;
}

/**
 * Tente une reconnexion via le cookie remember sans ressaisie du mot de passe.
 * Appelée au démarrage quand /api/me indique que la session est expirée.
 */
export async function autoLoginIfRemembered(): Promise<{ username: string; isAdmin?: boolean } | null> {
  try {
    const res = await pollAuthJob("/api/refresh", "/api/refresh/status/");
    return { username: res.username, isAdmin: res.isAdmin };
  } catch {
    return null;
  }
}

export type CacheFallbackReason = "offline" | "scodoc_down";

/** Notifie l'UI qu'on affiche des données en cache (et pourquoi), pour un bandeau discret
 * plutôt qu'un écran d'erreur — voir withOfflineFallback(). null = données fraîches. */
let onCacheFallback: ((reason: CacheFallbackReason | null) => void) | null = null;
export function setCacheFallbackHandler(fn: ((reason: CacheFallbackReason | null) => void) | null) {
  onCacheFallback = fn;
}

/** Clé de cache qui a déclenché le bandeau en cours, pour qu'une requête secondaire qui
 * réussit (les relevés de la vue Graphiques, par exemple) n'efface pas un bandeau
 * « Hors ligne » posé par la donnée principale, toujours servie depuis le cache. */
let cacheFallbackKey: string | null = null;

/**
 * Network-first : on tente toujours le réseau d'abord. Le cache local n'est utilisé en repli
 * si on est hors-ligne, si fetch échoue avant d'obtenir une réponse HTTP (timeout, coupure),
 * ou si notre backend répond proprement que ScoDoc lui-même est indisponible (502/503) —
 * dans ce dernier cas une erreur HTTP "propre" existe, donc il ne faut pas la confondre avec
 * une vraie panne réseau : sans ce cas, l'utilisateur voyait un écran d'erreur au lieu des
 * dernières données connues alors qu'elles étaient disponibles en cache.
 */
async function withOfflineFallback<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const data = await fetcher();
    cacheSet(cacheKey, data);
    if (cacheFallbackKey === null || cacheFallbackKey === cacheKey) {
      cacheFallbackKey = null;
      onCacheFallback?.(null);
    }
    return data;
  } catch (err) {
    const scodocDown = err instanceof HttpError && (err.status === 502 || err.status === 503);
    const networkFailure = !navigator.onLine || isNetworkFailure(err);
    if (networkFailure || scodocDown) {
      const cached = cacheGet<T>(cacheKey);
      if (cached) {
        cacheFallbackKey = cacheKey;
        onCacheFallback?.(networkFailure ? "offline" : "scodoc_down");
        return cached;
      }
    }
    throw err;
  }
}

const AUTH_JOB_POLL_INTERVAL_MS = 1500;
const AUTH_JOB_POLL_MAX_MS = 60000;

/**
 * /api/login et /api/refresh lancent le flow CAS en tâche de fond côté serveur et renvoient
 * un job_id immédiatement : on poll ensuite le statut. Chaque requête HTTP (POST initial et
 * chaque poll) dure alors <15s, au lieu de garder une connexion ouverte et muette pendant
 * toute la durée du login CAS — ce qui est exactement ce que coupent les proxys d'entreprise
 * avec inspection TLS (timeout d'inactivité sur les connexions "silencieuses").
 */
async function pollAuthJob(
  postPath: string,
  statusPathPrefix: string,
  body?: unknown,
  onStage?: (stage: string | undefined) => void
): Promise<{ ok: boolean; username: string; isAdmin?: boolean }> {
  const { job_id } = await request<{ job_id: string }>(postPath, {
    method: "POST",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const deadline = Date.now() + AUTH_JOB_POLL_MAX_MS;
  for (;;) {
    let res: { status: string; ok?: boolean; username?: string; isAdmin?: boolean; stage?: string };
    try {
      res = await request(`${statusPathPrefix}${job_id}`);
    } catch (err) {
      // Une erreur du job lui-même arrive toujours comme HttpError (enveloppe d'erreur du
      // backend) : elle doit remonter telle quelle. Une panne réseau sur un poll de statut,
      // elle, ne dit rien du login en cours côté serveur — le faire échouer pour une coupure
      // d'une seconde annulait un login qui avait déjà abouti.
      if (!isNetworkFailure(err) || Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, AUTH_JOB_POLL_INTERVAL_MS));
      continue;
    }
    if (res.status === "ok") {
      return { ok: true, username: res.username as string, isAdmin: res.isAdmin };
    }
    onStage?.(res.stage);
    if (Date.now() > deadline) {
      throw new Error("Délai dépassé — connexion trop lente ou instable.");
    }
    await new Promise((resolve) => setTimeout(resolve, AUTH_JOB_POLL_INTERVAL_MS));
  }
}

/** Libellés affichés pendant le login le temps que le job de fond progresse (voir main.py). */
export const LOGIN_STAGE_LABELS: Record<string, string> = {
  contacting_site: "Connexion au portail de l'université...",
  cas_login: "Vérification des identifiants au CAS...",
  validating_session: "Validation de la session...",
  loading_data: "Chargement de tes données...",
};

export function login(username: string, password: string, remember = false, onStage?: (stage: string | undefined) => void) {
  return pollAuthJob("/api/login", "/api/login/status/", { username, password, remember }, onStage);
}

/**
 * Coupe l'abonnement push de CET appareil et renvoie son endpoint (pour que le serveur
 * détache la ligne correspondante). Volontairement local à ce module plutôt qu'importé de
 * pushNotifications.ts, qui dépend lui-même de request() d'ici.
 */
async function unsubscribeLocalPush(): Promise<string | null> {
  try {
    if (!("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return null;
    const { endpoint } = subscription;
    await subscription.unsubscribe().catch(() => {});
    return endpoint;
  } catch {
    return null; // best effort : la déconnexion ne doit jamais échouer là-dessus
  }
}

/**
 * Déconnexion : purge le stockage local (relevés, simulations, historique des notes), les
 * caches du service worker ET l'abonnement aux notifications, avant de fermer la session
 * serveur. Les quatre couches doivent être vidées ensemble — sinon, sur un appareil partagé,
 * l'étudiant suivant retrouve les données du précédent : l'abonnement push restait rattaché
 * au compte sortant, et son téléphone recevait les notifications de notes (valeur comprise)
 * de quelqu'un d'autre.
 */
export async function logout() {
  const pushEndpoint = await unsubscribeLocalPush();
  clearCache();
  await clearServiceWorkerCaches();
  return request<{ ok: boolean }>("/api/logout", {
    method: "POST",
    body: JSON.stringify({ pushEndpoint }),
  });
}

export type ReauthWarning = "idle" | "absolute" | null;

export function me() {
  return request<{
    authenticated: boolean;
    username?: string;
    canRefresh?: boolean;
    isAdmin?: boolean;
    reauthWarning?: ReauthWarning;
  }>("/api/me");
}

/** Reconnexion explicite (bouton du bandeau d'avertissement) : redemande un sid + un
 * remember-token frais via le cookie remember existant, sans ressaisie du mot de passe. */
export function reconnectNow() {
  return pollAuthJob("/api/refresh", "/api/refresh/status/");
}

export function clearServerCache() {
  return request<{ ok: boolean }>("/api/cache/me", { method: "DELETE" });
}

export function getSemestres() {
  return withOfflineFallback("semestres", async () => validateSemestresPayload(await request<unknown>("/api/semestres")));
}

export function getReleve(semestreId: string, refresh = false) {
  return withOfflineFallback(`releve:${semestreId}`, () =>
    request<unknown>(`/api/releve/${semestreId}${refresh ? "?refresh=true" : ""}`).then(validateRelevePayload)
  );
}

/** Notes anonymisées de toute la promo pour une évaluation — pas toujours activé côté admin ScoDoc. */
export function getDistribution(evalId: number) {
  return request<unknown>(`/api/distribution/${evalId}`);
}

export interface RememberSession {
  session_id: string;
  username: string;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  user_agent?: string;
}

export interface RememberEvent {
  id: number;
  username: string;
  token_hash_prefix: string;
  event: string;
  created_at: number;
  user_agent?: string;
  ip_hash?: string;
}

export function getMySessions() {
  return request<{ sessions: RememberSession[]; limits: Record<string, unknown> }>("/api/me/sessions");
}

export function revokeMySession(sessionId: string) {
  return request<{ ok: boolean }>(`/api/me/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

export function revokeAllMySessions() {
  return request<{ ok: boolean; deleted: number }>("/api/me/sessions", { method: "DELETE" });
}

export function getAdminStatus() {
  return request<Record<string, unknown>>("/api/admin/status");
}

export function getAdminRememberSessions() {
  return request<{ sessions: RememberSession[] }>("/api/admin/remember-sessions");
}

export function getAdminRememberEvents() {
  return request<{ events: RememberEvent[] }>("/api/admin/remember-events");
}
