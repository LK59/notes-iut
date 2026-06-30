import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      cleanupOutdatedCaches: true,
      // Le manifest est géré manuellement dans public/manifest.json
      manifest: false,
      // Activation immédiate sans attendre la fermeture des autres onglets
      selfDestroying: false,
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // Pre-cache tous les assets JS/CSS/HTML générés par le build (hashés = jamais périmés)
        globPatterns: ["**/*.{js,css,html,woff,woff2}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Photo de profil : stale-while-revalidate, 1h de fraîcheur
            urlPattern: /^\/api\/photo/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-photo",
              expiration: { maxAgeSeconds: 3600, maxEntries: 5 },
            },
          },
          {
            // Toutes les autres routes /api/* : réseau uniquement, jamais de cache
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
