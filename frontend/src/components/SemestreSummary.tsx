import type { Releve } from "../types";
import { countEvaluations, numericNoteValue } from "../simulator";
import { Card } from "./ui";

// Reprend les libellés du portail (correspondanceCodes) pour la décision de fin d'année.
/** Nombre de colonnes = nombre de tuiles, pour qu'aucune ne se retrouve orpheline
 * sur sa propre ligne. Classes écrites en toutes lettres : Tailwind ne compile que
 * ce qu'il voit littéralement dans le source. */
const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

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

/**
 * Résumé du semestre.
 *
 * La moyenne générale est traitée comme le seul chiffre principal ; le reste est une
 * grille compacte à deux colonnes dès le mobile. La version précédente empilait huit
 * blocs sur une seule colonne — formation et nom de l'étudiant, deux constantes que
 * l'utilisateur connaît déjà, y occupaient autant de place que la moyenne.
 */
export default function SemestreSummary({
  releve,
  trend,
}: {
  releve: Releve;
  /** Écart de moyenne générale officielle vs le semestre précédent (null si indisponible). */
  trend?: number | null;
}) {
  const notes = releve.semestre.notes;
  // ScoDoc renvoie une moyenne de "00.00" et un rang "1 ex / 33" pour un semestre où
  // personne n'a encore de note : affichés tels quels, ils se lisent comme un vrai 0/20.
  const started = countEvaluations(releve) > 0;
  const moyenne = started ? numericNoteValue(notes?.value) : null;
  const rang = releve.semestre.rang;
  const ects = releve.semestre.ECTS;
  const absences = releve.semestre.absences;
  const decisionAnnee = started ? releve.semestre.decision_annee?.code : undefined;
  const decisionRcue = releve.semestre.decision_rcue ?? [];
  const etudiant = releve.etudiant;
  const nom = etudiant ? `${etudiant.prenom ?? ""} ${etudiant.nom ?? ""}`.trim() : "";

  // La moyenne de promo est déjà matérialisée par le repère de l'échelle ci-dessous :
  // la répéter en tuile disait deux fois la même chose. On ne la garde que lorsque
  // l'échelle n'est pas affichable (semestre à venir, bornes absentes).
  const scaleShown =
    started && moyenne !== null && notes?.min !== undefined && notes?.max !== undefined;

  const stats = [
    !scaleShown && (
      <Stat key="moy" label="Moy. promo" value={started ? fmtNote(numericNoteValue(notes?.moy)) : "—"} />
    ),
    <Stat key="ects" label="ECTS" value={ects ? `${ects.acquis ?? "-"} / ${ects.total ?? "-"}` : "—"} />,
    <Stat
      key="abs"
      label="Absences"
      value={absences ? `${absences.injustifie} / ${absences.total}` : "—"}
      hint={absences ? "non justifiées sur total (demi-journées)" : undefined}
    />,
    // La décision de jury n'existe que quelques jours par an : une tuile figée sur
    // « — » onze mois sur douze n'apprend rien, autant rendre la place.
    releve.semestre.situation && (
      <Stat key="decision" label="Décision" value={releve.semestre.situation} small />
    ),
  ].filter(Boolean);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 pt-4 pb-3">
        <div>
          <p className="text-xs text-muted">{started ? "Moyenne générale" : "Semestre à venir"}</p>
          <p className="flex items-baseline gap-2">
            <span className="mono text-[2.75rem] leading-none font-medium tracking-tight text-fg">
              {moyenne !== null ? moyenne.toFixed(2) : "—"}
            </span>
            <span className="text-sm text-subtle">{started ? "/ 20" : debutLabel(releve)}</span>
            {trend !== undefined && trend !== null && Math.abs(trend) >= 0.01 && (
              <span
                title={`${trend > 0 ? "+" : ""}${trend.toFixed(2)} point vs le semestre précédent`}
                className={`mono text-xs font-medium ${trend > 0 ? "text-pos" : "text-neg"}`}
              >
                {trend > 0 ? "↑" : "↓"} {Math.abs(trend).toFixed(2)}
              </span>
            )}
          </p>
        </div>

        {started && rang && (
          <div className="text-right">
            <p className="text-xs text-muted">Rang</p>
            <p className="mono text-xl text-fg">
              {rang.value}
              <span className="text-sm text-subtle"> / {rang.total}</span>
            </p>
          </div>
        )}
      </div>

      {/* Repères de promo : une petite échelle vaut mieux que trois nombres alignés. */}
      {scaleShown && (
        <PromoScale
          min={numericNoteValue(notes.min)}
          moy={numericNoteValue(notes.moy)}
          max={numericNoteValue(notes.max)}
          mine={moyenne}
        />
      )}

      <dl className={`grid border-t border-line divide-x divide-line ${GRID_COLS[stats.length]}`}>
        {stats}
      </dl>

      {(decisionAnnee || decisionRcue.length > 0) && (
        <div className="border-t border-line px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {decisionAnnee && (
            <span>Décision annuelle — {DECISION_ANNEE_LABELS[decisionAnnee] ?? decisionAnnee}</span>
          )}
          {decisionRcue.map((rcue, index) => (
            <span key={index}>
              {rcue.niveau?.competence?.titre ?? "Compétence"} — {rcue.code}
            </span>
          ))}
        </div>
      )}

      {/* Constantes du dossier : présentes pour l'export et la vérification, reléguées
          en pied de bloc plutôt que traitées comme des indicateurs. */}
      <div className="border-t border-line bg-inset/50 px-4 py-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-subtle">
        {nom && <span>{nom}</span>}
        {releve.formation?.titre && (
          <>
            {nom && <span aria-hidden="true">·</span>}
            <span>{releve.formation.titre}</span>
          </>
        )}
      </div>
    </Card>
  );
}

function PromoScale({
  min,
  moy,
  max,
  mine,
}: {
  min: number | null;
  moy: number | null;
  max: number | null;
  mine: number;
}) {
  if (min === null || max === null || max <= min) return null;
  const pct = (value: number) => `${Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))}%`;

  return (
    <div className="px-4 pb-4">
      <div className="relative h-1.5 rounded-full bg-inset">
        <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-line-strong" />
        {moy !== null && (
          <span
            className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-muted"
            style={{ left: pct(moy) }}
            title={`Moyenne de la promo : ${moy.toFixed(2)}`}
          />
        )}
        <span
          className="absolute -top-[3px] h-3 w-3 -translate-x-1/2 rounded-full bg-accent ring-2 ring-surface"
          style={{ left: pct(mine) }}
          title={`Ta moyenne : ${mine.toFixed(2)}`}
        />
      </div>
      <div className="mt-1 flex justify-between mono text-[11px] text-subtle">
        <span>{min.toFixed(2)}</span>
        {/* La valeur, pas seulement la position du repère : la tuile « Moy. promo » a été
            retirée (elle répétait cette échelle), le nombre doit donc rester lisible ici. */}
        <span className="text-muted">{moy !== null ? `promo ${moy.toFixed(2)}` : "promo"}</span>
        <span>{max.toFixed(2)}</span>
      </div>
    </div>
  );
}

/** « à partir du 1 septembre » tant qu'aucune note n'existe : sans repère de date, un
 * semestre vide ressemble à une panne de l'app. */
function debutLabel(releve: Releve): string {
  const debut = releve.semestre.date_debut;
  if (!debut) return "pas encore de note";
  const date = new Date(`${debut}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "pas encore de note";
  return `à partir du ${date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
}

function Stat({
  label,
  value,
  hint,
  small,
}: {
  label: string;
  value: string;
  hint?: string;
  small?: boolean;
}) {
  return (
    <div className="px-4 py-2.5 min-w-0">
      <dt className="text-[11px] text-subtle truncate">{label}</dt>
      <dd
        className={`text-fg truncate ${small ? "text-[13px]" : "mono text-sm"}`}
        title={hint ?? value}
      >
        {value}
      </dd>
    </div>
  );
}

function fmtNote(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}
