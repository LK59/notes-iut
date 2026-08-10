import type { Semestre } from "./types";

export function semestreLabel(s: Semestre): string {
  const num = s.semestre_id ? `S${s.semestre_id}` : "";
  const annee = s.annee_scolaire ? `(${s.annee_scolaire})` : "";
  return [s.titre, num, annee].filter(Boolean).join(" ");
}
