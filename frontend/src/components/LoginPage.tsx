import { FormEvent, useEffect, useRef, useState } from "react";
import { login, LOGIN_STAGE_LABELS } from "../api";
import ThemeToggle from "./ThemeToggle";
import { Button } from "./ui";

export default function LoginPage({
  onLoggedIn,
}: {
  onLoggedIn: (username: string, isAdmin?: boolean) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<string | undefined>(undefined);
  const usernameRef = useRef<HTMLInputElement>(null);

  // Autofocus uniquement sur pointeur "fin" (souris/trackpad) : sur écran tactile, un focus
  // programmatique au chargement peut ouvrir le clavier virtuel et faire sauter la mise en
  // page (comportement Android Chrome notamment) — on évite ce risque sur mobile.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) {
      usernameRef.current?.focus();
    }
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    setStage(undefined);
    try {
      // Le login CAS enchaîne plusieurs appels externes séquentiels côté serveur : on affiche
      // l'étape en cours (remontée par le job de fond, voir api.ts) plutôt que de laisser le
      // bouton muet pendant plusieurs secondes.
      const result = await login(username, password, remember, setStage);
      onLoggedIn(result.username, result.isAdmin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "La connexion a échoué.");
    } finally {
      setLoading(false);
      setStage(undefined);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtle";

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>

      <div className="flex-1 flex items-start sm:items-center justify-center px-4 pb-16">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Notes IUT</h1>
            <p className="mt-1 text-sm text-muted">
              Connecte-toi avec ton compte CAS pour voir tes relevés.
            </p>
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-muted">Identifiant</span>
              <input
                ref={usernameRef}
                className={inputClass}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted">Mot de passe</span>
              <input
                type="password"
                className={inputClass}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
          </div>

          <div className="rounded-lg border border-line bg-inset/60 p-3 space-y-2">
            <label className="flex items-start gap-2.5 text-sm text-fg cursor-pointer">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong accent-accent"
              />
              <span>
                Rester connecté un mois
                <span className="block text-xs text-muted">Nécessaire pour les notifications</span>
              </span>
            </label>
            {remember && (
              <p className="text-xs text-muted leading-relaxed border-t border-line pt-2">
                Tes identifiants sont chiffrés (AES-256) et conservés sur ce serveur pendant un
                mois. Ton navigateur ne reçoit qu'un cookie de reconnexion, jamais ton mot de
                passe. Te déconnecter révoque l'accès immédiatement. À éviter sur un appareil
                partagé.
              </p>
            )}
          </div>

          {loading && !error && (
            <p className="text-xs text-muted">
              {stage ? LOGIN_STAGE_LABELS[stage] ?? "Connexion en cours…" : "Connexion en cours…"}
            </p>
          )}

          {error && (
            <p role="alert" aria-live="assertive" className="text-sm text-neg">
              {error}
            </p>
          )}

          <Button tone="primary" type="submit" disabled={loading} className="w-full py-2">
            {loading ? "Connexion…" : "Se connecter"}
          </Button>

          <div className="space-y-3 pt-2 border-t border-line">
            <p className="text-xs text-subtle leading-relaxed">
              Ton mot de passe est transmis une seule fois, en direct et en HTTPS, au CAS officiel
              de l'université (cas-uds.grenet.fr) — exactement comme le ferait ton navigateur.
              Cette app n'est pas le portail officiel de l'IUT.
            </p>
            <a
              href="/preview/s5"
              className="block text-xs text-accent hover:underline"
            >
              Voir les prévisions S5/S6 sans se connecter →
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
