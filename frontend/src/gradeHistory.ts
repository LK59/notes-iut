import type { Releve } from "./types";
import { numericNoteValue } from "./simulator";

const HISTORY_PREFIX = "notes-iut-history:";
const MAX_HISTORY_ITEMS = 80;

export interface GradeHistoryItem {
  id: string;
  semestreId: string;
  discoveredAt: string;
  evaluationId: number;
  moduleLabel: string;
  evaluationLabel: string;
  previousValue: number | null;
  newValue: number | null;
}

interface GradeSnapshot {
  evaluationId: number;
  moduleLabel: string;
  evaluationLabel: string;
  value: number | null;
}

function historyKey(semestreId: string): string {
  return HISTORY_PREFIX + semestreId;
}

function loadHistory(semestreId: string): GradeHistoryItem[] {
  try {
    const raw = localStorage.getItem(historyKey(semestreId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(semestreId: string, items: GradeHistoryItem[]): void {
  try {
    localStorage.setItem(historyKey(semestreId), JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)));
  } catch {
    // best effort
  }
}

function snapshots(releve: Releve): Map<number, GradeSnapshot> {
  const out = new Map<number, GradeSnapshot>();
  for (const group of ["ressources", "saes"] as const) {
    for (const [moduleCode, mod] of Object.entries(releve[group] || {})) {
      for (const evaluation of mod.evaluations ?? []) {
        out.set(evaluation.id, {
          evaluationId: evaluation.id,
          moduleLabel: `${moduleCode} - ${mod.titre || moduleCode}`,
          evaluationLabel: evaluation.description || "Evaluation",
          value: numericNoteValue(evaluation.note.value),
        });
      }
    }
  }
  return out;
}

export function recordGradeHistory(semestreId: string, previous: Releve | null, current: Releve): GradeHistoryItem[] {
  if (!previous) return loadHistory(semestreId);

  const prev = snapshots(previous);
  const now = snapshots(current);
  const discoveredAt = new Date().toISOString();
  const existing = loadHistory(semestreId);
  const existingIds = new Set(existing.map((item) => item.id));
  const created: GradeHistoryItem[] = [];

  for (const [evaluationId, currentSnapshot] of now) {
    const previousSnapshot = prev.get(evaluationId);
    const previousValue = previousSnapshot?.value ?? null;
    const newValue = currentSnapshot.value;
    if (previousValue === newValue) continue;
    if (previousValue === null && newValue === null) continue;

    const id = `${evaluationId}:${previousValue ?? "null"}:${newValue ?? "null"}`;
    if (existingIds.has(id)) continue;
    created.push({
      id,
      semestreId,
      discoveredAt,
      evaluationId,
      moduleLabel: currentSnapshot.moduleLabel,
      evaluationLabel: currentSnapshot.evaluationLabel,
      previousValue,
      newValue,
    });
  }

  if (created.length > 0) {
    saveHistory(semestreId, [...created.reverse(), ...existing]);
  }
  return loadHistory(semestreId);
}

export function getGradeHistory(semestreId: string | null): GradeHistoryItem[] {
  return semestreId ? loadHistory(semestreId) : [];
}

