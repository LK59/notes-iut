import { z } from "zod";

// ── Schémas Zod pour les réponses ScoDoc ────────────────────────────────────
// Valident uniquement la structure minimale — identique aux anciens guards
// isRecord/Array.isArray mais avec des messages d'erreur précis.
// .passthrough() : tous les champs inconnus sont acceptés.

export const PremiereConnexionSchema = z
  .object({
    semestres: z.array(z.record(z.unknown())),
  })
  .passthrough();

export const ReleveResponseSchema = z
  .object({
    relevé: z
      .object({ ues: z.record(z.unknown()) })
      .passthrough(),
  })
  .passthrough();
