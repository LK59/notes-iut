import type { AbsencesByDate, Releve } from "../types";
import { numericNoteValue } from "../simulator";

// Reprend les libellés du portail (correspondanceCodes) pour la décision de fin d'année.
const DECISION_ANNEE_LABELS: Record<string, string> = {
  ADM: "Admis",
  ADJ: "Admis par décision de jury",
  PASD: "Passage de droit",
  PAS1NCI: "Passage par décision de jury, niveau insuffisant sur une partie",
  RED: "Ajourné, autorisé à redoubler",
  NAR: "Non admis, non autorisé à redoubler",
  DEM: "Démission",
  ABAN: "Abandon",
  RAT: "En attente d'un rattrapage",
  EXCLU: "Exclusion disciplinaire",
  DEF: "Défaillance",
  ABL: "Année blanche",
};

export default function SemestreSummary({ releve, absences }: { releve: Releve; absences?: AbsencesByDate }) {
  const notes = releve.semestre.notes;
  const moyenne = numericNoteValue(notes?.value);
  const decisionAnnee = releve.semestre.decision_annee?.code;
  const decisionRcue = releve.semestre.decision_rcue ?? [];
  const hasDecisions = Boolean(decisionAnnee) || decisionRcue.length > 0;

  // Le résumé du bulletin (semestre.absences) et le détail jour par jour de la passerelle
  // viennent de deux systèmes de comptage distincts côté ScoDoc — ils peuvent désynchroniser
  // en cas d'erreur de saisie admin. On le signale plutôt que de trancher arbitrairement.
  const detailEvents = Object.values(absences ?? {}).flat();
  const detailTotal = detailEvents.length;
  const detailInjustifie = detailEvents.filter((e) => !e.justifie).length;
  const officialTotal = releve.semestre.absences?.total ?? 0;
  const officialInjustifie = releve.semestre.absences?.injustifie ?? 0;
  const absencesMismatch =
    detailTotal > 0 && (detailTotal !== officialTotal || detailInjustifie !== officialInjustifie);

  return (
    <div className="bg-white dark:bg-slate-900 border border-sky-200 dark:border-slate-800 rounded-xl shadow-sm p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
      <Stat label="Moyenne générale" value={moyenne !== null ? moyenne.toFixed(2) : "—"} highlight />
      <Stat
        label="Min / Moy. / Max promo"
        value={`${notes?.min ?? "—"} / ${notes?.moy ?? "—"} / ${notes?.max ?? "—"}`}
      />
      <Stat
        label="Rang"
        value={releve.semestre.rang ? `${releve.semestre.rang.value} / ${releve.semestre.rang.total}` : "—"}
      />
      <Stat
        label="ECTS"
        value={releve.semestre.ECTS ? `${releve.semestre.ECTS.acquis ?? "-"} / ${releve.semestre.ECTS.total ?? "-"}` : "—"}
      />
      <div>
        <p className="text-xs text-slate-600 dark:text-slate-400">Absences (1/2 j.)</p>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {releve.semestre.absences ? `${officialInjustifie} non justifiées / ${officialTotal} total` : "—"}
        </p>
        {absencesMismatch && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
            Détail ci-dessous : {detailInjustifie}/{detailTotal} — décompte ScoDoc non synchronisé (erreur de saisie
            possible côté admin)
          </p>
        )}
      </div>
      {releve.semestre.situation && <Stat label="Décision" value={releve.semestre.situation} />}
      {releve.formation?.titre && <Stat label="Formation" value={releve.formation.titre} />}
      {releve.etudiant && (
        <Stat label="Étudiant" value={`${releve.etudiant.prenom ?? ""} ${releve.etudiant.nom ?? ""}`.trim()} />
      )}

      {hasDecisions && (
        <div className="col-span-full pt-2 border-t border-sky-50 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
          {decisionAnnee && (
            <span>Décision annuelle : {DECISION_ANNEE_LABELS[decisionAnnee] ?? decisionAnnee}</span>
          )}
          {decisionRcue.map((c, i) => (
            <span key={i}>
              {c.niveau.competence.titre} : {c.code}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-600 dark:text-slate-400">{label}</p>
      <p
        className={
          highlight
            ? "text-2xl font-bold text-sky-700 dark:text-sky-300"
            : "text-sm font-medium text-slate-700 dark:text-slate-200"
        }
      >
        {value}
      </p>
    </div>
  );
}
