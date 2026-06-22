export interface Semestre {
  formsemestre_id: string;
  titre: string;
  semestre_id?: number;
  annee_scolaire?: string;
  [key: string]: unknown;
}

/** Une note avec ses bornes de promo, telle que renvoyée par ScoDoc. */
export interface NoteValue {
  value: number | string | null;
  max?: number | string;
  moy?: number | string;
  min?: number | string;
  rang?: number | string;
  total?: number | string;
}

export interface Evaluation {
  id: number;
  description?: string;
  url?: string;
  coef: number | string;
  note: NoteValue;
  /** Poids de cette évaluation dans chaque UE qu'elle alimente (clé = code UE). */
  poids: Record<string, number | string>;
}

/** Une ressource ou une SAÉ, telle qu'elle apparaît dans data.ressources / data.saes. */
export interface ModuleEntry {
  titre: string;
  url?: string;
  moyenne: NoteValue;
  absences?: { injustifie: number; total: number };
  evaluations: Evaluation[];
}

/** Résumé d'un module au sein d'une UE (data.ues[code].ressources[moduleCode]). */
export interface UeModuleSummary {
  moyenne: number | string | null;
  coef: number | string;
}

export interface Ue {
  numero: number;
  /** type === 1 : UE bonus/sport, sans notation classique. */
  type: number;
  titre?: string;
  moyenne: NoteValue | number | string | null;
  bonus?: number | string;
  malus?: number | string;
  date_capitalisation?: string | null;
  bul_orig_url?: string;
  bonus_description?: string;
  ECTS?: { acquis: number | string; total: number | string };
  ressources?: Record<string, UeModuleSummary>;
  saes?: Record<string, UeModuleSummary>;
  modules?: Record<string, ModuleEntry>;
}

export interface Releve {
  etudiant: {
    civilite?: string;
    nom: string;
    prenom: string;
    code_nip?: string;
    code_ine?: string;
    fiche_url?: string;
    photo_url?: string;
    date_naissance?: string;
  };
  formation: { titre: string };
  semestre: {
    numero: number;
    notes: NoteValue;
    rang: { value: number; total: number; groupes?: Record<string, { value: number; total: number }> };
    absences?: { injustifie: number; total: number };
    ECTS?: { acquis: number; total: number };
    groupes?: { group_name: string }[];
    inscription?: string;
    situation?: string;
    decision_annee?: { code: string };
    decision_rcue?: { niveau: { competence: { titre: string } }; code: string }[];
    decision_ue?: { acronyme: string; code: string }[];
  };
  ues: Record<string, Ue>;
  ues_capitalisees: Record<string, Ue>;
  ressources: Record<string, ModuleEntry>;
  saes: Record<string, ModuleEntry>;
  options?: Record<string, boolean>;
  publie?: boolean;
  message?: string;
}

/** Un évènement d'absence (clé du dictionnaire = date ISO "YYYY-MM-DD"). */
export interface AbsenceEvent {
  idAbs: number;
  idJustif: number[];
  debut: number;
  fin: number;
  statut: string;
  justifie: boolean;
  enseignant: string;
  matiereComplet: string | number;
  dateFin: string;
}

export type AbsencesByDate = Record<string, AbsenceEvent[]>;

export interface ReleveResponse {
  relevé: Releve;
  absences?: AbsencesByDate;
  [key: string]: unknown;
}

export interface PremiereConnexionResponse {
  auth: { session: string; name?: string; statut: string };
  semestres: Semestre[];
  config?: unknown;
  relevé: Releve;
  absences?: AbsencesByDate;
}
