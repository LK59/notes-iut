import type { PremiereConnexionResponse, ReleveResponse } from "./types";
import { cacheGet, cacheSet, clearCache } from "./offlineCache";
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
async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
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
  if (status === 401) return "Ta session a expire. Reconnecte-toi.";
  if (status === 429) return "Trop de tentatives. Reessaie dans quelques minutes.";
  if (status === 503) return "Un service externe ne repond pas. Reessaie plus tard.";
  if (status >= 500) return "Le serveur a rencontre une erreur.";
  return `Erreur ${status}`;
}

function _invalidPayloadError(detail: string): HttpError {
  return new HttpError(502, detail, "SCODOC_INVALID_RESPONSE", true);
}

function validateSemestresPayload(data: unknown): PremiereConnexionResponse {
  const result = PremiereConnexionSchema.safeParse(data);
  if (!result.success) {
    throw _invalidPayloadError(
      "Le portail de notes a renvoye une reponse invalide. Reessaie dans quelques minutes."
    );
  }
  return result.data as unknown as PremiereConnexionResponse;
}

function validateRelevePayload(data: unknown): ReleveResponse {
  const result = ReleveResponseSchema.safeParse(data);
  if (!result.success) {
    throw _invalidPayloadError(
      "Le portail de notes a renvoye un releve invalide. Reessaie dans quelques minutes."
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

/**
 * Network-first : on tente toujours le réseau d'abord. Le cache local n'est utilisé
 * en repli que si on est hors-ligne ou si fetch échoue avant d'obtenir une réponse HTTP.
 */
async function withOfflineFallback<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const data = await fetcher();
    cacheSet(cacheKey, data);
    return data;
  } catch (err) {
    const networkFailure = !navigator.onLine || !(err instanceof HttpError);
    if (networkFailure) {
      const cached = cacheGet<T>(cacheKey);
      if (cached) return cached;
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
    const res = await request<{ status: string; ok?: boolean; username?: string; isAdmin?: boolean; stage?: string }>(
      `${statusPathPrefix}${job_id}`
    );
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

export function logout() {
  clearCache(["notes-iut-cache:", "notes-iut-sim:"]);
  return request<{ ok: boolean }>("/api/logout", { method: "POST" });
}

export function me() {
  return request<{ authenticated: boolean; username?: string; canRefresh?: boolean; isAdmin?: boolean }>("/api/me");
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
