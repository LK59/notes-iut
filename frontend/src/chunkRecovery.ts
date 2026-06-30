import { clearDataCache } from "./offlineCache";

const CHUNK_RELOAD_KEY = "notes-iut-chunk-reload";
const LAST_RECOVERY_KEY = "notes-iut-chunk-reload-at";

const CHUNK_ERROR_RE =
  /failed to fetch dynamically imported module|fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css|chunkloaderror|loading chunk \d+ failed|loading css chunk \d+ failed|dynamically imported module/i;
const TRANSIENT_ERROR_RE = /abort|aborted|cancel|cancelled|interrupted|networkerror|load failed|connection/i;
const ASSET_URL_RE = /https?:\/\/[^\s"'<>]+\/assets\/[^\s"'<>]+|\/assets\/[^\s"'<>]+/i;

function valueToText(value: unknown): string {
  if (!value) return "";
  if (value instanceof Error) return `${value.name} ${value.message} ${value.stack ?? ""}`;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [record.name, record.message, record.stack, record.reason]
      .filter(Boolean)
      .map(String)
      .join(" ");
  }
  return String(value);
}

export function isChunkLoadError(value: unknown): boolean {
  return CHUNK_ERROR_RE.test(valueToText(value));
}

export function getFailedAssetUrl(event: Event | ErrorEvent): string | null {
  const target = event.target;
  if (target instanceof HTMLScriptElement && target.src.includes("/assets/")) return target.src;
  if (target instanceof HTMLLinkElement && target.href.includes("/assets/")) return target.href;
  return null;
}

export function getAssetUrlFromError(value: unknown): string | null {
  const text = valueToText(value);
  const match = text.match(ASSET_URL_RE);
  if (!match) return null;
  try {
    return new URL(match[0], window.location.href).href;
  } catch {
    return null;
  }
}

export function isAssetLoadError(event: Event | ErrorEvent): boolean {
  if (getFailedAssetUrl(event)) return true;
  if ("message" in event && isChunkLoadError(event.message)) return true;
  if ("error" in event && isChunkLoadError(event.error)) return true;
  return false;
}

export function getChunkErrorText(value: unknown): string {
  return valueToText(value);
}

async function clearBrowserAssetCaches(): Promise<void> {
  clearDataCache();
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)));
  }
}

export function resetChunkRecoveryState(): void {
  sessionStorage.removeItem(CHUNK_RELOAD_KEY);
}

async function assetLooksMissing(url: string | null): Promise<boolean> {
  if (!url) return false;
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    return response.status === 404 || response.status === 410;
  } catch {
    return false;
  }
}

function shouldAvoidRecovery(text: string): boolean {
  const last = Number(sessionStorage.getItem(LAST_RECOVERY_KEY) ?? "0");
  if (Date.now() - last < 30000) return true;
  return TRANSIENT_ERROR_RE.test(text) && !CHUNK_ERROR_RE.test(text);
}

export function recoverFromChunkLoadError(assetUrl: string | null = null, detail: unknown = null): boolean {
  if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return false;
  if (shouldAvoidRecovery(valueToText(detail))) return false;
  const urlToCheck = assetUrl ?? getAssetUrlFromError(detail);
  if (!urlToCheck) return false;
  sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
  sessionStorage.setItem(LAST_RECOVERY_KEY, String(Date.now()));
  window.setTimeout(() => {
    void assetLooksMissing(urlToCheck)
      .then((missing) => {
        if (!missing) {
          sessionStorage.removeItem(CHUNK_RELOAD_KEY);
          return;
        }
        return clearBrowserAssetCaches().finally(() => window.location.reload());
      })
      .catch(() => {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      });
  }, 600);
  return true;
}
