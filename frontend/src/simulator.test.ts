import { describe, expect, it } from "vitest";
import type { Evaluation, ModuleEntry, Releve, Ue } from "./types";
import {
  countEvaluations,
  evaluationWeightInModule,
  fmt,
  moduleAggregate,
  moduleWeightInUe,
  moyenneGenerale,
  moyenneProgression,
  newlyPublishedIds,
  numericNoteValue,
  pendingItems,
  round2,
  solveUniformTarget,
  toNumber,
  ueMoyenne,
  ueWeightInGlobal,
} from "./simulator";

function makeEvaluation(
  id: number,
  value: number | string | null,
  coef: number | string = 1,
  moy = 10,
  min = 5,
  max = 18
): Evaluation {
  return { id, description: `Eval ${id}`, coef, note: { value, moy, min, max }, poids: {} };
}

function makeModule(titre: string, evaluations: Evaluation[]): ModuleEntry {
  return { titre, moyenne: { value: null }, evaluations };
}

/** Petit relevé fixe à deux UE (A : un module à deux évaluations, B : un module à une évaluation). */
function makeReleve(): Releve {
  const modA = makeModule("Module A", [makeEvaluation(1, 16, 1, 10, 2, 19), makeEvaluation(2, 12, 1, 8, 1, 20)]);
  const modB = makeModule("Module B", [makeEvaluation(3, 8, 2)]);
  const ueA: Ue = {
    numero: 1,
    type: 0,
    titre: "UE A",
    moyenne: { value: 14 },
    ECTS: { acquis: 5, total: 5 },
    ressources: { MODA: { moyenne: null, coef: 1 } },
  };
  const ueB: Ue = {
    numero: 2,
    type: 0,
    titre: "UE B",
    moyenne: { value: 8 },
    ECTS: { acquis: 0, total: 3 },
    ressources: { MODB: { moyenne: null, coef: 1 } },
  };
  return {
    etudiant: { nom: "Doe", prenom: "Jane" },
    formation: { titre: "BUT Info" },
    semestre: { numero: 1, notes: { value: 12 }, rang: { value: 5, total: 30 } },
    ues: { A: ueA, B: ueB },
    ues_capitalisees: {},
    ressources: { MODA: modA, MODB: modB },
    saes: {},
  };
}

describe("toNumber / numericNoteValue", () => {
  it("tolère les champs renvoyés en string par l'API ScoDoc", () => {
    expect(toNumber("01.00")).toBe(1);
    expect(toNumber("abc", 5)).toBe(5);
    expect(numericNoteValue("12.5")).toBe(12.5);
    expect(numericNoteValue(null)).toBeNull();
  });
});

describe("moduleAggregate", () => {
  it("calcule la moyenne et la moy. de classe pondérées, jamais de min/max agrégé", () => {
    const mod = makeModule("M", [makeEvaluation(1, 16, 1, 10, 2, 19), makeEvaluation(2, 12, 1, 8, 1, 20)]);
    const agg = moduleAggregate(mod, "ressources", "MOD", {});
    expect(agg.value).toBeCloseTo(14);
    expect(agg.moy).toBeCloseTo(9);
    // cf. fix : un min/max agrégé par moyenne pondérée serait statistiquement faux
    // (les extrêmes de chaque évaluation ne sont presque jamais portés par le même élève).
    expect(agg.min).toBeNull();
    expect(agg.max).toBeNull();
  });

  it("applique les surcharges de simulation", () => {
    const mod = makeModule("M", [makeEvaluation(1, null, 1)]);
    const agg = moduleAggregate(mod, "ressources", "MOD", { "ressources-MOD-0": 18 });
    expect(agg.value).toBe(18);
  });

  it("utilise la saisie manuelle quand le module n'a aucune évaluation", () => {
    const mod = makeModule("M", []);
    const agg = moduleAggregate(mod, "ressources", "MOD", { "ressources-MOD-manual": 15 });
    expect(agg.value).toBe(15);
  });
});

describe("ueMoyenne / moyenneGenerale", () => {
  it("agrège une UE à partir de ses modules", () => {
    const releve = makeReleve();
    expect(ueMoyenne(releve.ues.A, releve, {})).toBeCloseTo(14);
  });

  it("ajoute le bonus (et soustrait le malus) de l'UE à la moyenne recalculée", () => {
    const releve = makeReleve();
    releve.ues.A.bonus = 0.5;
    expect(ueMoyenne(releve.ues.A, releve, {})).toBeCloseTo(14.5);
    releve.ues.A.malus = 1;
    expect(ueMoyenne(releve.ues.A, releve, {})).toBeCloseTo(13.5);
  });

  it("plafonne la moyenne ajustée du bonus à 20", () => {
    const releve = makeReleve();
    releve.ues.A.bonus = 10;
    expect(ueMoyenne(releve.ues.A, releve, {})).toBe(20);
  });

  it("pondère la moyenne générale par les ECTS de chaque UE", () => {
    const releve = makeReleve();
    const moyennes = { A: ueMoyenne(releve.ues.A, releve, {}), B: ueMoyenne(releve.ues.B, releve, {}) };
    // A : moy 14, poids 5 ECTS ; B : moy 8, poids 3 ECTS -> (14*5 + 8*3) / 8 = 11.75
    expect(moyenneGenerale(releve.ues, moyennes)).toBeCloseTo(11.75);
  });
});

describe("pendingItems / newlyPublishedIds", () => {
  it("liste les évaluations sans note publiée", () => {
    const releve = makeReleve();
    releve.ressources.MODA.evaluations[1].note.value = null;
    const keys = pendingItems(releve).map((p) => p.key);
    expect(keys).toContain("ressources-MODA-1");
  });

  it("détecte les évaluations passées de 'pas de note' à 'notée'", () => {
    const previous = makeReleve();
    previous.ressources.MODA.evaluations[1].note.value = null;
    const current = makeReleve();
    const ids = newlyPublishedIds(previous, current);
    expect(ids.has(2)).toBe(true);
    expect(ids.has(1)).toBe(false);
  });
});

describe("solveUniformTarget", () => {
  it("trouve la note uniforme nécessaire pour atteindre un objectif", () => {
    const releve = makeReleve();
    releve.ressources.MODB.evaluations[0].note.value = null;
    const evaluate = (o: Record<string, number>) => ueMoyenne(releve.ues.B, releve, o);
    const solution = solveUniformTarget({}, ["ressources-MODB-0"], 10, evaluate);
    expect(solution.x).toBeCloseTo(10);
  });

  it("signale un objectif déjà acquis", () => {
    const solution = solveUniformTarget({}, [], 10, () => 15);
    expect(solution.alreadyMet).toBe(true);
  });

  it("signale un objectif hors de portée même à 20/20", () => {
    const releve = makeReleve();
    releve.ressources.MODB.evaluations[0].note.value = null;
    const evaluate = (o: Record<string, number>) => ueMoyenne(releve.ues.B, releve, o);
    const solution = solveUniformTarget({}, ["ressources-MODB-0"], 21, evaluate);
    expect(solution.unreachable).toBe(true);
    expect(solution.x).toBe(20);
  });
});

describe("poids (UE / module / évaluation)", () => {
  it("poids d'une UE dans la moyenne générale, proportionnel à ses ECTS", () => {
    const releve = makeReleve();
    expect(ueWeightInGlobal("A", releve.ues)).toBeCloseTo((5 / 8) * 100);
  });

  it("poids d'un module dans son UE, proportionnel à son coef", () => {
    const releve = makeReleve();
    expect(moduleWeightInUe(releve.ues.A, "ressources", "MODA")).toBe(100);
  });

  it("poids d'une évaluation dans son module, proportionnel à son coef", () => {
    const mod = makeModule("M", [makeEvaluation(1, 10, 1), makeEvaluation(2, 10, 3)]);
    expect(evaluationWeightInModule(mod, 0)).toBeCloseTo(25);
    expect(evaluationWeightInModule(mod, 1)).toBeCloseTo(75);
  });
});

describe("fmt / round2", () => {
  it("formate une valeur nulle par un tiret et arrondit à 2 décimales", () => {
    expect(fmt(null)).toBe("—");
    expect(fmt(12.345)).toBe("12.35");
    expect(round2(12.345)).toBeCloseTo(12.35);
    expect(round2(null)).toBeNull();
  });
});

describe("poids des évaluations dans une UE", () => {
  /** Un module à deux évaluations, alimentant deux UE avec des poids différents. */
  function makeReleveAvecPoids(): Releve {
    const e1 = { ...makeEvaluation(1, 18, 1), poids: { A: 3, B: 1 } };
    const e2 = { ...makeEvaluation(2, 6, 1), poids: { A: 1, B: 3 } };
    const mod = makeModule("Module partagé", [e1, e2]);
    const ue = (numero: number): Ue => ({
      numero,
      type: 0,
      moyenne: { value: null },
      ECTS: { acquis: 0, total: 5 },
      ressources: { MOD: { moyenne: null, coef: 1 } },
    });
    return {
      etudiant: { nom: "Doe", prenom: "Jane" },
      formation: { titre: "BUT R&T" },
      semestre: { numero: 1, notes: { value: null }, rang: { value: 1, total: 10 } },
      ues: { A: ue(1), B: ue(2) },
      ues_capitalisees: {},
      ressources: { MOD: mod },
      saes: {},
    };
  }

  it("pondère chaque évaluation par coef × poids de l'UE", () => {
    const releve = makeReleveAvecPoids();
    // UE A : (18×3 + 6×1) / 4 = 15 ; UE B : (18×1 + 6×3) / 4 = 9
    expect(ueMoyenne(releve.ues.A, releve, {}, "A")).toBeCloseTo(15);
    expect(ueMoyenne(releve.ues.B, releve, {}, "B")).toBeCloseTo(9);
  });

  it("sans code d'UE, retombe sur la pondération par coefficient seul", () => {
    const releve = makeReleveAvecPoids();
    expect(ueMoyenne(releve.ues.A, releve, {})).toBeCloseTo(12); // (18 + 6) / 2
  });

  it("ignore une matrice de poids absente (relevés sans le champ)", () => {
    const releve = makeReleve();
    expect(ueMoyenne(releve.ues.A, releve, {}, "A")).toBeCloseTo(14);
  });

  it("retombe sur les coefficients si toutes les évaluations ont un poids nul dans l'UE", () => {
    const releve = makeReleveAvecPoids();
    releve.ressources.MOD.evaluations.forEach((e) => (e.poids = { A: 0, B: 1 }));
    expect(ueMoyenne(releve.ues.A, releve, {}, "A")).toBeCloseTo(12);
  });
});

describe("countEvaluations", () => {
  it("compte les évaluations de toutes les ressources et SAÉ", () => {
    expect(countEvaluations(makeReleve())).toBe(3);
  });

  it("vaut 0 sur un semestre créé mais pas encore démarré", () => {
    const releve = makeReleve();
    releve.ressources.MODA.evaluations = [];
    releve.ressources.MODB.evaluations = [];
    expect(countEvaluations(releve)).toBe(0);
    expect(countEvaluations(null)).toBe(0);
  });
});

describe("moyenneProgression", () => {
  it("recalcule la moyenne à chaque date de publication", () => {
    const releve = makeReleve();
    // Éval 1 (16) découverte le 1er, éval 3 (8) le 5 ; l'éval 2 n'est pas datée, donc
    // considérée connue depuis toujours.
    const points = moyenneProgression(releve, { 1: "2026-03-01T09:00:00Z", 3: "2026-03-05T09:00:00Z" });

    expect(points.map((p) => p.date)).toEqual(["2026-03-01", "2026-03-05"]);
    // Au 1er : UE A = (16+12)/2 = 14, UE B sans note -> moyenne générale = 14
    expect(points[0].moyenne).toBeCloseTo(14);
    // Au 5 : UE A = 14 (5 ECTS), UE B = 8 (3 ECTS) -> (14×5 + 8×3) / 8 = 11.75
    expect(points[1].moyenne).toBeCloseTo(11.75);
  });

  it("ne renvoie rien tant qu'une seule vague de notes est datée", () => {
    expect(moyenneProgression(makeReleve(), { 1: "2026-03-01T09:00:00Z" })).toEqual([]);
    expect(moyenneProgression(makeReleve(), {})).toEqual([]);
  });
});
