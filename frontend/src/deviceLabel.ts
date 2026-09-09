/**
 * Libellé lisible d'un appareil à partir de son user-agent, pour la liste des appareils
 * mémorisés. Les user-agents complets y sont illisibles, et deux lignes identiques
 * empêchent de savoir lequel on révoque.
 */

/**
 * Sur iOS, TOUS les navigateurs sont obligés d'utiliser WebKit et terminent leur UA par
 * « ... Safari/604.1 ». Chrome s'y annonce CriOS, Firefox FxiOS, Edge EdgiOS — aucun ne
 * contient « Chrome/ » ni « Firefox/ ». Sans ces trois cas, tout ce petit monde était
 * étiqueté « Safari sur iOS », et deux appareils différents s'affichaient à l'identique.
 */
const NAVIGATEURS: Array<[RegExp, string]> = [
  [/CriOS\//i, "Chrome"],
  [/FxiOS\//i, "Firefox"],
  [/EdgiOS\//i, "Edge"],
  [/OPiOS\/|OPR\/|Opera\//i, "Opera"],
  [/Edg\//i, "Edge"],
  [/SamsungBrowser\//i, "Samsung Internet"],
  [/Firefox\//i, "Firefox"],
  [/Chrome\//i, "Chrome"],
  [/Safari\//i, "Safari"],
];

const SYSTEMES: Array<[RegExp, string]> = [
  [/iPhone|iPad|iPod/i, "iOS"],
  [/Android/i, "Android"],
  [/Mac OS X/i, "macOS"],
  [/Windows/i, "Windows"],
  [/Linux/i, "Linux"],
];

function premier(motifs: Array<[RegExp, string]>, userAgent: string): string | null {
  for (const [motif, nom] of motifs) {
    if (motif.test(userAgent)) return nom;
  }
  return null;
}

export function describeDevice(userAgent?: string): string {
  if (!userAgent) return "Appareil inconnu";
  // Chromium s'annonce aussi comme Chrome : ne pas le confondre avec le vrai Chrome.
  const navigateur = /Chromium\//i.test(userAgent) ? "Chromium" : premier(NAVIGATEURS, userAgent);
  const systeme = premier(SYSTEMES, userAgent);
  if (navigateur && systeme) return `${navigateur} sur ${systeme}`;
  return navigateur ?? systeme ?? "Appareil inconnu";
}
