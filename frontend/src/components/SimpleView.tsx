import { lazy, Suspense, useState } from "react";
import type { Releve } from "../types";
import { fmt, moduleAggregate, numericNoteValue, toNumber, ueAggregate, ueRang, ueWeightInGlobal } from "../simulator";
import Chip from "./Chip";

const PromoHistogram = lazy(() => import("./PromoHistogram"));

interface Props {
  releve: Releve;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

/**
 * Vue par défaut : garde le regroupement par UE et les données globales (moyenne, rang, ECTS,
 * poids) mais replié par défaut — on déplie une UE puis un module pour aller jusqu'au détail
 * d'une évaluation et voir sa distribution dans la promo, comme en vue complète.
 */
export default function SimpleView({ releve, selectedKey, onSelect }: Props) {
  const ueEntries = Object.entries(releve.ues).filter(([, ue]) => ue.type !== 1);
  const [collapsedUes, setCollapsedUes] = useState<Set<string>>(new Set());
  // Modules repliés par défaut (contrairement aux UE) : un set des modules explicitement
  // ouverts, pas des repliés, pour ne pas avoir à le pré-remplir avec toutes les clés au montage.
  const [openModules, setOpenModules] = useState<Set<string>>(new Set());

  function toggleUe(code: string) {
    setCollapsedUes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleModule(moduleKey: string) {
    setOpenModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleKey)) next.delete(moduleKey);
      else next.add(moduleKey);
      return next;
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
      {ueEntries.map(([code, ue]) => {
        const ueAgg = ueAggregate(ue, releve, {});
        const rang = ueRang(ue);
        const ueWeightGlobal = ueWeightInGlobal(code, releve.ues);
        const ueOpen = !collapsedUes.has(code);

        const modules = [
          ...Object.keys(ue.ressources || {}).map((c) => ({ code: c, group: "ressources" as const })),
          ...Object.keys(ue.saes || {}).map((c) => ({ code: c, group: "saes" as const })),
        ]
          .map(({ code: moduleCode, group }) => {
            const mod = (group === "ressources" ? releve.ressources : releve.saes)[moduleCode];
            if (!mod) return null;
            const summary = (group === "ressources" ? ue.ressources : ue.saes)?.[moduleCode];
            const agg = moduleAggregate(mod, group, moduleCode, {});
            return { moduleCode, group, mod, coef: summary?.coef, value: agg.value };
          })
          .filter((m): m is { moduleCode: string; group: "ressources" | "saes"; mod: NonNullable<typeof m>["mod"]; coef: number | string | undefined; value: number | null } => m !== null);

        return (
          <div key={code} className="rounded-xl border border-sky-300/70 dark:border-sky-800/70 bg-sky-50/85 dark:bg-slate-900/65 backdrop-blur-lg ring-1 ring-black/5 dark:ring-white/5 shadow-sm">
            <button
              onClick={() => toggleUe(code)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-sky-50 dark:hover:bg-slate-800/60 rounded-t-xl"
            >
              <div className="min-w-0">
                <h3 className="font-semibold text-sky-950 dark:text-sky-100">
                  {code}
                  {ue.titre ? ` — ${ue.titre}` : ""}
                </h3>
                <div className="flex items-center gap-1 flex-wrap mt-1.5">
                  {ue.ECTS && (
                    <Chip color="slate" title="ECTS acquis / total">
                      ECTS {ue.ECTS.acquis ?? "-"}/{ue.ECTS.total ?? "-"}
                    </Chip>
                  )}
                  <Chip color="slate" title="Moyenne de la classe sur cette UE">
                    Moy. cl. {fmt(ueAgg.moy)}
                  </Chip>
                  {rang && (
                    <Chip color="sky" title="Rang dans la promo pour cette UE">
                      Rang {rang.rang}/{rang.total}
                    </Chip>
                  )}
                  {ueWeightGlobal !== null && (
                    <Chip color="violet" title="Poids de cette UE dans la moyenne générale">
                      {ueWeightGlobal.toFixed(0)}% gén.
                    </Chip>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <p className="text-xl font-bold text-sky-700 dark:text-sky-300">{fmt(ueAgg.value)}</p>
                <Chevron open={ueOpen} className="text-sky-600 dark:text-sky-300" />
              </div>
            </button>

            {ueOpen && (
              <div className="border-t border-sky-100 dark:border-slate-800 divide-y divide-sky-50 dark:divide-slate-800">
                {modules.map(({ moduleCode, group, mod, coef, value }) => {
                  const moduleKey = `${group}-${moduleCode}`;
                  const hasEvaluations = mod.evaluations && mod.evaluations.length > 0;
                  const moduleOpen = hasEvaluations && openModules.has(moduleKey);
                  return (
                    <div key={moduleKey}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => hasEvaluations && toggleModule(moduleKey)}
                        onKeyDown={(e) => e.key === "Enter" && hasEvaluations && toggleModule(moduleKey)}
                        className={`flex items-center justify-between gap-3 px-4 py-2 ${
                          hasEvaluations ? "cursor-pointer hover:bg-sky-50 dark:hover:bg-slate-800/60" : ""
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200 truncate">
                          {hasEvaluations && <Chevron open={!!moduleOpen} className="text-sky-500 dark:text-sky-400" />}
                          {mod.titre || moduleCode}
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          {coef !== undefined && (
                            <Chip color="sky" title="Coefficient">
                              Coef {toNumber(coef, 1).toFixed(1)}
                            </Chip>
                          )}
                          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{fmt(value)}</span>
                        </span>
                      </div>

                      {moduleOpen && (
                        <div className="px-2 pb-2 space-y-0.5">
                          {mod.evaluations!.map((evaluation, idx) => {
                            const key = `${group}-${moduleCode}-${idx}`;
                            const isSelected = selectedKey === key;
                            const evalValue = numericNoteValue(evaluation.note.value);
                            return (
                              <div key={key}>
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => onSelect(isSelected ? null : key)}
                                  onKeyDown={(e) => e.key === "Enter" && onSelect(isSelected ? null : key)}
                                  className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 cursor-pointer border ${
                                    isSelected
                                      ? "bg-sky-100 dark:bg-sky-900/40 border-sky-300 dark:border-sky-700"
                                      : "bg-white dark:bg-slate-900 border-transparent hover:border-sky-200 dark:hover:border-slate-600 hover:bg-sky-50 dark:hover:bg-slate-800"
                                  }`}
                                >
                                  <span className="text-sm text-slate-700 dark:text-slate-200 truncate">
                                    {evaluation.description || "Évaluation"}
                                  </span>
                                  <span className="flex items-center gap-2 shrink-0">
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                      Moy. cl. {fmt(numericNoteValue(evaluation.note.moy))}
                                    </span>
                                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                                      {evalValue ?? "—"}
                                    </span>
                                  </span>
                                </div>
                                {isSelected && (
                                  <div className="mt-1 mb-2 px-2">
                                    <Suspense fallback={<HistogramSkeleton />}>
                                      <PromoHistogram note={evaluation.note} ma={undefined} evaluationId={evaluation.id} />
                                    </Suspense>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Chevron({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""} ${className}`}
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

function HistogramSkeleton() {
  return (
    <div className="h-[140px] flex items-end justify-around gap-2 px-2 animate-pulse">
      {[60, 90, 40, 75].map((h, i) => (
        <div key={i} className="w-10 rounded-t bg-sky-100 dark:bg-slate-700" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
