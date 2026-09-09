import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  USER_DATA_PREFIXES,
  cacheGet,
  cacheSet,
  clearCache,
  clearServiceWorkerCaches,
  ensureCacheVersion,
} from "./offlineCache";

/**
 * localStorage minimal : l'ordre d'insertion et key(i) comptent, parce que clearCache()
 * itère à l'envers en supprimant au passage (une itération croissante sauterait une clé
 * sur deux).
 */
class FakeStorage {
  private map = new Map<string, string>();
  quotaExceededOnNextSet = false;

  get length() {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.quotaExceededOnNextSet) {
      this.quotaExceededOnNextSet = false;
      throw new DOMException("plein", "QuotaExceededError");
    }
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Un appareil partagé, tel qu'il est après usage : données de compte + préférences. */
function remplirCommeUnCompteConnecte() {
  storage.setItem("notes-iut-cache:releve-12", '{"note":18}');
  storage.setItem("notes-iut-cache:semestres", '{"semestres":[]}');
  storage.setItem("notes-iut-sim:12", '{"eval-3":"15"}');
  storage.setItem("notes-iut-history:12", '[{"id":3,"value":"15"}]');
  storage.setItem("notes-iut-theme", "dark");
  storage.setItem("notes-iut-view", "detaille");
}

describe("purge des données de compte", () => {
  it("efface les trois préfixes de données utilisateur", () => {
    // Préfixes en dur, pas USER_DATA_PREFIXES : un test qui filtre avec la constante qu'il
    // vérifie passe encore quand on retire un préfixe de cette constante.
    remplirCommeUnCompteConnecte();
    clearCache();
    const restant = storage
      .keys()
      .filter((k) => ["notes-iut-cache:", "notes-iut-sim:", "notes-iut-history:"].some((p) => k.startsWith(p)));
    expect(restant).toEqual([]);
    expect(USER_DATA_PREFIXES).toEqual(["notes-iut-cache:", "notes-iut-sim:", "notes-iut-history:"]);
  });

  it("n'oublie pas l'historique des notes", () => {
    // Régression : la déconnexion n'énumérait que deux préfixes sur trois, et laissait donc
    // les libellés ET les valeurs des notes du compte précédent au suivant.
    remplirCommeUnCompteConnecte();
    clearCache();
    expect(storage.getItem("notes-iut-history:12")).toBeNull();
  });

  it("conserve les préférences d'affichage, qui ne sont pas des données de compte", () => {
    remplirCommeUnCompteConnecte();
    clearCache();
    expect(storage.getItem("notes-iut-theme")).toBe("dark");
    expect(storage.getItem("notes-iut-view")).toBe("detaille");
  });

  it("supprime toutes les entrées d'un préfixe, pas une sur deux", () => {
    // clearCache() itère en supprimant : un parcours croissant décalerait les index.
    for (let i = 0; i < 6; i++) storage.setItem(`notes-iut-cache:releve-${i}`, "{}");
    clearCache();
    expect(storage.length).toBe(0);
  });

  it("ne touche qu'aux préfixes demandés quand on en passe une liste", () => {
    remplirCommeUnCompteConnecte();
    clearCache(["notes-iut-sim:"]);
    expect(storage.getItem("notes-iut-sim:12")).toBeNull();
    expect(storage.getItem("notes-iut-cache:releve-12")).not.toBeNull();
  });
});

describe("écriture best effort", () => {
  it("sacrifie le cache et retente une fois quand le quota est dépassé", () => {
    storage.setItem("notes-iut-cache:vieux", "x".repeat(50));
    storage.quotaExceededOnNextSet = true;
    cacheSet("releve-12", { note: 18 });
    expect(cacheGet("releve-12")).toEqual({ note: 18 });
    expect(storage.getItem("notes-iut-cache:vieux")).toBeNull();
  });

  it("ne propage pas l'erreur si le stockage est indisponible", () => {
    vi.stubGlobal("localStorage", {
      get length(): number {
        throw new Error("mode privé");
      },
      getItem() {
        throw new Error("mode privé");
      },
      setItem() {
        throw new Error("mode privé");
      },
      removeItem() {
        throw new Error("mode privé");
      },
      key() {
        throw new Error("mode privé");
      },
    });
    expect(() => cacheSet("releve-12", { note: 18 })).not.toThrow();
    expect(() => clearCache()).not.toThrow();
    expect(cacheGet("releve-12")).toBeNull();
  });

  it("renvoie null plutôt que de planter sur une entrée corrompue", () => {
    storage.setItem("notes-iut-cache:releve-12", "{ pas du json");
    expect(cacheGet("releve-12")).toBeNull();
  });
});

describe("caches du service worker", () => {
  it("supprime les caches contenant des réponses de compte", async () => {
    const supprimes: string[] = [];
    vi.stubGlobal("window", { caches: true });
    vi.stubGlobal("caches", {
      delete: (name: string) => {
        supprimes.push(name);
        return Promise.resolve(true);
      },
    });
    await clearServiceWorkerCaches();
    expect(supprimes.sort()).toEqual(["api-data", "api-photo"]);
  });

  it("ne rejette pas quand l'API caches est indisponible", async () => {
    vi.stubGlobal("window", {});
    await expect(clearServiceWorkerCaches()).resolves.toBeUndefined();
  });
});

describe("version de cache", () => {
  it("vide les données de compte quand le format a changé", () => {
    remplirCommeUnCompteConnecte();
    vi.stubGlobal("window", {});
    ensureCacheVersion();
    expect(storage.getItem("notes-iut-cache:releve-12")).toBeNull();
    expect(storage.getItem("notes-iut-theme")).toBe("dark");
  });

  it("ne vide rien au chargement suivant", () => {
    vi.stubGlobal("window", {});
    ensureCacheVersion();
    remplirCommeUnCompteConnecte();
    ensureCacheVersion();
    expect(storage.getItem("notes-iut-cache:releve-12")).not.toBeNull();
  });

  it("supprime l'ancienne entrée d'identifiants en clair", () => {
    storage.setItem("notes-iut-remember", '{"username":"etu","password":"secret"}');
    vi.stubGlobal("window", {});
    ensureCacheVersion();
    expect(storage.getItem("notes-iut-remember")).toBeNull();
  });
});
