import type { PremiereConnexionResponse, ReleveResponse } from "./types";

/**
 * Validation de forme des réponses ScoDoc.
 *
 * Volontairement écrite à la main plutôt qu'avec un validateur générique : il n'y a que deux
 * formes à vérifier, et les quelques lignes ci-dessous remplacent une dépendance de ~13 Ko
 * gzippés qui était chargée au démarrage — sur une app dont l'argument est justement d'être
 * légère en 4G. On ne vérifie que le strict minimum sur lequel le reste du code s'appuie
 * ensuite sans garde ; tous les autres champs sont laissés tels quels.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `semestres` doit être un tableau d'objets : tout le choix du semestre courant en dépend. */
export function isPremiereConnexionPayload(data: unknown): data is PremiereConnexionResponse {
  return isRecord(data) && Array.isArray(data.semestres) && data.semestres.every(isRecord);
}

/** `relevé.ues` doit être un objet : c'est la racine de toutes les moyennes calculées. */
export function isReleveResponsePayload(data: unknown): data is ReleveResponse {
  if (!isRecord(data)) return false;
  const releve = data["relevé"];
  return isRecord(releve) && isRecord(releve.ues);
}
