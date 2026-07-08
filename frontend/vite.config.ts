import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt" : le SW attend l'accord de l'utilisateur pour s'activer (bouton dans SettingsMenu).
      registerType: "prompt",
      cleanupOutdatedCaches: true,
      manifest: false,
      selfDestroying: false,
      // injectManifest : SW personnalisé avec handler push.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,woff,woff2}"],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
