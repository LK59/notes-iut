import { useState } from "react";
import type { Releve } from "../types";
import { fmt, numericNoteValue, toNumber } from "../simulator";
import Chip from "./Chip";
import Collapsible from "./Collapsible";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-sky-500 dark:text-sky-300 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
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

export default function BonusMalusPanel({ releve }: { releve: Releve }) {
  const [open, setOpen] = useState(false);

  const bonusUes = Object.entries(releve.ues).filter(([, ue]) => ue.type === 1);
  const recap = Object.entries(releve.ues)
    .filter(([, ue]) => ue.type !== 1)
    .map(([code, ue]) => ({ code, bonus: toNumber(ue.bonus), malus: toNumber(ue.malus) }))
    .filter((r) => r.bonus !== 0 || r.malus > 0);

  if (bonusUes.length === 0 && recap.length === 0) return null;

  return (
    <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-900 shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-sky-50 dark:hover:bg-slate-800/60 rounded-t-xl"
      >
        <h2 className="font-semibold text-sky-900 dark:text-sky-100 text-sm">Bonus &amp; malus</h2>
        <Chevron open={open} />
      </button>
      <Collapsible open={open}>
        <div className="px-4 pb-4 space-y-3">
          {recap.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {recap.map((r) => (
                <Chip key={r.code} color={r.bonus !== 0 ? "emerald" : "rose"} title={`UE ${r.code}`}>
                  {r.code} {r.bonus !== 0 ? `+${r.bonus}` : `−${r.malus}`}
                </Chip>
              ))}
            </div>
          )}

          {bonusUes.map(([code, ue]) => (
            <div key={code} className="space-y-1.5">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {code}
                {ue.bonus_description ? ` — ${ue.bonus_description}` : ""}
              </p>
              {Object.entries(ue.modules || {}).map(([modCode, mod]) => {
                const evaluations = Array.isArray(mod.evaluations)
                  ? mod.evaluations
                  : Object.values(mod.evaluations || {});
                return (
                  <div key={modCode} className="pl-2 space-y-0.5">
                    {evaluations.map((ev, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-600 dark:text-slate-300">
                          {mod.titre}
                          {ev.description ? ` — ${ev.description}` : ""}
                        </span>
                        <span className="text-slate-600 dark:text-slate-400">
                          {fmt(numericNoteValue(ev.note?.value))} · coef {toNumber(ev.coef, 1).toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Collapsible>
    </div>
  );
}
