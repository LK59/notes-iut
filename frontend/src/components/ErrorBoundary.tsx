import { Component, type ReactNode } from "react";
import { clearDataCache } from "../offlineCache";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  autoReloading: boolean;
}

const CHUNK_ERROR_RE = /fetch dynamically imported module|Importing a module script failed|Unable to preload CSS/i;
const CHUNK_RELOAD_KEY = "notes-iut-boundary-reload";

/**
 * Filet de sécurité : sans ça, toute erreur de rendu (y compris un échec de chargement de
 * chunk JS après redéploi — fréquent sur connexion instable) fait disparaître l'app React
 * sans rien afficher, d'où l'écran blanc/bleu signalé sur iOS Safari.
 *
 * Sur une chunk error, on vide le cache et on recharge automatiquement une fois (sessionStorage
 * évite la boucle infinie si le rechargement échoue aussi). Sinon, l'utilisateur peut choisir
 * de recharger seul ou de vider le cache avant — utile quand le crash vient de données en
 * cache corrompues ou incompatibles (nav privée, mise à jour de format…).
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, autoReloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    if (CHUNK_ERROR_RE.test(error.message ?? "")) {
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
        clearDataCache();
        // On retourne autoReloading=true pour afficher un spinner le temps du rechargement
        // (window.location.reload() n'est pas synchrone, il faut un état intermédiaire)
        setTimeout(() => window.location.reload(), 0);
        return { error, autoReloading: true };
      }
    }
    return { error, autoReloading: false };
  }

  private handleClearAndReload = () => {
    clearDataCache();
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    window.location.reload();
  };

  private handleReload = () => {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    window.location.reload();
  };

  private handleLogout = () => {
    clearDataCache();
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    fetch("/api/logout", { method: "POST", credentials: "include" })
      .catch(() => {})
      .finally(() => window.location.reload());
  };

  render() {
    const { error, autoReloading } = this.state;

    if (!error) return this.props.children;

    if (autoReloading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-sky-50 dark:bg-slate-950">
          <div className="h-6 w-6 rounded-full border-2 border-sky-300 dark:border-sky-700 border-t-sky-600 dark:border-t-sky-300 animate-spin" />
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-sky-50 dark:bg-slate-950 px-4 text-center">
        <div className="max-w-sm space-y-4">
          <p className="text-slate-700 dark:text-slate-200">
            Une erreur inattendue est survenue. Si le problème persiste, vide le cache pour repartir sur des données propres.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center flex-wrap">
            <button
              onClick={this.handleClearAndReload}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-700 dark:bg-sky-700 dark:hover:bg-sky-600"
            >
              Vider le cache et recharger
            </button>
            <button
              onClick={this.handleReload}
              className="rounded-md border border-sky-300 dark:border-sky-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-slate-700"
            >
              Recharger seulement
            </button>
            <button
              onClick={this.handleLogout}
              className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              Se déconnecter
            </button>
          </div>
        </div>
      </div>
    );
  }
}
