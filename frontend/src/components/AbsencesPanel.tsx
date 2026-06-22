import { useState } from "react";
import type { AbsencesByDate } from "../types";

function formatHeure(h: number): string {
  const heures = Math.floor(h);
  const minutes = Math.round((h - heures) * 60);
  return `${String(heures).padStart(2, "0")}h${String(minutes).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-sky-500 dark:text-sky-300 transition-transform ${open ? "rotate-180" : ""}`}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.084l3.71-3.855a.75.75 0 1 1 1.08 1.04l-4.25 4.42a.75.75 0 0 1-1.08 0l-4.25-4.42a.75.75 0 0 1 .02-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function AbsencesPanel({ absences }: { absences: AbsencesByDate | undefined }) {
  const [open, setOpen] = useState(false);

  const dates = Object.keys(absences || {}).sort((a, b) => (a < b ? 1 : -1)); // plus récent d'abord
  const total = dates.reduce((sum, d) => sum + (absences?.[d]?.length ?? 0), 0);
  const nonJustifiees = dates.reduce(
    (sum, d) => sum + (absences?.[d]?.filter((e) => !e.justifie).length ?? 0),
    0
  );

  if (total === 0) {
    return (
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm text-emerald-700 dark:text-emerald-300">
        Aucune absence enregistrée pour ce semestre.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-900 shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-sky-50 dark:hover:bg-slate-800/60 rounded-t-xl"
      >
        <div>
          <h2 className="font-semibold text-sky-900 dark:text-sky-100">
            Absences — {total} créneau{total > 1 ? "x" : ""}
            {nonJustifiees > 0 && (
              <span className="ml-2 text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/50 rounded px-1.5 py-0.5">
                {nonJustifiees} non justifiée{nonJustifiees > 1 ? "s" : ""}
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">Détail jour par jour, créneau par créneau.</p>
        </div>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="divide-y divide-sky-100 dark:divide-slate-800 pb-2">
          {dates.map((date) => (
            <div key={date} className="px-4 py-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{formatDate(date)}</p>
              <div className="space-y-1">
                {absences![date].map((ev) => (
                  <div key={ev.idAbs} className="flex items-center justify-between gap-2 text-xs flex-wrap">
                    <span className="text-slate-600 dark:text-slate-300">
                      {formatHeure(ev.debut)}–{formatHeure(ev.fin)} · {ev.matiereComplet} · {ev.enseignant}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium uppercase tracking-wide whitespace-nowrap ${
                        ev.justifie
                          ? "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300"
                          : "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300"
                      }`}
                    >
                      {ev.justifie ? "justifiée" : "non justifiée"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
