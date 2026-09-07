/// <reference lib="webworker" />
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute, setCatchHandler } from "workbox-routing";
import { ExpirationPlugin } from "workbox-expiration";
import { NetworkFirst, NetworkOnly, StaleWhileRevalidate } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>;
};

// Précache de tous les assets buildés (hashés → jamais périmés)
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Activation immédiate sur message SKIP_WAITING (bouton "Mettre à jour" dans SettingsMenu)
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  // Déconnexion : la page demande la purge des réponses /api mises en cache ici.
  // Elles contiennent le relevé complet et la photo du compte qui se déconnecte, et
  // le service worker n'applique pas le `Cache-Control: private, no-store` du backend.
  if (event.data?.type === "CLEAR_USER_CACHES") {
    event.waitUntil(
      Promise.all([caches.delete("api-data"), caches.delete("api-photo")])
    );
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Ne met en cache que les réponses HTTP 200 (évite de cacher les 401/500).
const cacheOnlyOk = {
  cacheWillUpdate: async ({ response }: { response: Response }) =>
    response.status === 200 ? response : null,
};

// Un rafraîchissement explicite (bouton ⟳ → ?refresh=true) doit TOUJOURS aller au réseau.
// Sans cette exclusion, stale-while-revalidate servait l'entrée mise en cache lors du clic
// précédent — le bouton affichait donc l'état d'avant, en silence, et la revalidation de
// fond ne remontait jamais jusqu'à l'UI.
const isExplicitRefresh = (url: URL) => url.searchParams.get("refresh") === "true";

registerRoute(
  ({ url }) => url.pathname.startsWith("/api/releve/") && isExplicitRefresh(url),
  new NetworkOnly()
);

// Données de relevés : stale-while-revalidate → réponse immédiate du cache, mise à jour en fond.
// Cela rend les rechargements de page quasi-instantanés sans sacrifier la fraîcheur des données.
registerRoute(
  ({ url }) =>
    url.pathname === "/api/semestres" ||
    (url.pathname.startsWith("/api/releve/") && !isExplicitRefresh(url)),
  new StaleWhileRevalidate({
    cacheName: "api-data",
    plugins: [
      cacheOnlyOk,
      new ExpirationPlugin({ maxAgeSeconds: 15 * 60, maxEntries: 30 }),
    ],
  })
);

// Photo de profil : stale-while-revalidate, 1h
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/photo"),
  new StaleWhileRevalidate({
    cacheName: "api-photo",
    plugins: [cacheOnlyOk, new ExpirationPlugin({ maxAgeSeconds: 3600, maxEntries: 5 })],
  })
);

// Toutes les autres routes /api/* : réseau uniquement
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/"),
  new NetworkOnly()
);

// Navigation SPA : réseau en priorité (fraîcheur), repli sur index.html précaché si hors-ligne.
// NetworkOnly ne faisait aucun repli : un démarrage à froid sans réseau échouait entièrement,
// avant même que l'app (et son cache offline en JS) ait pu se charger.
registerRoute(
  new NavigationRoute(
    new NetworkFirst({ cacheName: "app-shell", networkTimeoutSeconds: 3, plugins: [cacheOnlyOk] }),
    { denylist: [/^\/api\//] }
  )
);

setCatchHandler(async ({ event }) => {
  if (event.request.mode === "navigate") {
    return (await matchPrecache("/index.html")) ?? Response.error();
  }
  return Response.error();
});

// ── Push notifications ──────────────────────────────────────────────────────

// Un payload absent ou illisible faisait lever json() : l'exception remontait hors du
// handler et le navigateur affichait à la place sa notification générique « Ce site a été
// mis à jour en arrière-plan », impossible à relier à une note.
function pushPayload(event: PushEvent): Record<string, string | undefined> {
  try {
    return (event.data?.json() as Record<string, string | undefined>) ?? {};
  } catch {
    return {};
  }
}

self.addEventListener("push", (event) => {
  const data = pushPayload(event as PushEvent);
  const options: NotificationOptions = {
    body: data.body ?? "",
    icon: "/icon-192.png",
    badge: "/favicon-32.png",
    data: { url: data.url ?? "/" },
    vibrate: [200, 100, 200],
    tag: data.tag ?? "notes-iut",
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(data.title ?? "Notes IUT", options));
});

self.addEventListener("notificationclick", (event) => {
  (event as NotificationEvent).notification.close();
  const url = (event as NotificationEvent).notification.data?.url ?? "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) return (client as WindowClient).focus();
        }
        return self.clients.openWindow(url);
      })
  );
});
