import type { PremiereConnexionResponse, ReleveResponse } from "./types";
import { cacheGet, cacheSet, clearCache } from "./offlineCache";

/** Erreur HTTP "normale" (réponse reçue du serveur) — distincte d'une vraie panne réseau. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

const REMEMBER_KEY = "notes-iut-remember";
const REMEMBER_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 1 mois

interface RememberedCreds {
  username: string;
  password: string;
  expiresAt: number;
}

/** Stocke les identifiants en clair dans le navigateur (localStorage) pour 1 mois — voir l'avertissement affiché à l'utilisateur sur l'écran de connexion. */
export function rememberCredentials(username: string, password: string) {
  try {
    const payload: RememberedCreds = { username, password, expiresAt: Date.now() + REMEMBER_DURATION_MS };
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(payload));
  } catch {
    // best effort
  }
}

export function forgetCredentials() {
  try {
    localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // best effort
  }
}

function getRememberedCredentials(): { username: string; password: string } | null {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const creds: RememberedCreds = JSON.parse(raw);
    if (!creds.expiresAt || Date.now() > creds.expiresAt) {
      forgetCredentials();
      return null;
    }
    return creds;
  } catch {
    return null;
  }
}

let reauthInFlight: Promise<boolean> | null = null;

/** Reconnexion silencieuse via les identifiants mémorisés, quand la session serveur a expiré. */
function trySilentReauth(): Promise<boolean> {
  const creds = getRememberedCredentials();
  if (!creds) return Promise.resolve(false);
  if (!reauthInFlight) {
    reauthInFlight = rawLogin(creds.username, creds.password)
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        reauthInFlight = null;
      });
  }
  return reauthInFlight;
}

/** Tente une connexion avec les identifiants mémorisés ; renvoie le username si réussie, sinon null. */
export async function autoLoginIfRemembered(): Promise<string | null> {
  const creds = getRememberedCredentials();
  if (!creds) return null;
  try {
    const res = await rawLogin(creds.username, creds.password);
    return res.username;
  } catch {
    return null;
  }
}

function rawLogin(username: string, password: string) {
  return request<{ ok: boolean; username: string }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const resp = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (resp.status === 401 && path !== "/api/login") {
    if (!retried && (await trySilentReauth())) {
      return request<T>(path, init, true);
    }
    onUnauthorized?.();
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new HttpError(resp.status, body.detail || `Erreur ${resp.status}`);
  }
  return resp.json();
}

/**
 * Network-first : on tente toujours le réseau d'abord, jamais de lecture cache préventive
 * (la donnée du portail prime). Le cache local n'est utilisé en repli que si on est
 * effectivement hors-ligne (navigator.onLine === false) ou si fetch échoue avant même
 * d'obtenir une réponse HTTP (panne réseau) — pas pour masquer une vraie erreur serveur.
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

export function login(username: string, password: string) {
  return rawLogin(username, password);
}

export function logout() {
  forgetCredentials();
  clearCache(["notes-iut-cache:", "notes-iut-sim:"]);
  return request<{ ok: boolean }>("/api/logout", { method: "POST" });
}

export function me() {
  return request<{ authenticated: boolean; username?: string }>("/api/me");
}

export function getSemestres() {
  return withOfflineFallback("semestres", () => request<PremiereConnexionResponse>("/api/semestres"));
}

export function getReleve(semestreId: string, refresh = false) {
  return withOfflineFallback(`releve:${semestreId}`, () =>
    request<ReleveResponse>(`/api/releve/${semestreId}${refresh ? "?refresh=true" : ""}`)
  );
}

/** Notes anonymisées de toute la promo pour une évaluation — pas toujours activé côté admin ScoDoc. */
export function getDistribution(evalId: number) {
  return request<unknown>(`/api/distribution/${evalId}`);
}
