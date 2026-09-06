import type { AbsencesByDate } from "../types";
import Chip from "./Chip";
import { Card, Panel } from "./ui";
import { SECTION_LABEL } from "./SectionNav";

function formatHeure(h: number): string {
  const heures = Math.floor(h);
  const minutes = Math.round((h - heures) * 60);
  return `${String(heures).padStart(2, "0")}h${String(minutes).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

interface Props {
  absences: AbsencesByDate | undefined;
  /** Total/injustifié officiels du bulletin (semestre.absences), pour comparer au détail jour par jour. */
  officialAbsences?: { total: number; injustifie: number };
}

export default function AbsencesPanel({ absences, officialAbsences }: Props) {
  const dates = Object.keys(absences || {}).sort((a, b) => (a < b ? 1 : -1)); // plus récent d'abord
  const total = dates.reduce((sum, date) => sum + (absences?.[date]?.length ?? 0), 0);
  const nonJustifiees = dates.reduce(
    (sum, date) => sum + (absences?.[date]?.filter((event) => !event.justifie).length ?? 0),
    0
  );

  // Le résumé du bulletin (semestre.absences) et le détail jour par jour de la passerelle
  // viennent de deux systèmes de comptage distincts côté ScoDoc — ils peuvent désynchroniser
  // en cas d'erreur de saisie admin. On le signale plutôt que de trancher arbitrairement.
  const mismatch =
    officialAbsences !== undefined &&
    total > 0 &&
    (total !== officialAbsences.total || nonJustifiees !== officialAbsences.injustifie);

  if (total === 0) {
    return (
      <Card className="border-pos/40 bg-pos-soft/40 px-4 py-3">
        <p className="text-sm text-pos">Aucune absence enregistrée pour ce semestre.</p>
      </Card>
    );
  }

  return (
    <Panel
      title={SECTION_LABEL.absences}
      subtitle={
        mismatch && officialAbsences
          ? `Le bulletin officiel en compte ${officialAbsences.injustifie}/${officialAbsences.total} — décomptes ScoDoc non synchronisés.`
          : "Détail créneau par créneau."
      }
      aside={
        <span className="flex items-center gap-1.5">
          {nonJustifiees > 0 && <Chip color="neg">{nonJustifiees} non justifiée{nonJustifiees > 1 ? "s" : ""}</Chip>}
          <span className="mono text-xs text-muted">{total}</span>
        </span>
      }
    >
      <div className="divide-y divide-line">
        {dates.map((date) => (
          <div key={date} className="px-4 py-2.5">
            <p className="text-xs font-medium text-muted mb-1.5 first-letter:uppercase">
              {formatDate(date)}
            </p>
            <div className="space-y-1">
              {(absences?.[date] ?? []).map((event) => (
                <div key={event.idAbs} className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[13px] text-fg min-w-0">
                    <span className="mono text-xs text-subtle">
                      {formatHeure(event.debut)}–{formatHeure(event.fin)}
                    </span>{" "}
                    {event.matiereComplet}
                    {event.enseignant && (
                      <span className="text-subtle"> · {event.enseignant}</span>
                    )}
                  </span>
                  <Chip color={event.justifie ? "neutral" : "neg"}>
                    {event.justifie ? "justifiée" : "non justifiée"}
                  </Chip>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
