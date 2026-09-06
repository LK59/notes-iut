import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { autoLoginIfRemembered, me, setUnauthorizedHandler, type ReauthWarning } from "./api";
import LoginPage from "./components/LoginPage";
import Dashboard from "./components/Dashboard";
import PreviewApp from "./components/PreviewApp";

/**
 * Au retour au premier plan, on ne réinterroge le portail que si l'app est restée en
 * arrière-plan au moins ce délai. `invalidateQueries` force en effet un refetch quel que
 * soit le `staleTime` : sans ce garde-fou, un simple aller-retour vers une autre app
 * relançait un relevé complet — et, côté serveur, un prefetch de tous les semestres.
 */
const BACKGROUND_REFRESH_THRESHOLD_MS = 3 * 60 * 1000;

export default function App() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);
  const [reauthWarning, setReauthWarning] = useState<ReauthWarning>(null);
  const hiddenSinceRef = useRef<number | null>(null);

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
  // se déclenche de façon fiable — mais on distingue deux cas : la session est revalidée à chaque
  // retour (c'est gratuit, et elle a pu expirer), tandis que le rechargement des données n'est
  // déclenché qu'après une absence assez longue pour que le relevé ait pu changer.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenSinceRef.current = Date.now();
        return;
      }
      if (document.visibilityState !== "visible") return;
      checkAuth();
      const hiddenSince = hiddenSinceRef.current;
      hiddenSinceRef.current = null;
      if (hiddenSince !== null && Date.now() - hiddenSince < BACKGROUND_REFRESH_THRESHOLD_MS) return;
      queryClient.invalidateQueries({ queryKey: ["semestres"] });
      queryClient.invalidateQueries({ queryKey: ["releve"] });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
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

  // Page publique de prévisions S5/S6 (BUT R&T) : accessible sans être loggé, y compris en
  // accès direct par URL — donc vérifiée avant tout écran d'authentification/chargement.
  if (window.location.pathname.startsWith("/preview")) {
    return <PreviewApp loggedIn={!checking && Boolean(username)} />;
  }

  // En cas de connexion instable, ne jamais rester sur un écran vide indéfiniment : même si
  // le check initial traîne, on affiche un signe de vie plutôt qu'un écran blanc/bleu muet.
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <div className="h-5 w-5 rounded-full border-2 border-line-strong border-t-accent animate-spin" />
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
