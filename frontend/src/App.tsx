import { useEffect, useState } from "react";
import { autoLoginIfRemembered, me, setUnauthorizedHandler } from "./api";
import LoginPage from "./components/LoginPage";
import Dashboard from "./components/Dashboard";

export default function App() {
  const [username, setUsername] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    me()
      .then(async (res) => {
        if (res.authenticated) {
          setUsername(res.username ?? null);
          return;
        }
        // /api/me ne renvoie jamais 401 (par design) : la reconnexion silencieuse n'est donc
        // pas déclenchée automatiquement ici comme pour les autres appels — on la tente nous-mêmes.
        setUsername(await autoLoginIfRemembered());
      })
      .finally(() => setChecking(false));
  }, []);

  // Session serveur courte (4h) : si une requête API renvoie 401 en cours d'usage,
  // on retombe proprement sur l'écran de connexion plutôt que de laisser une erreur affichée.
  useEffect(() => {
    setUnauthorizedHandler(() => setUsername(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  if (checking) return null;

  if (!username) {
    return <LoginPage onLoggedIn={setUsername} />;
  }

  return <Dashboard username={username} onLoggedOut={() => setUsername(null)} />;
}
