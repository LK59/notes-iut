import { useEffect, useState } from "react";
import { autoLoginIfRemembered, me, setUnauthorizedHandler } from "./api";
import LoginPage from "./components/LoginPage";
import Dashboard from "./components/Dashboard";

export default function App() {
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);

  function checkAuth() {
    me()
      .then(async (res) => {
        if (res.authenticated) {
          setUsername(res.username ?? null);
          setIsAdmin(Boolean(res.isAdmin));
          return;
        }
        // /api/me ne renvoie jamais 401 (par design). Le serveur voit le cookie HttpOnly
        // "remember" et nous dit si une reconnexion silencieuse vaut la peine d'être tentée.
        const refreshed = res.canRefresh ? await autoLoginIfRemembered() : null;
        setUsername(refreshed?.username ?? null);
        setIsAdmin(Boolean(refreshed?.isAdmin));
      })
      .catch(() => {
        setUsername(null);
        setIsAdmin(false);
      })
      .finally(() => setChecking(false));
  }

  useEffect(checkAuth, []);

  // iOS Safari restaure parfois la page depuis son cache (bfcache) après une navigation
  // arrière sans ré-exécuter les effets : on revérifie la session dans ce cas précis, sinon
  // l'app peut sembler figée sur un état authentifié périmé.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) checkAuth();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Session serveur courte (4h) : si une requête API renvoie 401 en cours d'usage,
  // on retombe proprement sur l'écran de connexion plutôt que de laisser une erreur affichée.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUsername(null);
      setIsAdmin(false);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // En cas de connexion instable, ne jamais rester sur un écran vide indéfiniment : même si
  // le check initial traîne, on affiche un signe de vie plutôt qu'un écran blanc/bleu muet.
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sky-50 dark:bg-slate-950">
        <div className="h-6 w-6 rounded-full border-2 border-sky-300 dark:border-sky-700 border-t-sky-600 dark:border-t-sky-300 animate-spin" />
      </div>
    );
  }

  if (!username) {
    return <LoginPage onLoggedIn={(name, admin) => { setUsername(name); setIsAdmin(Boolean(admin)); }} />;
  }

  return <Dashboard username={username} isAdmin={isAdmin} onLoggedOut={() => { setUsername(null); setIsAdmin(false); }} />;
}
