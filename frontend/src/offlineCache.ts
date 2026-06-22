const PREFIX = "notes-iut-cache:";

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
