const PREFIX = "notes-iut-cache:";
const SIM_PREFIX = "notes-iut-sim:";
const VERSION_KEY = "notes-iut-cache-version";
// À incrémenter chaque fois que le format des données mises en cache change (nouveaux champs,
// nouvelle façon de calculer les agrégats...) : ça force tous les clients à repartir d'un cache
// vide au lieu de réutiliser une structure périmée potentiellement incompatible.
const CURRENT_VERSION = "2";

/** Cache localStorage best-effort : ne doit jamais faire planter l'appelant (quota, mode privé...). */
export function cacheSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // best effort
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
 * brièvement chez le suivant. On vide tout à la déconnexion explicite (sauf les identifiants
 * "se souvenir de moi", qui ont leur propre cycle de vie géré séparément).
 */
export function clearCache(prefixes: string[] = [PREFIX]): void {
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
 * À appeler une fois au démarrage de l'app. Si la version de cache stockée ne correspond pas
 * à CURRENT_VERSION (premier chargement après ce déploi), on vide le cache hors-ligne et les
 * simulations en cours de tous les clients, puis on enregistre la nouvelle version — évite que
 * d'anciennes données mises en cache avant un changement de format ne refassent surface.
 */
export function ensureCacheVersion(): void {
  try {
    if (localStorage.getItem(VERSION_KEY) !== CURRENT_VERSION) {
      clearCache([PREFIX, SIM_PREFIX]);
      localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
    }
    // Migration : supprime l'ancienne entrée de credentials en clair (remplacée par cookie serveur)
    localStorage.removeItem("notes-iut-remember");
  } catch {
    // best effort
  }
}

/** Vide toutes les données mises en cache (relevés + simulations) sans toucher aux identifiants mémorisés. */
export function clearDataCache(): void {
  clearCache([PREFIX, SIM_PREFIX]);
}
