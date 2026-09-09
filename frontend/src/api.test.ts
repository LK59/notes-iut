import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HttpError,
  getSemestres,
  isNetworkFailure,
  request,
  setCacheFallbackHandler,
  setUnauthorizedHandler,
} from "./api";

type Appel = { path: string; init?: RequestInit };

/** Réponse de fetch minimale : request() ne lit que ok, status et json(). */
function reponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

let appels: Appel[];

/** Enchaîne des réponses dans l'ordre ; la dernière est réutilisée si on dépasse. */
function stubFetch(reponses: Array<Response | (() => Response | Promise<Response>)>) {
  let i = 0;
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    appels.push({ path, init });
    const suivante = reponses[Math.min(i, reponses.length - 1)];
    i++;
    return Promise.resolve(typeof suivante === "function" ? suivante() : suivante);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Récupère l'erreur d'une promesse rejetée, typée : `.catch((e) => e)` donne `unknown`. */
async function erreurDe(promesse: Promise<unknown>): Promise<HttpError> {
  try {
    await promesse;
    throw new Error("la promesse aurait dû être rejetée");
  } catch (err) {
    return err as HttpError;
  }
}

/** Le couple POST /api/xxx + poll de statut que fait pollAuthJob. */
function reauthReussie(): Response[] {
  return [reponse(200, { job_id: "job-1" }), reponse(200, { status: "ok", username: "etu" })];
}

/** localStorage et navigator sont absents en environnement node : les stubber ici évite
 * de tirer jsdom (et ses ~10 Mo) dans la CI pour de la logique qui n'a pas de DOM. */
function stubEnvironnementNavigateur(onLine = true) {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  vi.stubGlobal("navigator", { onLine });
}

beforeEach(() => {
  appels = [];
  setUnauthorizedHandler(null);
  setCacheFallbackHandler(null);
  stubEnvironnementNavigateur();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
  setCacheFallbackHandler(null);
});

describe("en-têtes et enveloppe d'erreur", () => {
  it("envoie l'en-tête anti-CSRF attendu par le backend sur toute requête", async () => {
    stubFetch([reponse(200, { ok: true })]);
    await request("/api/me");
    const headers = appels[0].init?.headers as Record<string, string>;
    expect(headers["X-Requested-With"]).toBe("XMLHttpRequest");
    expect(appels[0].init?.credentials).toBe("include");
  });

  it("remonte le code d'erreur métier du backend, que le client teste", async () => {
    stubFetch([
      reponse(502, {
        detail: "…",
        error: { code: "SCODOC_INVALID_RESPONSE", message: "Réponse invalide.", retryable: true },
      }),
    ]);
    const err = await erreurDe(request("/api/semestres"));
    expect(err).toBeInstanceOf(HttpError);
    expect(err.code).toBe("SCODOC_INVALID_RESPONSE");
    expect(err.retryable).toBe(true);
    expect(err.message).toBe("Réponse invalide.");
  });

  it("distingue une panne réseau d'une réponse du serveur", async () => {
    stubFetch([reponse(500, {})]);
    const httpErr = await erreurDe(request("/api/me"));
    expect(isNetworkFailure(httpErr)).toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch")))
    );
    const netErr = await erreurDe(request("/api/me"));
    expect(isNetworkFailure(netErr)).toBe(true);
  });

  it("transforme un abandon pour délai dépassé en panne réseau explicite", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new DOMException("aborted", "AbortError")))
    );
    const err = await erreurDe(request("/api/me"));
    expect(isNetworkFailure(err)).toBe(true);
    expect(err.message).toMatch(/Délai dépassé/);
  });
});

describe("reconnexion silencieuse sur 401", () => {
  it("rejoue la requête une fois après une reconnexion réussie", async () => {
    stubFetch([reponse(401, {}), ...reauthReussie(), reponse(200, { ok: true })]);
    await expect(request("/api/semestres")).resolves.toEqual({ ok: true });
    expect(appels.map((a) => a.path)).toEqual([
      "/api/semestres",
      "/api/refresh",
      "/api/refresh/status",
      "/api/semestres",
    ]);
  });

  it("ne boucle pas quand la requête rejouée renvoie encore 401", async () => {
    // Régression : sans le drapeau `retried`, un jeton rejouable relançait la reconnexion
    // à chaque tentative et l'app restait bloquée au rechargement.
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubFetch([reponse(401, {}), ...reauthReussie(), reponse(401, {})]);

    await expect(request("/api/semestres")).rejects.toBeInstanceOf(HttpError);
    expect(appels.filter((a) => a.path === "/api/refresh")).toHaveLength(1);
    expect(appels.filter((a) => a.path === "/api/semestres")).toHaveLength(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("signale la session expirée quand la reconnexion échoue", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubFetch([reponse(401, {}), reponse(401, {})]);

    await expect(request("/api/semestres")).rejects.toBeInstanceOf(HttpError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("ne tente pas de reconnexion sur les routes d'authentification elles-mêmes", async () => {
    // /api/refresh EST le mécanisme de reconnexion, et un 401 sur /api/login/status veut dire
    // « identifiants invalides » : relancer une reconnexion là-dessus part en boucle.
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    for (const chemin of ["/api/login", "/api/refresh", "/api/login/status", "/api/refresh/status"]) {
      appels = [];
      stubFetch([reponse(401, {})]);
      await expect(request(chemin, { method: "POST" })).rejects.toBeInstanceOf(HttpError);
      expect(appels).toHaveLength(1);
    }
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("mutualise une seule reconnexion pour deux requêtes échouées en parallèle", async () => {
    let refreshs = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) => {
        if (path === "/api/refresh") {
          refreshs++;
          return Promise.resolve(reponse(200, { job_id: "job-1" }));
        }
        if (path === "/api/refresh/status") return Promise.resolve(reponse(200, { status: "ok", username: "etu" }));
        return Promise.resolve(refreshs > 0 ? reponse(200, { ok: true }) : reponse(401, {}));
      })
    );
    await Promise.all([request("/api/semestres"), request("/api/releve/12")]);
    expect(refreshs).toBe(1);
  });
});

describe("normalisation des semestres", () => {
  const payload = {
    semestres: [
      { formsemestre_id: 200, semestre_id: 1, annee_scolaire: "2025-2026", titre: "S1" },
      { formsemestre_id: 100, semestre_id: 5, annee_scolaire: "2024-2025", titre: "S5" },
      { formsemestre_id: 150, semestre_id: 6, annee_scolaire: "2024-2025", titre: "S6" },
    ],
    etudiant: { nom: "X", prenom: "Y" },
  };

  it("convertit formsemestre_id en chaîne à la frontière de l'API", async () => {
    // ScoDoc renvoie un nombre ; tout le client compare des chaînes (valeur de <select>,
    // segment d'URL, clé de cache). Une comparaison === ratée passait inaperçue.
    stubFetch([reponse(200, payload)]);
    const data = await getSemestres();
    expect(data.semestres.map((s) => s.formsemestre_id)).toEqual(["100", "150", "200"]);
    expect(data.semestres.every((s) => typeof s.formsemestre_id === "string")).toBe(true);
  });

  it("trie par année scolaire puis par numéro de semestre", async () => {
    // Le « semestre courant » est le dernier de la liste : l'ordre du portail n'est pas
    // garanti (réinscription, redoublement, changement de formation).
    stubFetch([reponse(200, payload)]);
    const data = await getSemestres();
    expect(data.semestres.map((s) => s.titre)).toEqual(["S5", "S6", "S1"]);
  });

  it("rejette un relevé de semestres qui n'a pas la forme attendue", async () => {
    stubFetch([reponse(200, { pas: "le bon format" })]);
    const err = await erreurDe(getSemestres());
    expect(err).toBeInstanceOf(HttpError);
    expect(err.code).toBe("SCODOC_INVALID_RESPONSE");
  });
});

describe("repli sur le cache hors-ligne", () => {
  const payload = {
    semestres: [{ formsemestre_id: 100, semestre_id: 5, annee_scolaire: "2024-2025", titre: "S5" }],
    etudiant: { nom: "X", prenom: "Y" },
  };

  it("sert les dernières données connues et signale « hors ligne » quand le réseau tombe", async () => {
    const raisons: (string | null)[] = [];
    setCacheFallbackHandler((r) => raisons.push(r));

    stubFetch([reponse(200, payload)]);
    await getSemestres(); // amorce le cache
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch")))
    );

    const data = await getSemestres();
    expect(data.semestres[0].titre).toBe("S5");
    expect(raisons).toEqual([null, "offline"]);
  });

  it("distingue un ScoDoc en panne d'une coupure réseau", async () => {
    // 502/503 est une réponse propre de notre backend : le repli sur cache est le même,
    // mais le bandeau doit dire « portail indisponible » et non « hors ligne ».
    const raisons: (string | null)[] = [];
    setCacheFallbackHandler((r) => raisons.push(r));

    stubFetch([reponse(200, payload)]);
    await getSemestres();
    stubFetch([reponse(503, { error: { code: "SCODOC_UNAVAILABLE", message: "Portail indisponible." } })]);

    await expect(getSemestres()).resolves.toBeTruthy();
    expect(raisons).toEqual([null, "scodoc_down"]);
  });

  it("laisse remonter l'erreur quand il n'y a rien en cache", async () => {
    stubFetch([reponse(503, { error: { code: "SCODOC_UNAVAILABLE", message: "Portail indisponible." } })]);
    await expect(getSemestres()).rejects.toBeInstanceOf(HttpError);
  });
});
