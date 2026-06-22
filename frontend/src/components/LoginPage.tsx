import { FormEvent, useEffect, useRef, useState } from "react";
import { login, rememberCredentials, forgetCredentials } from "../api";
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
      const res = await login(username, password);
      if (remember) {
        rememberCredentials(username, password);
      } else {
        forgetCredentials();
      }
      onLoggedIn(res.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la connexion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sky-50 dark:bg-slate-950 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-slate-900 border border-sky-200 dark:border-slate-800 p-8 rounded-xl shadow-md w-full max-w-sm space-y-4"
      >
        <h1 className="text-xl font-semibold text-sky-950 dark:text-sky-100">Notes IUT Annecy</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Connecte-toi avec ton compte CAS pour voir tes relevés.</p>
        <p className="text-xs text-slate-500 dark:text-slate-500 bg-sky-50 dark:bg-slate-800/60 border border-sky-200 dark:border-slate-700 rounded-md p-2">
          Le mot de passe n'est jamais enregistré : il est transmis une seule fois, en direct et en HTTPS, au CAS
          officiel de l'université (cas-uds.grenet.fr) pour authentification, exactement comme le ferait un navigateur.
          Rien n'est stocké sur disque côté serveur.
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
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-2">
              L'identifiant et le mot de passe seront stockés en clair dans ce navigateur pendant 1 mois, pour te
              reconnecter automatiquement sans ressaisie. Ne coche pas sur un appareil partagé ou public. La
              déconnexion manuelle effacera ces identifiants.
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
