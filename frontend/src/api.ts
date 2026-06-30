import type { PremiereConnexionResponse, ReleveResponse } from "./types";
import { cacheGet, cacheSet, clearCache } from "./offlineCache";

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

const REQUEST_TIMEOUT_MS = 15000;

/**
 * Sur connexion instable (typiquement iOS Safari en 4G faible), un fetch sans timeout peut
 * rester pendant indéfiniment. On force une erreur réseau explicite au bout de 15s,
 * traitée comme une panne par withOfflineFallback().
 */
async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      ...init,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Délai dépassé — connexion trop lente ou instable.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  // /api/refresh est lui-même le mécanisme de reauth — pas de boucle infinie.
  if (resp.status === 401 && path !== "/api/login" && path !== "/api/refresh") {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateSemestresPayload(data: unknown): PremiereConnexionResponse {
  if (!isRecord(data) || !Array.isArray(data.semestres)) {
    throw new HttpError(
      502,
      "Le portail de notes a renvoye une reponse invalide. Reessaie dans quelques minutes.",
      "SCODOC_INVALID_RESPONSE",
      true
    );
  }
  return data as PremiereConnexionResponse;
}

function validateRelevePayload(data: unknown): ReleveResponse {
  if (!isRecord(data) || !isRecord(data.relevé) || !isRecord(data.relevé.ues)) {
    throw new HttpError(
      502,
      "Le portail de notes a renvoye un releve invalide. Reessaie dans quelques minutes.",
      "SCODOC_INVALID_RESPONSE",
      true
    );
  }
  return data as ReleveResponse;
}

/**
 * Reconnexion silencieuse via le cookie remember httpOnly (géré par le serveur).
 * Retourne true si une nouvelle session a été créée avec succès.
 */
let reauthInFlight: Promise<boolean> | null = null;
function trySilentReauth(): Promise<boolean> {
  if (!reauthInFlight) {
    reauthInFlight = request<{ ok: boolean; username: string; isAdmin?: boolean }>("/api/refresh", { method: "POST" })
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
    const res = await request<{ ok: boolean; username: string; isAdmin?: boolean }>("/api/refresh", { method: "POST" });
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

export function login(username: string, password: string, remember = false) {
  return request<{ ok: boolean; username: string; isAdmin?: boolean }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password, remember }),
  });
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
