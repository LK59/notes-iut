/**
 * Relevé entièrement INVENTÉ, pour le banc d'essai visuel (voir dev/Harness.tsx).
 *
 * Aucune donnée réelle : ni étudiant, ni note, ni identifiant. C'est ce qui permet de
 * regarder les vues authentifiées — le gros de l'app — sans jamais manipuler d'identifiants
 * CAS, que ce projet ne demande ni ne stocke.
 */
import type { AbsencesByDate, Evaluation, ModuleEntry, Releve, Ue } from "../src/types";

let prochainId = 1;

function evaluation(
  description: string,
  value: number | string | null,
  coef: number,
  poids: Record<string, number>,
  bornes: { moy?: number; min?: number; max?: number } = {}
): Evaluation {
  return {
    id: prochainId++,
    description,
    coef,
    poids,
    note: {
      value,
      moy: bornes.moy ?? 11.4,
      min: bornes.min ?? 4,
      max: bornes.max ?? 18.5,
    },
  };
}

function moduleEntry(titre: string, moyenne: number | null, evaluations: Evaluation[]): ModuleEntry {
  return {
    titre,
    moyenne: { value: moyenne, moy: 11.2, min: 5.5, max: 17.8, rang: 7, total: 28 },
    evaluations,
  };
}

const ressources: Record<string, ModuleEntry> = {
  "R5.01": moduleEntry("Initiation au droit des affaires", 14.25, [
    evaluation("Contrôle continu n°1", 15.5, 1, { RT1: 2, RT2: 1 }),
    evaluation("Étude de cas", 13, 2, { RT1: 2, RT2: 1 }, { moy: 12.1, min: 6, max: 17 }),
  ]),
  "R5.02": moduleEntry("Administration systèmes et réseaux", 9.75, [
    evaluation("TP noté — routage dynamique", 8.5, 2, { RT1: 3 }, { moy: 10.8, min: 3, max: 19 }),
    evaluation("Projet d'infrastructure", 11, 3, { RT1: 3 }),
    evaluation("Contrôle terminal", "~", 3, { RT1: 3 }),
  ]),
  "R5.03": moduleEntry("Sécurité des systèmes d'information", 16.5, [
    evaluation("QCM sécurité", 17, 1, { RT3: 2, RT4: 1 }, { moy: 13.9, min: 8, max: 20 }),
    evaluation("Audit d'une architecture", 16, 2, { RT3: 2, RT4: 1 }),
  ]),
  "R5.04": moduleEntry("Anglais professionnel", 12, [
    evaluation("Oral — soutenance blanche", 12, 1, { RT2: 1, RT3: 1 }),
  ]),
};

const saes: Record<string, ModuleEntry> = {
  "SAÉ5.01": moduleEntry("Concevoir et déployer une infrastructure", 13.4, [
    evaluation("Livrable intermédiaire", 12.5, 2, { RT1: 3, RT3: 2 }),
    evaluation("Soutenance finale", 14, 3, { RT1: 3, RT3: 2 }, { moy: 12.8, min: 7.5, max: 18 }),
  ]),
  "SAÉ5.02": moduleEntry("Piloter un projet informatique", null, [
    evaluation("Rapport d'avancement", "~", 2, { RT2: 2 }),
  ]),
};

function ue(
  numero: number,
  titre: string,
  moyenne: number | null,
  ectsAcquis: number,
  refs: { ressources?: string[]; saes?: string[] }
): Ue {
  const resume = (codes: string[] = []) =>
    Object.fromEntries(
      codes.map((code) => [
        code,
        {
          moyenne: (ressources[code] ?? saes[code])?.moyenne.value ?? null,
          coef: 2,
        },
      ])
    );
  return {
    numero,
    type: 0,
    titre,
    moyenne: { value: moyenne, moy: 11.6, min: 6.2, max: 17.1, rang: 9, total: 28 },
    ECTS: { acquis: ectsAcquis, total: 6 },
    ressources: resume(refs.ressources),
    saes: resume(refs.saes),
  };
}

export const releveFictif: Releve = {
  etudiant: { nom: "Martin", prenom: "Camille", civilite: "" },
  formation: { titre: "BUT Réseaux et Télécommunications" },
  semestre: {
    numero: 5,
    date_debut: "2026-09-01",
    date_fin: "2027-01-15",
    notes: { value: 13.18, moy: 11.7, min: 6.4, max: 16.9 },
    rang: { value: 6, total: 28 },
    absences: { injustifie: 2, total: 5 },
    ECTS: { acquis: 24, total: 30 },
    groupes: [{ group_name: "TP B1" }],
    decision_ue: [
      { acronyme: "RT1", code: "ADM" },
      { acronyme: "RT3", code: "ADM" },
    ],
  },
  ues: {
    RT1: ue(1, "Administrer les réseaux et l'Internet", 12.1, 6, {
      ressources: ["R5.01", "R5.02"],
      saes: ["SAÉ5.01"],
    }),
    RT2: ue(2, "Connecter les entreprises et les usagers", 13.05, 6, {
      ressources: ["R5.01", "R5.04"],
      saes: ["SAÉ5.02"],
    }),
    RT3: ue(3, "Créer des outils et applications informatiques", 15.4, 6, {
      ressources: ["R5.03", "R5.04"],
      saes: ["SAÉ5.01"],
    }),
    RT4: ue(4, "Administrer un système d'information sécurisé", null, 0, {
      ressources: ["R5.03"],
    }),
  },
  ues_capitalisees: {},
  ressources,
  saes,
  publie: true,
};

export const absencesFictives: AbsencesByDate = {
  "2026-10-14": [
    {
      idAbs: 1,
      idJustif: [],
      debut: 8,
      fin: 10,
      statut: "abs",
      justifie: false,
      enseignant: "—",
      matiereComplet: "R5.02 Administration systèmes et réseaux",
      dateFin: "2026-10-14",
    },
  ],
  "2026-11-03": [
    {
      idAbs: 2,
      idJustif: [7],
      debut: 14,
      fin: 18,
      statut: "abs",
      justifie: true,
      enseignant: "—",
      matiereComplet: "SAÉ5.01",
      dateFin: "2026-11-03",
    },
  ],
};
