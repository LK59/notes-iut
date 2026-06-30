import { useState } from "react";
import type { Releve } from "../types";
import { fmt, moduleAggregate, moduleWeightInUe, ueWeightInGlobal } from "../simulator";
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

/**
 * Récapitulatif matière par matière (comme en fin de bulletin ScoDoc) : chaque matière une
 * seule fois, avec son poids exact dans la moyenne générale — distinct du détail par UE
 * (qui sert à explorer/simuler), ici c'est juste "combien compte l'anglais au final".
 *
 * Une matière peut alimenter plusieurs UE à la fois (coef réparti dans chacune) : on part donc
 * de la liste canonique des modules (releve.ressources/saes, chacun présent une seule fois) et
 * on cumule son poids sur toutes les UE auxquelles il contribue, plutôt que de boucler sur les
 * UE en premier — ce qui dupliquait la ligne une fois par UE contributrice.
 */
export default function MatieresRecap({ releve, overrides }: { releve: Releve; overrides: Record<string, number> }) {
  const [open, setOpen] = useState(true);
  const ueEntries = Object.entries(releve.ues).filter(([, ue]) => ue.type !== 1);

  const rows = (["ressources", "saes"] as const)
    .flatMap((group) =>
      Object.entries(releve[group] || {}).map(([moduleCode, mod]) => {
        const agg = moduleAggregate(mod, group, moduleCode, overrides);
        const ueCodes: string[] = [];
        let weightGlobal = 0;
        let hasWeight = false;
        for (const [ueCode, ue] of ueEntries) {
          const summaries = group === "ressources" ? ue.ressources : ue.saes;
          if (!summaries || !(moduleCode in summaries)) continue;
          ueCodes.push(ueCode);
          const weightUe = moduleWeightInUe(ue, group, moduleCode);
          const ueWeightGlobal = ueWeightInGlobal(ueCode, releve.ues);
          if (weightUe !== null && ueWeightGlobal !== null) {
            weightGlobal += (weightUe * ueWeightGlobal) / 100;
            hasWeight = true;
          }
        }
        return {
          key: `${group}-${moduleCode}`,
          ueCodes,
          titre: mod.titre || moduleCode,
          value: agg.value,
          weightGlobal: hasWeight ? weightGlobal : null,
        };
      })
    )
    .sort((a, b) => (b.weightGlobal ?? 0) - (a.weightGlobal ?? 0));

  return (
    <div className="rounded-xl border border-sky-200/70 dark:border-sky-800/70 bg-sky-50/85 dark:bg-slate-900/65 backdrop-blur-lg ring-1 ring-black/5 dark:ring-white/5 shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-sky-50 dark:hover:bg-slate-800/60 rounded-t-xl"
      >
        <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-100">
          Récapitulatif par matière <span className="font-normal text-slate-500 dark:text-slate-400">— poids dans la moyenne générale</span>
        </h2>
        <Chevron open={open} />
      </button>
      <Collapsible open={open}>
        <div className="border-t border-sky-100 dark:border-slate-800 divide-y divide-sky-50 dark:divide-slate-800">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-2 px-4 py-1.5 text-sm">
              <span className="text-slate-800 dark:text-slate-100 truncate">
                {row.titre}
                <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-1.5">{row.ueCodes.join("/")}</span>
              </span>
              <span className="flex items-center gap-3 shrink-0">
                <span className="text-slate-600 dark:text-slate-300">{fmt(row.value)}</span>
                <span className="font-semibold text-violet-700 dark:text-violet-300 w-12 text-right">
                  {row.weightGlobal !== null ? `${row.weightGlobal.toFixed(1)}%` : "—"}
                </span>
              </span>
            </div>
          ))}
        </div>
      </Collapsible>
    </div>
  );
}
