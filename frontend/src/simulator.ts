import type { Evaluation, ModuleEntry, NoteValue, Releve, Ue } from "./types";

/** ScoDoc renvoie ses champs numériques tantôt en number, tantôt en string ("01.00", "0.5"). */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/** Idem mais renvoie null (pas de fallback) : pour les notes, où "pas de valeur" doit rester distinct de 0. */
export function numericNoteValue(value: NoteValue["value"] | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** Rang officiel de l'étudiant dans l'UE (ScoDoc), quand l'UE n'est pas capitalisée. */
export function ueRang(ue: Ue): { rang: number; total: number } | null {
  const m = ue.moyenne;
  if (m && typeof m === "object") {
    const rang = numericNoteValue(m.rang ?? null);
    const total = numericNoteValue(m.total ?? null);
    if (rang !== null && total !== null) return { rang, total };
  }
  return null;
}

/** Clé d'override utilisée quand un module n'a encore aucune évaluation réelle (saisie manuelle pour simuler). */
export function manualKey(group: "ressources" | "saes", moduleCode: string): string {
  return `${group}-${moduleCode}-manual`;
}

/**
 * Moyenne + extrêmes agrégés. Le "min/moy/max classe" d'un module ou d'une UE est une
 * estimation : moyenne pondérée des min/moy/max de chaque évaluation/module qui le compose
 * (même pondération que pour la moyenne de l'élève). C'est une approximation raisonnable,
 * pas le vrai classement ScoDoc — on ne fabrique donc volontairement aucun "rang" à ce niveau,
 * qui lui ne peut pas être déduit honnêtement de simples bornes min/moy/max.
 */
export interface Agg {
  value: number | null;
  min: number | null;
  moy: number | null;
  max: number | null;
}

const EMPTY_AGG: Agg = { value: null, min: null, moy: null, max: null };

function weightedAggregate(items: { agg: Agg; weight: number }[]): Agg {
  const dims: (keyof Agg)[] = ["value", "min", "moy", "max"];
  const result = { ...EMPTY_AGG };
  for (const dim of dims) {
    let total = 0;
    let totalWeight = 0;
    for (const { agg, weight } of items) {
      const v = agg[dim];
      if (v === null || weight === 0) continue;
      total += v * weight;
      totalWeight += weight;
    }
    result[dim] = totalWeight === 0 ? null : total / totalWeight;
  }
  return result;
}

function evaluationAgg(evaluation: Evaluation, overrideValue: number | undefined): Agg {
  return {
    value: overrideValue ?? numericNoteValue(evaluation.note.value),
    min: numericNoteValue(evaluation.note.min),
    moy: numericNoteValue(evaluation.note.moy),
    max: numericNoteValue(evaluation.note.max),
  };
}

/** Agrégat (moyenne + extrêmes estimés) d'un module, recalculé à partir de ses évaluations. */
export function moduleAggregate(
  mod: ModuleEntry,
  group: "ressources" | "saes",
  moduleCode: string,
  overrides: Record<string, number>
): Agg {
  if (!mod.evaluations || mod.evaluations.length === 0) {
    const manual = overrides[manualKey(group, moduleCode)];
    return { ...EMPTY_AGG, value: manual ?? null };
  }
  const items = mod.evaluations.map((evaluation, idx) => {
    const key = `${group}-${moduleCode}-${idx}`;
    const overrideValue = key in overrides ? overrides[key] : undefined;
    return { agg: evaluationAgg(evaluation, overrideValue), weight: toNumber(evaluation.coef, 1) };
  });
  return weightedAggregate(items);
}

export function moduleMoyenne(
  mod: ModuleEntry,
  group: "ressources" | "saes",
  moduleCode: string,
  overrides: Record<string, number>
): number | null {
  return moduleAggregate(mod, group, moduleCode, overrides).value;
}

/** Agrégat (moyenne + extrêmes estimés) d'une UE, recalculé à partir des modules qui la composent. */
export function ueAggregate(ue: Ue, releve: Releve, overrides: Record<string, number>): Agg {
  const items: { agg: Agg; weight: number }[] = [];
  for (const [group, summaries] of [
    ["ressources", ue.ressources] as const,
    ["saes", ue.saes] as const,
  ]) {
    if (!summaries) continue;
    for (const [moduleCode, summary] of Object.entries(summaries)) {
      const mod = releve[group]?.[moduleCode];
      if (!mod) continue;
      items.push({ agg: moduleAggregate(mod, group, moduleCode, overrides), weight: toNumber(summary.coef, 1) });
    }
  }
  return weightedAggregate(items);
}

export function ueMoyenne(ue: Ue, releve: Releve, overrides: Record<string, number>): number | null {
  return ueAggregate(ue, releve, overrides).value;
}

/** Moyenne générale pondérée par les ECTS des UE (hors UE bonus/sport). */
export function moyenneGenerale(ues: Record<string, Ue>, ueMoyennes: Record<string, number | null>): number | null {
  let total = 0;
  let totalPoids = 0;
  for (const [code, ue] of Object.entries(ues)) {
    if (ue.type === 1) continue;
    const moyenne = ueMoyennes[code];
    if (moyenne === null || moyenne === undefined) continue;
    const poids = toNumber(ue.ECTS?.total, 1) || 1;
    total += moyenne * poids;
    totalPoids += poids;
  }
  if (totalPoids === 0) return null;
  return total / totalPoids;
}

/** Un module est "simulé" si au moins une de ses évaluations (ou sa saisie manuelle) est surchargée. */
export function moduleIsSimulated(
  mod: ModuleEntry,
  group: "ressources" | "saes",
  moduleCode: string,
  overrides: Record<string, number>
): boolean {
  if (!mod.evaluations || mod.evaluations.length === 0) {
    return manualKey(group, moduleCode) in overrides;
  }
  return mod.evaluations.some((_, idx) => `${group}-${moduleCode}-${idx}` in overrides);
}

/** Une UE est "simulée" si un de ses modules l'est. */
export function ueIsSimulated(ue: Ue, releve: Releve, overrides: Record<string, number>): boolean {
  for (const [group, summaries] of [
    ["ressources", ue.ressources] as const,
    ["saes", ue.saes] as const,
  ]) {
    if (!summaries) continue;
    for (const moduleCode of Object.keys(summaries)) {
      const mod = releve[group]?.[moduleCode];
      if (mod && moduleIsSimulated(mod, group, moduleCode, overrides)) return true;
    }
  }
  return false;
}

/** Toutes les évaluations (et modules sans évaluation) qui n'ont pas encore de note réelle. */
export interface PendingItem {
  key: string;
  ueLabel: string;
  moduleLabel: string;
  evalLabel: string;
}

export function pendingItems(releve: Releve): PendingItem[] {
  const out: PendingItem[] = [];
  const ueByModule: Record<string, string[]> = {};
  for (const [ueCode, ue] of Object.entries(releve.ues)) {
    if (ue.type === 1) continue;
    for (const group of ["ressources", "saes"] as const) {
      for (const moduleCode of Object.keys(ue[group] || {})) {
        (ueByModule[moduleCode] ??= []).push(ueCode);
      }
    }
  }

  for (const group of ["ressources", "saes"] as const) {
    const modules: Record<string, ModuleEntry> = releve[group] || {};
    for (const [moduleCode, mod] of Object.entries(modules)) {
      const ueLabel = (ueByModule[moduleCode] || []).join(", ") || "?";
      if (!mod.evaluations || mod.evaluations.length === 0) {
        out.push({
          key: manualKey(group, moduleCode),
          ueLabel,
          moduleLabel: `${moduleCode} — ${mod.titre}`,
          evalLabel: "Note non publiée",
        });
        continue;
      }
      mod.evaluations.forEach((evaluation, idx) => {
        if (numericNoteValue(evaluation.note.value) !== null) return;
        out.push({
          key: `${group}-${moduleCode}-${idx}`,
          ueLabel,
          moduleLabel: `${moduleCode} — ${mod.titre}`,
          evalLabel: evaluation.description || "Évaluation",
        });
      });
    }
  }
  return out;
}

/** Ids des évaluations passées de "pas de note" à "notée" depuis le dernier relevé connu (cache local). */
export function newlyPublishedIds(previous: Releve | null, current: Releve): Set<number> {
  const result = new Set<number>();
  if (!previous) return result;
  const prevValues = new Map<number, NoteValue["value"]>();
  for (const group of ["ressources", "saes"] as const) {
    for (const mod of Object.values(previous[group] || {})) {
      mod.evaluations?.forEach((ev) => prevValues.set(ev.id, ev.note.value));
    }
  }
  for (const group of ["ressources", "saes"] as const) {
    for (const mod of Object.values(current[group] || {})) {
      mod.evaluations?.forEach((ev) => {
        const had = prevValues.has(ev.id) ? numericNoteValue(prevValues.get(ev.id) ?? null) : null;
        const now = numericNoteValue(ev.note.value);
        if (now !== null && had === null) result.add(ev.id);
      });
    }
  }
  return result;
}

/**
 * Recherche par dichotomie la note uniforme x (0-20) à obtenir sur les évaluations listées dans
 * `pendingKeys` pour atteindre `target`, selon la fonction d'évaluation fournie (moyenne générale
 * ou moyenne d'une UE donnée). Retourne aussi les bornes atteignables pour signaler un objectif
 * déjà acquis ou hors de portée même avec 20/20 partout.
 */
export interface TargetSolution {
  x: number | null;
  atMin: number | null;
  atMax: number | null;
  alreadyMet: boolean;
  unreachable: boolean;
}

export function solveUniformTarget(
  overrides: Record<string, number>,
  pendingKeys: string[],
  target: number,
  evaluate: (testOverrides: Record<string, number>) => number | null
): TargetSolution {
  const withX = (x: number) => {
    const o = { ...overrides };
    for (const k of pendingKeys) o[k] = x;
    return o;
  };

  if (pendingKeys.length === 0) {
    const current = evaluate(overrides);
    return { x: null, atMin: current, atMax: current, alreadyMet: (current ?? -1) >= target, unreachable: current === null };
  }

  const atMin = evaluate(withX(0));
  const atMax = evaluate(withX(20));
  if (atMin === null || atMax === null) {
    return { x: null, atMin, atMax, alreadyMet: false, unreachable: true };
  }
  if (atMin >= target) {
    return { x: 0, atMin, atMax, alreadyMet: true, unreachable: false };
  }
  if (atMax < target) {
    return { x: 20, atMin, atMax, alreadyMet: false, unreachable: true };
  }

  let lo = 0;
  let hi = 20;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const val = evaluate(withX(mid));
    if (val === null) break;
    if (val < target) lo = mid;
    else hi = mid;
  }
  return { x: (lo + hi) / 2, atMin, atMax, alreadyMet: false, unreachable: false };
}

/** Poids (%) d'une UE dans la moyenne générale, pondéré par ses ECTS (hors UE bonus/sport). */
export function ueWeightInGlobal(ueCode: string, ues: Record<string, Ue>): number | null {
  const ue = ues[ueCode];
  if (!ue || ue.type === 1) return null;
  let total = 0;
  for (const u of Object.values(ues)) {
    if (u.type === 1) continue;
    total += toNumber(u.ECTS?.total, 1) || 1;
  }
  if (total === 0) return null;
  return ((toNumber(ue.ECTS?.total, 1) || 1) / total) * 100;
}

/** Poids (%) d'un module au sein de son UE, selon le coef que l'UE lui attribue. */
export function moduleWeightInUe(ue: Ue, group: "ressources" | "saes", moduleCode: string): number | null {
  let total = 0;
  let mine = 0;
  for (const [g, summaries] of [
    ["ressources", ue.ressources] as const,
    ["saes", ue.saes] as const,
  ]) {
    if (!summaries) continue;
    for (const [code, summary] of Object.entries(summaries)) {
      const coef = toNumber(summary.coef, 1);
      total += coef;
      if (g === group && code === moduleCode) mine = coef;
    }
  }
  if (total === 0) return null;
  return (mine / total) * 100;
}

/** Poids (%) d'une évaluation au sein de son module, selon son coef parmi les évaluations du module. */
export function evaluationWeightInModule(mod: ModuleEntry, evalIdx: number): number | null {
  if (!mod.evaluations || mod.evaluations.length === 0) return null;
  let total = 0;
  for (const e of mod.evaluations) total += toNumber(e.coef, 1);
  if (total === 0) return null;
  return (toNumber(mod.evaluations[evalIdx].coef, 1) / total) * 100;
}

export function round2(n: number | null | undefined): number | null {
  return n === null || n === undefined ? null : Math.round(n * 100) / 100;
}

export function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toFixed(2);
}
