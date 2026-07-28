import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { autoLoginIfRemembered, me, setUnauthorizedHandler, type ReauthWarning } from "./api";
import LoginPage from "./components/LoginPage";
import Dashboard from "./components/Dashboard";

export default function App() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);
  const [reauthWarning, setReauthWarning] = useState<ReauthWarning>(null);

  function checkAuth() {
    me()
      .then(async (res) => {
        if (res.authenticated) {
          setUsername(res.username ?? null);
          setIsAdmin(Boolean(res.isAdmin));
          setReauthWarning(res.reauthWarning ?? null);
          return;
        }
        // /api/me ne renvoie jamais 401 (par design). Le serveur voit le cookie HttpOnly
        // "remember" et nous dit si une reconnexion silencieuse vaut la peine d'être tentée.
        const refreshed = res.canRefresh ? await autoLoginIfRemembered() : null;
        setUsername(refreshed?.username ?? null);
        setIsAdmin(Boolean(refreshed?.isAdmin));
        setReauthWarning(null);
      })
      .catch(() => {
        setUsername(null);
        setIsAdmin(false);
        setReauthWarning(null);
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

  // En PWA standalone (mobile), l'app n'est jamais vraiment "fermée" : elle passe en arrière-plan
  // puis revient au premier plan sans rechargement ni navigation, donc ni "pageshow" ni le focus
  // de fenêtre (peu fiable en standalone) ne se déclenchent. On utilise visibilitychange, qui lui
  // se déclenche de façon fiable dans ce cas : on revalide la session (elle a pu expirer pendant
  // l'absence) et on relance un refetch en fond des données affichées, pour que l'utilisateur
  // retrouve toujours un état à jour sans avoir à quitter/rouvrir l'app.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      checkAuth();
      queryClient.invalidateQueries();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [queryClient]);

  // Session serveur courte (4h) : si une requête API renvoie 401 en cours d'usage,
  // on retombe proprement sur l'écran de connexion plutôt que de laisser une erreur affichée.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.clear();
      setUsername(null);
      setIsAdmin(false);
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

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

  return (
    <Dashboard
      username={username}
      isAdmin={isAdmin}
      reauthWarning={reauthWarning}
      onReconnected={() => setReauthWarning(null)}
      onLoggedOut={() => { setUsername(null); setIsAdmin(false); setReauthWarning(null); }}
    />
  );
}
