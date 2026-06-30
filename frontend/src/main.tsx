import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import {
  getFailedAssetUrl,
  isAssetLoadError,
  isChunkLoadError,
  recoverFromChunkLoadError,
  resetChunkRecoveryState,
} from "./chunkRecovery";
import { ensureCacheVersion } from "./offlineCache";
import "./index.css";

ensureCacheVersion();

// Après un redéploi, les anciens chunks JS hashés peuvent disparaître alors qu'un onglet
// encore ouvert les référence. Dans ce cas, on purge les caches navigateur/service worker
// et on recharge une seule fois pour récupérer l'index et les chunks de la nouvelle version.
window.addEventListener("unhandledrejection", (event) => {
  if (isChunkLoadError(event.reason) && recoverFromChunkLoadError(null, event.reason)) {
    event.preventDefault();
  }
});

window.addEventListener(
  "error",
  (event) => {
    if (isAssetLoadError(event) && recoverFromChunkLoadError(getFailedAssetUrl(event), event)) {
      event.preventDefault();
    }
  },
  true
);

window.addEventListener("vite:preloadError", (event) => {
  const payload = (event as CustomEvent<unknown>).detail ?? event;
  if (recoverFromChunkLoadError(null, payload)) {
    event.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// Une fois l'app stable quelques secondes, on autorise un futur rechargement automatique
// (sinon un vrai problème de chunk lors d'un prochain redéploi serait ignoré silencieusement).
setTimeout(() => {
  resetChunkRecoveryState();
  sessionStorage.removeItem("notes-iut-boundary-reload");
}, 5000);
