import { lazy, Suspense, useState } from "react";
import type { ModuleEntry, Releve, Ue } from "../types";
import {
  evaluationWeightInModule,
  fmt,
  manualKey,
  moduleAggregate,
  moduleIsSimulated,
  moduleWeightInUe,
  numericNoteValue,
  toNumber,
  ueAggregate,
  ueIsSimulated,
  ueRang,
  ueWeightInGlobal,
} from "../simulator";
import Chip from "./Chip";
import Collapsible from "./Collapsible";

const PromoHistogram = lazy(() => import("./PromoHistogram"));

interface Props {
  ueCode: string;
  ue: Ue;
  releve: Releve;
  overrides: Record<string, number>;
  onChange: (key: string, value: number | undefined) => void;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  defaultOpen?: boolean;
  printMode?: boolean;
  newIds?: Set<number>;
}

function NewBadge() {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/50 rounded px-1.5 py-0.5 print:hidden">
      nouvelle
    </span>
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

function SimulatedBadge() {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/50 rounded px-1.5 py-0.5">
      simulé
    </span>
  );
}

export default function UeTable({
  ueCode,
  ue,
  releve,
  overrides,
  onChange,
  selectedKey,
  onSelect,
  defaultOpen = true,
  printMode = false,
  newIds,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());
  const isOpen = printMode || open;
  const ueAgg = ueAggregate(ue, releve, overrides);
  const ueSimulated = ueIsSimulated(ue, releve, overrides);
  const rang = ueRang(ue);
  const decisionUe = releve.semestre.decision_ue?.find((d) => d.acronyme === ueCode);
  const ueWeightGlobal = ueWeightInGlobal(ueCode, releve.ues);
  const bonus = toNumber(ue.bonus);
  const malus = toNumber(ue.malus);

  function toggleModule(moduleKey: string) {
    setCollapsedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleKey)) next.delete(moduleKey);
      else next.add(moduleKey);
      return next;
    });
  }

  const moduleGroups: { group: "ressources" | "saes"; label: string; entries: [string, ModuleEntry][] }[] = [
    {
      group: "ressources",
      label: "Ressources",
      entries: Object.keys(ue.ressources || {})
        .map((code) => [code, releve.ressources[code]] as [string, ModuleEntry])
        .filter(([, mod]) => mod),
    },
    {
      group: "saes",
      label: "SAÉ",
      entries: Object.keys(ue.saes || {})
        .map((code) => [code, releve.saes[code]] as [string, ModuleEntry])
        .filter(([, mod]) => mod),
    },
  ];

  return (
    <div
      className={`rounded-xl border bg-white dark:bg-slate-900 shadow-sm ${
        ueSimulated ? "border-amber-300 dark:border-amber-700 border-l-[3px]" : "border-sky-300 dark:border-sky-800"
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-sky-50 dark:hover:bg-slate-800/60 rounded-t-xl"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sky-950 dark:text-sky-100">
              {ueCode}
              {ue.titre ? ` — ${ue.titre}` : ""}
            </h3>
            {ueSimulated && <SimulatedBadge />}
          </div>
          <div className="flex items-center gap-1 flex-wrap mt-1">
            {ue.ECTS && (
              <Chip color="slate" title="ECTS acquis / total">
                ECTS {ue.ECTS.acquis ?? "-"}/{ue.ECTS.total ?? "-"}
              </Chip>
            )}
            <Chip color="slate" title="Min / Moyenne classe / Max">
              Min {fmt(ueAgg.min)} · Moy. cl. {fmt(ueAgg.moy)} · Max {fmt(ueAgg.max)}
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
            {bonus !== 0 && (
              <Chip color="emerald" title="Bonus">
                Bonus +{bonus}
              </Chip>
            )}
            {malus > 0 && (
              <Chip color="rose" title="Malus">
                Malus −{malus}
              </Chip>
            )}
            {decisionUe && (
              <Chip color="violet" title="Décision de fin de semestre pour cette UE">
                {decisionUe.code}
              </Chip>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-400">Moyenne UE</p>
            <p className="text-xl font-bold text-sky-700 dark:text-sky-300">{fmt(ueAgg.value)}</p>
          </div>
          <Chevron open={isOpen} className="text-sky-600 dark:text-sky-300 print:hidden" />
        </div>
      </button>

      <Collapsible open={isOpen}>
        <div className="border-t border-sky-200 dark:border-slate-800 px-4 py-3 space-y-4">
          {moduleGroups.map(
            ({ group, label, entries }) =>
              entries.length > 0 && (
                <div key={group}>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400 mb-2">
                    {label}
                  </h4>
                  <div className="space-y-2">
                    {entries.map(([moduleCode, mod]) => {
                      const summary = (group === "ressources" ? ue.ressources : ue.saes)?.[moduleCode];
                      const modAgg = moduleAggregate(mod, group, moduleCode, overrides);
                      const modSimulated = moduleIsSimulated(mod, group, moduleCode, overrides);
                      const hasEvaluations = mod.evaluations && mod.evaluations.length > 0;
                      const moduleKey = `${group}-${moduleCode}`;
                      const moduleCollapsed = collapsedModules.has(moduleKey);
                      const isModuleOpen = printMode || !moduleCollapsed;
                      const modWeightUe = moduleWeightInUe(ue, group, moduleCode);
                      const modWeightGlobal =
                        modWeightUe !== null && ueWeightGlobal !== null ? (modWeightUe * ueWeightGlobal) / 100 : null;

                      return (
                        <div
                          key={moduleCode}
                          className={`rounded-lg border bg-sky-50 dark:bg-slate-800/60 ${
                            modSimulated
                              ? "border-amber-300 dark:border-amber-700 border-l-[3px]"
                              : "border-sky-200 dark:border-slate-700"
                          }`}
                        >
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => hasEvaluations && toggleModule(moduleKey)}
                            onKeyDown={(e) => e.key === "Enter" && hasEvaluations && toggleModule(moduleKey)}
                            className={`flex flex-wrap items-center justify-between gap-1.5 text-sm px-2.5 py-2 ${
                              hasEvaluations ? "cursor-pointer hover:bg-sky-100 dark:hover:bg-slate-700/60 rounded-t-lg" : ""
                            }`}
                          >
                            <span className="font-medium text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                              {hasEvaluations && (
                                <Chevron open={isModuleOpen} className="text-sky-500 dark:text-sky-400 print:hidden" />
                              )}
                              {moduleCode} — {mod.titre}
                              {modSimulated && <SimulatedBadge />}
                            </span>
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                                Moy. {fmt(modAgg.value)}
                              </span>
                              {hasEvaluations && (
                                <Chip color="slate" title="Min / Moyenne classe / Max">
                                  Min {fmt(modAgg.min)} · Moy. cl. {fmt(modAgg.moy)} · Max {fmt(modAgg.max)}
                                </Chip>
                              )}
                              <Chip color="sky" title="Coefficient de ce module dans l'UE">
                                Coef {toNumber(summary?.coef, 1).toFixed(1)}
                              </Chip>
                              {modWeightUe !== null && (
                                <Chip color="violet" title="Poids dans l'UE puis dans la moyenne générale">
                                  {modWeightUe.toFixed(0)}% UE
                                  {modWeightGlobal !== null && ` · ${modWeightGlobal.toFixed(1)}% gén.`}
                                </Chip>
                              )}
                            </div>
                          </div>

                          {hasEvaluations ? (
                            <Collapsible open={isModuleOpen}>
                              <div className="space-y-0.5 px-2 pb-2">
                                {mod.evaluations!.map((evaluation, idx) => {
                                  const key = `${group}-${moduleCode}-${idx}`;
                                  const overridden = key in overrides;
                                  const realValue = numericNoteValue(evaluation.note.value);
                                  const value = overridden ? overrides[key] : realValue ?? undefined;
                                  const isSelected = selectedKey === key;
                                  const classMoy = numericNoteValue(evaluation.note.moy);
                                  const belowAverage = value !== undefined && classMoy !== null && value < classMoy;
                                  const evalWeightModule = evaluationWeightInModule(mod, idx);
                                  const evalWeightGlobal =
                                    evalWeightModule !== null && modWeightUe !== null && ueWeightGlobal !== null
                                      ? (evalWeightModule * modWeightUe * ueWeightGlobal) / 10000
                                      : null;

                                  return (
                                    <div key={key}>
                                      <div
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => onSelect(isSelected ? null : key)}
                                        onKeyDown={(e) => e.key === "Enter" && onSelect(isSelected ? null : key)}
                                        className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 cursor-pointer border transition-colors duration-150 ${
                                          isSelected
                                            ? "bg-sky-100 dark:bg-sky-900/40 border-sky-300 dark:border-sky-700"
                                            : belowAverage
                                              ? "bg-rose-50/70 dark:bg-rose-950/15 border-transparent hover:border-sky-200 dark:hover:border-slate-600"
                                              : "bg-white dark:bg-slate-900 border-transparent hover:border-sky-200 dark:hover:border-slate-600 hover:bg-sky-50 dark:hover:bg-slate-800"
                                        }`}
                                      >
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <Chevron open={isSelected} className="text-sky-500 dark:text-sky-400 print:hidden" />
                                          <span className="text-sm text-slate-700 dark:text-slate-200">
                                            {evaluation.description || "Évaluation"}
                                          </span>
                                          {newIds?.has(evaluation.id) && <NewBadge />}
                                        </div>
                                        <div className="flex items-center gap-1 flex-wrap">
                                          <Chip color="slate" title="Min / Moyenne classe / Max">
                                            Min {fmt(numericNoteValue(evaluation.note.min))} · Moy. cl.{" "}
                                            {fmt(numericNoteValue(evaluation.note.moy))} · Max{" "}
                                            {fmt(numericNoteValue(evaluation.note.max))}
                                          </Chip>
                                          <Chip color="sky" title="Coefficient de cette évaluation">
                                            Coef {toNumber(evaluation.coef, 1).toFixed(1)}
                                          </Chip>
                                          {evalWeightModule !== null && (
                                            <Chip color="violet" title="Poids dans le module puis dans la moyenne générale">
                                              {evalWeightModule.toFixed(0)}% mod.
                                              {evalWeightGlobal !== null && ` · ${evalWeightGlobal.toFixed(1)}% gén.`}
                                            </Chip>
                                          )}
                                          <span className="hidden print:inline text-sm font-medium text-slate-900">
                                            {value ?? "—"}
                                          </span>
                                          <input
                                            type="number"
                                            step="0.01"
                                            min={0}
                                            max={20}
                                            value={value ?? ""}
                                            placeholder="à saisir"
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                              const v = e.target.value;
                                              onChange(key, v === "" ? undefined : Number(v));
                                            }}
                                            className={`print:hidden w-20 rounded border px-2 py-1 text-sm text-slate-900 dark:text-slate-100 ${
                                              overridden
                                                ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700"
                                                : "border-sky-300 dark:border-slate-600 dark:bg-slate-800"
                                            }`}
                                          />
                                        </div>
                                      </div>
                                      {isSelected && !printMode && (
                                        <div className="mt-1 mb-2 px-2">
                                          <Suspense fallback={<HistogramSkeleton />}>
                                            <PromoHistogram
                                              note={evaluation.note}
                                              ma={overridden ? overrides[key] : undefined}
                                              evaluationId={evaluation.id}
                                            />
                                          </Suspense>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </Collapsible>
                          ) : (
                            <div className="flex items-center justify-between text-sm py-1.5 px-2.5 pb-2.5">
                              <span className="text-slate-600 dark:text-slate-400 italic">Pas encore d'évaluation publiée</span>
                              <span className="hidden print:inline text-sm font-medium text-slate-900">
                                {overrides[manualKey(group, moduleCode)] ?? "—"}
                              </span>
                              <input
                                type="number"
                                step="0.01"
                                min={0}
                                max={20}
                                value={overrides[manualKey(group, moduleCode)] ?? ""}
                                placeholder="simuler"
                                onChange={(e) => {
                                  const v = e.target.value;
                                  onChange(manualKey(group, moduleCode), v === "" ? undefined : Number(v));
                                }}
                                className={`print:hidden w-20 rounded border px-2 py-1 text-sm text-slate-900 dark:text-slate-100 ${
                                  manualKey(group, moduleCode) in overrides
                                    ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700"
                                    : "border-sky-300 dark:border-slate-600 dark:bg-slate-800"
                                }`}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
          )}
        </div>
      </Collapsible>
    </div>
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
