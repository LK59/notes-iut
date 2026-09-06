import type { Semestre } from "./types";

export function semestreLabel(s: Semestre): string {
  const num = s.semestre_id ? `S${s.semestre_id}` : "";
  const annee = s.annee_scolaire ? `(${s.annee_scolaire})` : "";
  return [s.titre, num, annee].filter(Boolean).join(" ");
}

/**
 * Libellé compact pour le sélecteur de semestre : « S4 · 2025-26 ».
 *
 * Le libellé complet ("BUT R&T S4 (2025-2026)") était systématiquement tronqué en
 * « BUT R&T 20… » dans l'en-tête — l'information qui identifie réellement le semestre,
 * et la seule qui change d'une option à l'autre, était justement celle qu'on ne voyait pas.
 */
export function semestreLabelShort(s: Semestre): string {
  const num = s.semestre_id ? `S${s.semestre_id}` : s.titre;
  if (!s.annee_scolaire) return num;
  // "2025-2026" → "2025-26"
  const annee = s.annee_scolaire.replace(/^(\d{4})-(?:\d{2})?(\d{2})$/, "$1-$2");
  return `${num} · ${annee}`;
}
