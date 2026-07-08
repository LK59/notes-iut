/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { ExpirationPlugin } from "workbox-expiration";
import { NetworkOnly, StaleWhileRevalidate } from "workbox-strategies";

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
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Ne met en cache que les réponses HTTP 200 (évite de cacher les 401/500).
const cacheOnlyOk = {
  cacheWillUpdate: async ({ response }: { response: Response }) =>
    response.status === 200 ? response : null,
};

// Données de relevés : stale-while-revalidate → réponse immédiate du cache, mise à jour en fond.
// Cela rend les rechargements de page quasi-instantanés sans sacrifier la fraîcheur des données.
registerRoute(
  ({ url }) =>
    url.pathname === "/api/semestres" || url.pathname.startsWith("/api/releve/"),
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

// Navigation SPA : fallback vers index.html si hors-ligne
registerRoute(
  new NavigationRoute(new NetworkOnly(), { denylist: [/^\/api\//] })
);

// ── Push notifications ──────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  const data = (event as PushEvent).data?.json() ?? {};
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
