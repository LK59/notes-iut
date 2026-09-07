import { lazy, Suspense, useState } from "react";
import type { Releve } from "../types";
import {
  fmt,
  moduleAggregate,
  moduleIsSimulated,
  numericNoteValue,
  toNumber,
  ueAggregate,
  ueIsSimulated,
  ueRang,
  ueWeightInGlobal,
} from "../simulator";
import Chip from "./Chip";
import { Card, Chevron, Collapsible, comparedToClass, Grade } from "./ui";

const PromoHistogram = lazy(() => import("./PromoHistogram"));

interface Props {
  releve: Releve;
  /** Notes simulées en vue Détaillé. Elles doivent être répercutées ici : sans ça, une
   * simulation disparaissait sans un mot dès qu'on revenait sur la vue par défaut. */
  overrides: Record<string, number>;
  /** Évaluations passées de « pas de note » à « notée » depuis la dernière consultation. */
  newIds?: Set<number>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

/**
 * Vue de consultation : le regroupement par UE et les indicateurs de promo, repliés
 * par défaut. On déplie une UE puis un module pour atteindre le détail d'une évaluation
 * et sa distribution. La saisie de notes reste réservée à la vue Détaillé — mais les
 * valeurs simulées y sont affichées, et signalées comme telles.
 */
export default function SimpleView({ releve, overrides, newIds, selectedKey, onSelect }: Props) {
  const ueEntries = Object.entries(releve.ues).filter(([, ue]) => ue.type !== 1);
  const [openUes, setOpenUes] = useState<Set<string>>(new Set());
  const [openModules, setOpenModules] = useState<Set<string>>(new Set());

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) {
    setter((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {ueEntries.map(([code, ue]) => {
        const aggregate = ueAggregate(ue, releve, overrides, code);
        const simulated = ueIsSimulated(ue, releve, overrides);
        const rang = ueRang(ue);
        const weight = ueWeightInGlobal(code, releve.ues);
        const ueOpen = openUes.has(code);

        const modules = [
          ...Object.keys(ue.ressources || {}).map((c) => ({ code: c, group: "ressources" as const })),
          ...Object.keys(ue.saes || {}).map((c) => ({ code: c, group: "saes" as const })),
        ].flatMap(({ code: moduleCode, group }) => {
          const mod = (group === "ressources" ? releve.ressources : releve.saes)[moduleCode];
          if (!mod) return [];
          const summary = (group === "ressources" ? ue.ressources : ue.saes)?.[moduleCode];
          return [
            {
              moduleCode,
              group,
              mod,
              coef: summary?.coef,
              aggregate: moduleAggregate(mod, group, moduleCode, overrides, code),
              simulated: moduleIsSimulated(mod, group, moduleCode, overrides),
            },
          ];
        });

        const hasNew = modules.some(({ mod }) =>
          mod.evaluations?.some((evaluation) => newIds?.has(evaluation.id))
        );

        return (
          <Card key={code} tone={simulated ? "simulated" : "default"}>
            <button
              onClick={() => toggle(setOpenUes, code)}
              aria-expanded={ueOpen}
              className="w-full flex items-start justify-between gap-3 px-4 py-3.5 text-left rounded-xl hover:bg-inset transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-fg">{code}</h3>
                  {simulated && <Chip color="sim">simulé</Chip>}
                  {hasNew && <Chip color="pos">nouveau</Chip>}
                </div>
                {ue.titre && <p className="text-xs text-muted mt-0.5">{ue.titre}</p>}
                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                  {ue.ECTS && (
                    <Chip title="ECTS acquis sur total">
                      {ue.ECTS.acquis ?? "-"}/{ue.ECTS.total ?? "-"} ECTS
                    </Chip>
                  )}
                  <Chip title="Moyenne de la classe">classe {fmt(aggregate.moy)}</Chip>
                  {rang && (
                    <Chip title="Rang dans la promo pour cette UE">
                      rang {rang.rang}/{rang.total}
                    </Chip>
                  )}
                  {weight !== null && (
                    <Chip title="Poids de cette UE dans la moyenne générale">
                      {weight.toFixed(0)}% gén.
                    </Chip>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Neutre : la puce « simulé » et la moyenne de classe disent déjà
                    ce qu'il faut, colorer aussi le nombre noyait le signal. */}
                <Grade value={fmt(aggregate.value)} size="lg" />
                <Chevron open={ueOpen} className="text-subtle" />
              </div>
            </button>

            <Collapsible open={ueOpen}>
              <div className="border-t border-line divide-y divide-line">
                {modules.map(({ moduleCode, group, mod, coef, aggregate: modAgg, simulated: modSimulated }) => {
                  const moduleKey = `${group}-${moduleCode}`;
                  const hasEvaluations = Boolean(mod.evaluations?.length);
                  const moduleOpen = hasEvaluations && openModules.has(moduleKey);
                  return (
                    <div key={moduleKey}>
                      <div
                        role={hasEvaluations ? "button" : undefined}
                        tabIndex={hasEvaluations ? 0 : undefined}
                        onClick={() => hasEvaluations && toggle(setOpenModules, moduleKey)}
                        onKeyDown={(event) =>
                          event.key === "Enter" && hasEvaluations && toggle(setOpenModules, moduleKey)
                        }
                        className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
                          hasEvaluations ? "cursor-pointer hover:bg-inset" : ""
                        }`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0 text-sm text-fg">
                          {hasEvaluations && <Chevron open={moduleOpen} className="text-subtle" />}
                          <span className="truncate">{mod.titre || moduleCode}</span>
                          {modSimulated && <Chip color="sim">simulé</Chip>}
                        </span>
                        <span className="flex items-center gap-2.5 shrink-0">
                          {coef !== undefined && (
                            <span className="mono text-[11px] text-subtle">
                              ×{toNumber(coef, 1).toFixed(1)}
                            </span>
                          )}
                          <Grade value={fmt(modAgg.value)} size="sm" />
                        </span>
                      </div>

                      <Collapsible open={Boolean(moduleOpen)}>
                        <div className="px-2 pb-2 space-y-0.5">
                          {mod.evaluations?.map((evaluation, index) => {
                            const key = `${group}-${moduleCode}-${index}`;
                            const isSelected = selectedKey === key;
                            const overridden = key in overrides;
                            const value = overridden ? overrides[key] : numericNoteValue(evaluation.note.value);
                            const classMoy = numericNoteValue(evaluation.note.moy);
                            return (
                              <div key={key}>
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => onSelect(isSelected ? null : key)}
                                  onKeyDown={(event) => event.key === "Enter" && onSelect(isSelected ? null : key)}
                                  className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${
                                    isSelected ? "bg-accent-soft" : "hover:bg-inset"
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-[13px] text-muted truncate">
                                      {evaluation.description || "Évaluation"}
                                    </span>
                                    {newIds?.has(evaluation.id) && <Chip color="pos">nouveau</Chip>}
                                  </span>
                                  <span className="flex items-center gap-2.5 shrink-0">
                                    <span className="mono text-[11px] text-subtle">
                                      classe {fmt(classMoy)}
                                    </span>
                                    <Grade
                                      value={value === null || value === undefined ? "—" : value.toFixed(2)}
                                      size="sm"
                                      simulated={overridden}
                                      state={comparedToClass(value ?? null, classMoy)}
                                    />
                                  </span>
                                </div>
                                {isSelected && (
                                  <div className="px-2.5 pb-2 pt-1">
                                    <Suspense
                                      fallback={<div className="h-[132px] rounded-lg bg-inset animate-pulse" />}
                                    >
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
                    </div>
                  );
                })}
              </div>
            </Collapsible>
          </Card>
        );
      })}
    </div>
  );
}
