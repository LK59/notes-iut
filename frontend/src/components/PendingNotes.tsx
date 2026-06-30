import { useState } from "react";
import type { PendingItem } from "../simulator";
import Collapsible from "./Collapsible";

interface Props {
  items: PendingItem[];
  overrides: Record<string, number>;
  onChange: (key: string, value: number | undefined) => void;
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

export default function PendingNotes({ items, overrides, onChange }: Props) {
  const [open, setOpen] = useState(true);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm text-emerald-700 dark:text-emerald-300">
        Toutes les notes publiées sont saisies — aucune note manquante à simuler pour ce semestre.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sky-200/70 dark:border-sky-800/70 bg-sky-50/85 dark:bg-slate-900/65 backdrop-blur-lg ring-1 ring-black/5 dark:ring-white/5 shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 pt-4 pb-2 text-left hover:bg-sky-50 dark:hover:bg-slate-800/60 rounded-t-xl"
      >
        <div>
          <h2 className="font-semibold text-sky-900 dark:text-sky-100">Notes pas encore publiées — {items.length}</h2>
          <p className="text-xs text-sky-700/80 dark:text-sky-300/70">
            Saisis une estimation pour simuler ton résultat ; le détail par UE plus bas se mettra à jour automatiquement.
          </p>
        </div>
        <Chevron open={open} />
      </button>
      <Collapsible open={open}>
        <div className="divide-y divide-sky-100 dark:divide-slate-800 pb-2">
          {items.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3 px-4 py-2">
              <div className="min-w-0">
                <p className="text-sm text-slate-700 dark:text-slate-200 truncate">{item.evalLabel}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
                  {item.moduleLabel} · UE {item.ueLabel}
                </p>
              </div>
              <input
                type="number"
                step="0.01"
                min={0}
                max={20}
                value={overrides[item.key] ?? ""}
                placeholder="note"
                onChange={(e) => {
                  const v = e.target.value;
                  onChange(item.key, v === "" ? undefined : Number(v));
                }}
                className="w-20 shrink-0 rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-2 py-1.5 text-sm text-slate-900 dark:text-amber-100"
              />
            </div>
          ))}
        </div>
      </Collapsible>
    </div>
  );
}
