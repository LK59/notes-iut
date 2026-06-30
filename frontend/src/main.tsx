import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { ensureCacheVersion, clearDataCache } from "./offlineCache";
import "./index.css";

ensureCacheVersion();

// Après un redéploi, les anciens chunks JS hashés disparaissent : un import dynamique
// (React.lazy) qui les référence encore échoue ("Failed to fetch dynamically imported
// module"). Sur connexion instable ça peut aussi survenir sans rapport avec un redéploi.
// On vide le cache et recharge une seule fois (sessionStorage évite une boucle) pour
// forcer des ressources fraîches plutôt que de laisser l'app plantée.
window.addEventListener("unhandledrejection", (event) => {
  const message = String(event.reason?.message ?? event.reason ?? "");
  if (/fetch dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(message)) {
    const key = "notes-iut-chunk-reload";
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      clearDataCache();
      window.location.reload();
    }
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
  sessionStorage.removeItem("notes-iut-chunk-reload");
  sessionStorage.removeItem("notes-iut-boundary-reload");
}, 5000);
