import type { ModuleEntry, Releve, Ue } from "../types";

/**
 * Structure prévisionnelle (UE, modules, coefficients) des semestres 5 et 6 du BUT R&T.
 * Ces données sont indicatives : ScoDoc n'a pas encore déclaré ces semestres, les
 * coefficients définitifs peuvent différer une fois les semestres ouverts officiellement.
 */

export interface PrevisionModule {
  code: string;
  titre: string;
  coef: number;
}

export interface PrevisionUe {
  code: string;
  titre: string;
  ectsTotal: number;
  ressources: PrevisionModule[];
  saes: PrevisionModule[];
}

export interface PrevisionSemestre {
  id: "s5" | "s6";
  numero: number;
  label: string;
  ues: PrevisionUe[];
}

export const PREVISION_S5: PrevisionSemestre = {
  id: "s5",
  numero: 5,
  label: "Semestre 5",
  ues: [
    {
      code: "RT1.5",
      titre: "Administrer les réseaux et l'Internet",
      ectsTotal: 6,
      ressources: [
        { code: "RES501", titre: "Wifi", coef: 0.1 },
        { code: "RES505", titre: "Anglais", coef: 0.5 },
        { code: "RES506", titre: "Communication", coef: 0.5 },
        { code: "RES502", titre: "Réponse à incidents", coef: 0.5 },
        { code: "RES509", titre: "Architectures sécurisées", coef: 0.2 },
        { code: "RES513", titre: "Réseaux d'accès", coef: 1.5 },
      ],
      saes: [
        { code: "SAE501", titre: "SAE Concevoir", coef: 0.7 },
        { code: "SAE502", titre: "Projet d'entreprise", coef: 0.7 },
        { code: "SAE503", titre: "SAE sécurisation", coef: 0.7 },
        { code: "SAE504", titre: "Portfolio", coef: 0.1 },
      ],
    },
    {
      code: "RT2.5",
      titre: "Connecter les entreprises et les usagers",
      ectsTotal: 6,
      ressources: [
        { code: "RES501", titre: "Wifi", coef: 0.6 },
        { code: "RES505", titre: "Anglais", coef: 0.4 },
        { code: "RES506", titre: "Communication", coef: 0.4 },
        { code: "RES502", titre: "Réponse à incidents", coef: 0.4 },
        { code: "RES509", titre: "Architectures sécurisées", coef: 0.2 },
        { code: "RES513", titre: "Réseaux d'accès", coef: 1.5 },
        { code: "RES514", titre: "Outils de scripting pour la cyber", coef: 0.5 },
      ],
      saes: [
        { code: "SAE501", titre: "SAE Concevoir", coef: 1 },
        { code: "SAE502", titre: "Projet d'entreprise", coef: 0.8 },
        { code: "SAE503", titre: "SAE sécurisation", coef: 0.8 },
        { code: "SAE504", titre: "Portfolio", coef: 0.1 },
      ],
    },
    {
      code: "RT3.5",
      titre: "Créer des outils et applications informatiques pour les R&T",
      ectsTotal: 6,
      ressources: [
        { code: "RES501", titre: "Wifi", coef: 0.6 },
        { code: "RES505", titre: "Anglais", coef: 0.5 },
        { code: "RES506", titre: "Communication", coef: 0.5 },
        { code: "RES507", titre: "PPP", coef: 0.1 },
        { code: "RES502", titre: "Réponse à incidents", coef: 0.6 },
        { code: "RES509", titre: "Architectures sécurisées", coef: 0.2 },
        { code: "RES513", titre: "Réseaux d'accès", coef: 0.5 },
        { code: "RES514", titre: "Outils de scripting pour la cyber", coef: 0.5 },
      ],
      saes: [
        { code: "SAE501", titre: "SAE Concevoir", coef: 0.9 },
        { code: "SAE502", titre: "Projet d'entreprise", coef: 0.7 },
        { code: "SAE503", titre: "SAE sécurisation", coef: 0.7 },
        { code: "SAE504", titre: "Portfolio", coef: 0.1 },
      ],
    },
    {
      code: "RT4.5",
      titre: "Administrer un système d'information sécurisé",
      ectsTotal: 6,
      ressources: [
        { code: "RES501", titre: "Wifi", coef: 1 },
        { code: "RES506", titre: "Communication", coef: 0.5 },
        { code: "RES507", titre: "PPP", coef: 0.1 },
        { code: "RES502", titre: "Réponse à incidents", coef: 0.8 },
        { code: "RES509", titre: "Architectures sécurisées", coef: 0.2 },
        { code: "RES513", titre: "Réseaux d'accès", coef: 0.5 },
        { code: "RES514", titre: "Outils de scripting pour la cyber", coef: 0.5 },
      ],
      saes: [
        { code: "SAE501", titre: "SAE Concevoir", coef: 0.9 },
        { code: "SAE502", titre: "Projet d'entreprise", coef: 0.7 },
        { code: "SAE503", titre: "SAE sécurisation", coef: 0.7 },
        { code: "SAE504", titre: "Portfolio", coef: 0.1 },
      ],
    },
    {
      code: "RT5.5",
      titre: "Surveiller un système d'information sécurisé",
      ectsTotal: 6,
      ressources: [
        { code: "RES501", titre: "Wifi", coef: 1.1 },
        { code: "RES506", titre: "Communication", coef: 0.5 },
        { code: "RES507", titre: "PPP", coef: 0.1 },
        { code: "RES502", titre: "Réponse à incidents", coef: 0.6 },
        { code: "RES509", titre: "Architectures sécurisées", coef: 0.2 },
        { code: "RES513", titre: "Réseaux d'accès", coef: 0.5 },
        { code: "RES514", titre: "Outils de scripting pour la cyber", coef: 0.5 },
      ],
      saes: [
        { code: "SAE501", titre: "SAE Concevoir", coef: 0.9 },
        { code: "SAE502", titre: "Projet d'entreprise", coef: 0.7 },
        { code: "SAE503", titre: "SAE sécurisation", coef: 0.7 },
        { code: "SAE504", titre: "Portfolio", coef: 0.1 },
      ],
    },
  ],
};

export const PREVISION_S6: PrevisionSemestre = {
  id: "s6",
  numero: 6,
  label: "Semestre 6",
  ues: [
    {
      code: "RT1.6",
      titre: "Administrer les réseaux et l'Internet",
      ectsTotal: 5.7,
      ressources: [
        { code: "RES601", titre: "Anglais", coef: 0.2 },
        { code: "RES602", titre: "Communication", coef: 0.2 },
        { code: "RES603", titre: "Connaissance de l'entreprise", coef: 0.3 },
        { code: "RES605", titre: "Audits de sécurité", coef: 0.3 },
        { code: "RES607", titre: "Normes", coef: 0.1 },
        { code: "RES608", titre: "Supervision des réseaux", coef: 0.4 },
        { code: "RES609", titre: "Réseaux d'opérateurs", coef: 0.6 },
        { code: "RES611", titre: "Sécurisation des services réseaux", coef: 0.7 },
        { code: "RES612", titre: "Gestion avancée des systèmes", coef: 0.5 },
      ],
      saes: [
        { code: "SAE602", titre: "Stage", coef: 2 },
        { code: "SAE603", titre: "Portfolio", coef: 0.2 },
      ],
    },
    {
      code: "RT2.6",
      titre: "Connecter les entreprises et les usagers",
      ectsTotal: 5.8,
      ressources: [
        { code: "RES601", titre: "Anglais", coef: 0.2 },
        { code: "RES602", titre: "Communication", coef: 0.2 },
        { code: "RES603", titre: "Connaissance de l'entreprise", coef: 0.3 },
        { code: "RES605", titre: "Audits de sécurité", coef: 0.3 },
        { code: "RES606", titre: "Supervision de la sécurité", coef: 0.4 },
        { code: "RES607", titre: "Normes", coef: 0.1 },
        { code: "RES608", titre: "Supervision des réseaux", coef: 0.3 },
        { code: "RES609", titre: "Réseaux d'opérateurs", coef: 0.9 },
        { code: "RES612", titre: "Gestion avancée des systèmes", coef: 0.2 },
        { code: "RES613", titre: "Sécurisation des systèmes", coef: 0.4 },
      ],
      saes: [
        { code: "SAE602", titre: "Stage", coef: 2 },
        { code: "SAE603", titre: "Portfolio", coef: 0.2 },
      ],
    },
    {
      code: "RT3.6",
      titre: "Créer des outils et applications informatiques pour les R&T",
      ectsTotal: 5.5,
      ressources: [
        { code: "RES601", titre: "Anglais", coef: 0.2 },
        { code: "RES602", titre: "Communication", coef: 0.2 },
        { code: "RES603", titre: "Connaissance de l'entreprise", coef: 0.3 },
        { code: "RES604", titre: "Cycle de vie d'un projet informatique", coef: 1.2 },
        { code: "RES605", titre: "Audits de sécurité", coef: 0.3 },
        { code: "RES606", titre: "Supervision de la sécurité", coef: 0.4 },
        { code: "RES607", titre: "Normes", coef: 0.1 },
        { code: "RES608", titre: "Supervision des réseaux", coef: 0.1 },
        { code: "RES612", titre: "Gestion avancée des systèmes", coef: 0.5 },
      ],
      saes: [
        { code: "SAE602", titre: "Stage", coef: 2 },
        { code: "SAE603", titre: "Portfolio", coef: 0.2 },
      ],
    },
    {
      code: "RT4.6",
      titre: "Administrer un système d'information sécurisé",
      ectsTotal: 6.5,
      ressources: [
        { code: "RES601", titre: "Anglais", coef: 0.2 },
        { code: "RES602", titre: "Communication", coef: 0.2 },
        { code: "RES603", titre: "Connaissance de l'entreprise", coef: 0.3 },
        { code: "RES605", titre: "Audits de sécurité", coef: 0.6 },
        { code: "RES606", titre: "Supervision de la sécurité", coef: 0.5 },
        { code: "RES607", titre: "Normes", coef: 0.1 },
        { code: "RES608", titre: "Supervision des réseaux", coef: 0.5 },
        { code: "RES611", titre: "Sécurisation des services réseaux", coef: 0.7 },
        { code: "RES612", titre: "Gestion avancée des systèmes", coef: 0.4 },
        { code: "RES613", titre: "Sécurisation des systèmes", coef: 0.6 },
      ],
      saes: [
        { code: "SAE602", titre: "Stage", coef: 2.5 },
        { code: "SAE603", titre: "Portfolio", coef: 0.2 },
      ],
    },
    {
      code: "RT5.6",
      titre: "Surveiller un système d'information sécurisé",
      ectsTotal: 6.5,
      ressources: [
        { code: "RES601", titre: "Anglais", coef: 0.2 },
        { code: "RES602", titre: "Communication", coef: 0.2 },
        { code: "RES603", titre: "Connaissance de l'entreprise", coef: 0.3 },
        { code: "RES605", titre: "Audits de sécurité", coef: 0.5 },
        { code: "RES606", titre: "Supervision de la sécurité", coef: 0.5 },
        { code: "RES607", titre: "Normes", coef: 0.1 },
        { code: "RES608", titre: "Supervision des réseaux", coef: 0.5 },
        { code: "RES611", titre: "Sécurisation des services réseaux", coef: 0.7 },
        { code: "RES612", titre: "Gestion avancée des systèmes", coef: 0.4 },
        { code: "RES613", titre: "Sécurisation des systèmes", coef: 0.6 },
      ],
      saes: [
        { code: "SAE602", titre: "Stage", coef: 2.5 },
        { code: "SAE603", titre: "Portfolio", coef: 0.2 },
      ],
    },
  ],
};

export const PREVISIONS: Record<"s5" | "s6", PrevisionSemestre> = {
  s5: PREVISION_S5,
  s6: PREVISION_S6,
};

/** Construit un Releve fictif (aucune note, uniquement UE/modules/coefs) exploitable par UeTable. */
export function buildPrevisionReleve(semestre: PrevisionSemestre): Releve {
  const ressources: Record<string, ModuleEntry> = {};
  const saes: Record<string, ModuleEntry> = {};
  const ues: Record<string, Ue> = {};

  for (const ue of semestre.ues) {
    for (const mod of ue.ressources) {
      ressources[mod.code] ??= { titre: mod.titre, moyenne: { value: null }, evaluations: [] };
    }
    for (const mod of ue.saes) {
      saes[mod.code] ??= { titre: mod.titre, moyenne: { value: null }, evaluations: [] };
    }
    ues[ue.code] = {
      numero: semestre.numero,
      type: 0,
      titre: ue.titre,
      moyenne: null,
      ECTS: { acquis: 0, total: ue.ectsTotal },
      ressources: Object.fromEntries(ue.ressources.map((m) => [m.code, { moyenne: null, coef: m.coef }])),
      saes: Object.fromEntries(ue.saes.map((m) => [m.code, { moyenne: null, coef: m.coef }])),
    };
  }

  return {
    etudiant: { nom: "", prenom: "" },
    formation: { titre: "BUT Réseaux et Télécommunications" },
    semestre: {
      numero: semestre.numero,
      notes: { value: null },
      rang: { value: 0, total: 0 },
    },
    ues,
    ues_capitalisees: {},
    ressources,
    saes,
  };
}
