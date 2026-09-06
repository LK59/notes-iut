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
 * sans rien afficher, d'où l'écran blanc signalé sur iOS Safari.
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
    fetch("/api/logout", {
      method: "POST",
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    })
      .catch(() => {})
      .finally(() => window.location.reload());
  };

  render() {
    const { error, autoReloading, chunkReloadFailed } = this.state;

    if (!error) return this.props.children;

    if (autoReloading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-canvas">
          <div className="h-5 w-5 rounded-full border-2 border-line-strong border-t-accent animate-spin" />
        </div>
      );
    }

    const buttonBase =
      "w-full rounded-lg border px-4 py-2 text-sm font-medium transition-colors";

    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 space-y-4 text-center">
          <p className="text-sm text-fg">
            {chunkReloadFailed
              ? "Une nouvelle version de l'app est disponible. Recharge pour récupérer les derniers fichiers."
              : "Une erreur inattendue est survenue. Tu peux recharger, vider les données locales de cet appareil, ou te reconnecter."}
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={this.handleReload}
              className={`${buttonBase} border-transparent bg-accent text-accent-fg hover:bg-accent-hover`}
            >
              Recharger
            </button>
            <button
              onClick={this.handleClearAndReload}
              className={`${buttonBase} border-line-strong bg-surface text-fg hover:bg-inset`}
            >
              Vider les données locales
            </button>
            <button
              onClick={this.handleLogout}
              className={`${buttonBase} border-transparent text-muted hover:bg-inset`}
            >
              Se déconnecter
            </button>
          </div>
        </div>
      </div>
    );
  }
}
