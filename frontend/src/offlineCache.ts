const PREFIX = "notes-iut-cache:";
const SIM_PREFIX = "notes-iut-sim:";
const HISTORY_PREFIX = "notes-iut-history:";
const VERSION_KEY = "notes-iut-cache-version";

/**
 * Tout ce qui, dans le stockage local, contient des données propres à un compte.
 *
 * Cette liste est la source unique de vérité : elle existe parce que la déconnexion
 * n'énumérait auparavant que deux préfixes sur trois, et laissait donc l'historique
 * des notes (libellés ET valeurs) du compte précédent visible pour le suivant sur un
 * appareil partagé. Ajouter un nouveau préfixe de données ici suffit désormais à ce
 * qu'il soit effacé partout où il doit l'être.
 */
export const USER_DATA_PREFIXES = [PREFIX, SIM_PREFIX, HISTORY_PREFIX];

/**
 * Caches du service worker contenant des réponses propres à un compte.
 * Le backend envoie `Cache-Control: private, no-store` sur /api/, mais un service
 * worker ne l'applique pas : ces caches doivent être supprimés explicitement.
 */
const USER_SW_CACHES = ["api-data", "api-photo"];

// À incrémenter chaque fois que le format des données mises en cache change (nouveaux champs,
// nouvelle façon de calculer les agrégats...) : ça force tous les clients à repartir d'un cache
// vide au lieu de réutiliser une structure périmée potentiellement incompatible.
const CURRENT_VERSION = "3";

function isQuotaExceeded(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

/**
 * Cache localStorage best-effort : ne doit jamais faire planter l'appelant (quota, mode privé...).
 * Si le quota est dépassé, on sacrifie les autres entrées en cache (moins utiles que la donnée
 * qu'on est justement en train d'écrire, typiquement le relevé du semestre consulté) et on
 * retente une fois, plutôt que d'abandonner silencieusement l'écriture.
 */
export function cacheSet(key: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  try {
    localStorage.setItem(PREFIX + key, serialized);
  } catch (err) {
    if (!isQuotaExceeded(err)) return;
    clearCache([PREFIX]);
    try {
      localStorage.setItem(PREFIX + key, serialized);
    } catch {
      // best effort : toujours pas de place (mode privé très restreint, quota déjà minimal...)
    }
  }
}

export function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Sur un appareil partagé, deux étudiants du même groupe ont le même identifiant de semestre
 * ScoDoc : sans ça, le cache hors-ligne (et la simulation) d'un utilisateur pourrait apparaître
 * chez le suivant. On vide tout à la déconnexion explicite (sauf les identifiants "se souvenir
 * de moi", qui ont leur propre cycle de vie géré côté serveur).
 */
export function clearCache(prefixes: string[] = USER_DATA_PREFIXES): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && prefixes.some((p) => key.startsWith(p))) localStorage.removeItem(key);
    }
  } catch {
    // best effort
  }
}

/**
 * Supprime les réponses /api mises en cache par le service worker (relevés, photo).
 * Appelé à la déconnexion, en complément de clearCache() : sans ça, la photo et le
 * relevé du compte précédent étaient resservis avant le premier appel réseau du suivant.
 */
export async function clearServiceWorkerCaches(): Promise<void> {
  try {
    if (!("caches" in window)) return;
    await Promise.all(USER_SW_CACHES.map((name) => caches.delete(name)));
  } catch {
    // best effort — le cache SW peut être indisponible (mode privé, permissions)
  }
}

/**
 * À appeler une fois au démarrage de l'app. Si la version de cache stockée ne correspond pas
 * à CURRENT_VERSION (premier chargement après ce déploi), on vide le cache hors-ligne et les
 * simulations en cours de tous les clients, puis on enregistre la nouvelle version — évite que
 * d'anciennes données mises en cache avant un changement de format ne refassent surface.
 */
export function ensureCacheVersion(): void {
  try {
    if (localStorage.getItem(VERSION_KEY) !== CURRENT_VERSION) {
      clearCache();
      void clearServiceWorkerCaches();
      localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
    }
    // Migration : supprime l'ancienne entrée de credentials en clair (remplacée par cookie serveur)
    localStorage.removeItem("notes-iut-remember");
  } catch {
    // best effort
  }
}

/** Vide toutes les données mises en cache (relevés, simulations, historique) sans toucher
 * aux identifiants mémorisés côté serveur. */
export function clearDataCache(): void {
  clearCache();
  void clearServiceWorkerCaches();
}
