import { Component, type ReactNode } from "react";
import { isChunkLoadError, recoverFromChunkLoadError, resetChunkRecoveryState } from "../chunkRecovery";
import { clearDataCache } from "../offlineCache";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  autoReloading: boolean;
  chunkReloadFailed: boolean;
}

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
  state: State = { error: null, autoReloading: false, chunkReloadFailed: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    if (isChunkLoadError(error)) {
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
        const reloading = recoverFromChunkLoadError(null, error);
        return { error, autoReloading: reloading, chunkReloadFailed: !reloading };
      }
      return { error, autoReloading: false, chunkReloadFailed: true };
    }
    return { error, autoReloading: false, chunkReloadFailed: false };
  }

  private handleClearAndReload = () => {
    clearDataCache();
    resetChunkRecoveryState();
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    window.location.reload();
  };

  private handleReload = () => {
    resetChunkRecoveryState();
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    window.location.reload();
  };

  private handleLogout = () => {
    clearDataCache();
    resetChunkRecoveryState();
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    fetch("/api/logout", { method: "POST", credentials: "include" })
      .catch(() => {})
      .finally(() => window.location.reload());
  };

  render() {
    const { error, autoReloading, chunkReloadFailed } = this.state;

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
            {chunkReloadFailed
              ? "Une nouvelle version de l'application est disponible. Recharge pour récupérer les derniers fichiers."
              : "Une erreur inattendue est survenue. Tu peux recharger, vider les donnees locales de cet appareil, ou te reconnecter."}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center flex-wrap">
            <button
              onClick={this.handleClearAndReload}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-700 dark:bg-sky-700 dark:hover:bg-sky-600"
            >
              Vider les donnees locales
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
