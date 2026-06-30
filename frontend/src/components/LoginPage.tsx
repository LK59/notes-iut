import { FormEvent, useEffect, useRef, useState } from "react";
import { login } from "../api";
import ThemeToggle from "./ThemeToggle";

export default function LoginPage({ onLoggedIn }: { onLoggedIn: (username: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  // Autofocus uniquement sur pointeur "fin" (souris/trackpad) : sur écran tactile, focus
  // programmatique au chargement peut déclencher le clavier virtuel et faire sauter la mise
  // en page (comportement Android Chrome notamment) — on évite ce risque sur mobile.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) {
      usernameRef.current?.focus();
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(username, password, remember);
      onLoggedIn(res.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la connexion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-sky-50 to-sky-100 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 relative px-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <form
        onSubmit={handleSubmit}
        className="bg-sky-50/85 dark:bg-slate-900/65 backdrop-blur-xl border border-sky-200/70 dark:border-slate-700/70 ring-1 ring-black/5 dark:ring-white/5 p-8 rounded-2xl shadow-xl shadow-sky-900/5 dark:shadow-black/40 w-full max-w-sm space-y-4"
      >
        <h1 className="text-xl font-semibold text-sky-950 dark:text-sky-100">Notes IUT Annecy</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Connecte-toi avec ton compte CAS pour voir tes relevés.</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 bg-sky-50 dark:bg-slate-800/60 border border-sky-200 dark:border-slate-700 rounded-md p-2">
          Le mot de passe est transmis une seule fois, en direct et en HTTPS, au CAS officiel de
          l'université (cas-uds.grenet.fr) pour authentification — exactement comme le ferait un
          navigateur.
        </p>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Identifiant</label>
          <input
            ref={usernameRef}
            className="mt-1 w-full rounded-md border border-sky-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Mot de passe</label>
          <input
            type="password"
            className="mt-1 w-full rounded-md border border-sky-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="rounded border-sky-300 dark:border-slate-600"
            />
            Se souvenir de moi (1 mois)
          </label>
          {remember && (
            <p className="mt-1 text-xs text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-md p-2">
              Tes identifiants sont chiffrés (AES-256) et stockés de façon sécurisée sur ce serveur
              pendant 1 mois. Ton navigateur reçoit un cookie de reconnexion — jamais ton mot de
              passe. La déconnexion manuelle révoque immédiatement l'accès. Ne coche pas sur un
              appareil partagé.
            </p>
          )}
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-sky-700 hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-500 text-white py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Connexion..." : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
