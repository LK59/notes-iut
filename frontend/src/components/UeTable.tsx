import { lazy, memo, Suspense, useState } from "react";
import type { ModuleEntry, Releve, Ue } from "../types";
import {
  evaluationWeightInModule,
  fmt,
  manualKey,
  moduleAggregate,
  moduleIsSimulated,
  moduleWeightInUe,
  numericNoteValue,
  overridesEqualForUe,
  toNumber,
  ueAggregate,
  ueIsSimulated,
  ueRang,
  ueWeightInGlobal,
} from "../simulator";
import Chip from "./Chip";
import { activationHandler, Card, Chevron, Collapsible, Grade, NoteInput } from "./ui";

const PromoHistogram = lazy(() => import("./PromoHistogram"));

/** Gouttière des moyennes : même largeur et même alignement aux trois niveaux
 * (UE, module, évaluation), pour que la hiérarchie se lise sur un seul axe vertical.
 * Avant, la moyenne d'un module était posée en bout d'une ligne de pastilles qui
 * passait à la ligne selon la longueur du titre : la colonne ne tombait jamais deux
 * fois au même endroit. */
const GRADE_COL = "shrink-0 w-16 text-right";

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

/**
 * Détail complet d'une UE, avec saisie de notes simulées.
 *
 * Mémoïsé avec un comparateur sur mesure (voir en bas de fichier). Un memo() par défaut ne
 * servait à rien ici : `overrides` est un objet neuf à chaque caractère saisi et `onChange`
 * une fonction neuve à chaque rendu du tableau de bord, donc la comparaison superficielle
 * échouait toujours et toutes les UE de la page étaient re-rendues à chaque frappe.
 */
function UeTable({
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

  const aggregate = ueAggregate(ue, releve, overrides, ueCode);
  const simulated = ueIsSimulated(ue, releve, overrides);
  const rang = ueRang(ue);
  const decision = releve.semestre.decision_ue?.find((d) => d.acronyme === ueCode);
  const ueWeightGlobal = ueWeightInGlobal(ueCode, releve.ues);
  const bonus = toNumber(ue.bonus);
  const malus = toNumber(ue.malus);

  function toggleModule(moduleKey: string) {
    setCollapsedModules((previous) => {
      const next = new Set(previous);
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
    <Card tone={simulated ? "simulated" : "default"}>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={isOpen}
        className="w-full flex items-start justify-between gap-3 px-4 py-4 text-left rounded-xl hover:bg-inset transition-colors"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-fg">{ueCode}</h3>
            {simulated && <Chip color="sim">simulé</Chip>}
            {decision && <Chip color="accent" title="Décision de fin de semestre">{decision.code}</Chip>}
          </div>
          {ue.titre && <p className="text-xs text-muted mt-1">{ue.titre}</p>}
          <div className="flex items-center gap-2 flex-wrap mt-2">
            {/* Deux pastilles par niveau, toujours dans le même ordre : ce que pèse la
                ligne, puis où elle se situe dans la promo. Quatre pastilles séparées
                débordaient systématiquement sur une seconde ligne, la dernière restant
                seule — le rythme se cassait à chaque carte. */}
            {(ue.ECTS || ueWeightGlobal !== null) && (
              <Chip title="ECTS acquis sur total, et poids de cette UE dans la moyenne générale">
                {ue.ECTS && `${ue.ECTS.acquis ?? "-"}/${ue.ECTS.total ?? "-"} ECTS`}
                {ue.ECTS && ueWeightGlobal !== null && " · "}
                {ueWeightGlobal !== null && `${ueWeightGlobal.toFixed(0)}% gén.`}
              </Chip>
            )}
            <Chip title="Rang dans la promo et moyenne de la classe sur cette UE">
              {rang ? `${rang.rang}/${rang.total} · ` : ""}classe {fmt(aggregate.moy)}
            </Chip>
            {bonus !== 0 && <Chip color="pos" title="Bonus appliqué à l'UE">bonus +{bonus}</Chip>}
            {malus > 0 && <Chip color="neg" title="Malus appliqué à l'UE">malus −{malus}</Chip>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Agrégat : neutre. L'état « simulé » est déjà porté par la puce et la
              bordure de la carte, et la moyenne de classe est affichée juste au-dessus. */}
          <span className={GRADE_COL}>
            <Grade value={fmt(aggregate.value)} size="lg" />
          </span>
          <Chevron open={isOpen} className="text-subtle print:hidden" />
        </div>
      </button>

      <Collapsible open={isOpen}>
        <div className="border-t border-line px-3 py-3 space-y-4">
          {moduleGroups.map(
            ({ group, label, entries }) =>
              entries.length > 0 && (
                <div key={group}>
                  <h4 className="px-1 mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">
                    {label}
                  </h4>
                  <div className="space-y-2">
                    {entries.map(([moduleCode, mod]) => {
                      const summary = (group === "ressources" ? ue.ressources : ue.saes)?.[moduleCode];
                      const modAgg = moduleAggregate(mod, group, moduleCode, overrides, ueCode);
                      const modSimulated = moduleIsSimulated(mod, group, moduleCode, overrides);
                      const hasEvaluations = Boolean(mod.evaluations?.length);
                      const moduleKey = `${group}-${moduleCode}`;
                      const isModuleOpen = printMode || !collapsedModules.has(moduleKey);
                      const modWeightUe = moduleWeightInUe(ue, group, moduleCode);
                      const modWeightGlobal =
                        modWeightUe !== null && ueWeightGlobal !== null
                          ? (modWeightUe * ueWeightGlobal) / 100
                          : null;

                      return (
                        <div
                          key={moduleCode}
                          className={`rounded-lg bg-inset/60 ${
                            modSimulated ? "border border-sim/40" : ""
                          }`}
                        >
                          <div
                            role={hasEvaluations ? "button" : undefined}
                            tabIndex={hasEvaluations ? 0 : undefined}
                            onClick={() => hasEvaluations && toggleModule(moduleKey)}
                            onKeyDown={activationHandler(
                              () => hasEvaluations && toggleModule(moduleKey)
                            )}
                            className={`flex items-start justify-between gap-2 px-3 py-2 ${
                              hasEvaluations ? "cursor-pointer rounded-t-lg hover:bg-inset" : ""
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2 min-w-0 text-[13px] font-medium text-fg">
                                {hasEvaluations && (
                                  <Chevron open={isModuleOpen} className="text-subtle print:hidden" />
                                )}
                                <span className="truncate">{mod.titre || moduleCode}</span>
                                {modSimulated && <Chip color="sim">simulé</Chip>}
                              </span>
                              <span className="mt-1 flex items-center gap-2 flex-wrap">
                                {/* Le poids dans la moyenne générale se déduit de celui de l'UE,
                                    affiché juste au-dessus : le répéter ici doublait la pastille. */}
                                <Chip title="Coefficient, et poids de ce module dans l'UE">
                                  coef {toNumber(summary?.coef, 1).toFixed(1)}
                                  {modWeightUe !== null && ` · ${modWeightUe.toFixed(0)}% UE`}
                                </Chip>
                                {hasEvaluations && (
                                  <Chip title="Moyenne de la classe sur ce module">
                                    classe {fmt(modAgg.moy)}
                                  </Chip>
                                )}
                              </span>
                            </span>
                            <span className={GRADE_COL}>
                              <Grade value={fmt(modAgg.value)} size="md" />
                            </span>
                          </div>

                          {hasEvaluations ? (
                            <Collapsible open={isModuleOpen}>
                              <div className="px-2 pb-2 space-y-1">
                                {mod.evaluations!.map((evaluation, index) => {
                                  const key = `${group}-${moduleCode}-${index}`;
                                  const overridden = key in overrides;
                                  const realValue = numericNoteValue(evaluation.note.value);
                                  const value = overridden ? overrides[key] : realValue ?? undefined;
                                  const isSelected = selectedKey === key;
                                  const classMoy = numericNoteValue(evaluation.note.moy);
                                  const evalWeightModule = evaluationWeightInModule(mod, index);
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
                                        onKeyDown={activationHandler(() =>
                                          onSelect(isSelected ? null : key)
                                        )}
                                        className={`flex items-start justify-between gap-2 rounded-lg px-2 py-2 cursor-pointer transition-colors ${
                                          isSelected ? "bg-accent-soft" : "bg-surface hover:bg-inset"
                                        }`}
                                      >
                                        <span className="min-w-0 flex-1">
                                          <span className="flex items-center gap-2 min-w-0">
                                            <Chevron open={isSelected} className="text-subtle print:hidden" />
                                            <span className="text-[13px] text-fg truncate">
                                              {evaluation.description || "Évaluation"}
                                            </span>
                                            {newIds?.has(evaluation.id) && <Chip color="pos">nouveau</Chip>}
                                          </span>
                                          <span className="mt-1 flex items-center gap-2 flex-wrap">
                                            <Chip title="Coefficient, et poids de cette évaluation dans le module">
                                              coef {toNumber(evaluation.coef, 1).toFixed(1)}
                                              {evalWeightModule !== null &&
                                                ` · ${evalWeightModule.toFixed(0)}% mod.`}
                                            </Chip>
                                            <Chip title="Min · moyenne de classe · max sur la promo">
                                              {fmt(numericNoteValue(evaluation.note.min))} ·{" "}
                                              {fmt(classMoy)} ·{" "}
                                              {fmt(numericNoteValue(evaluation.note.max))}
                                            </Chip>
                                          </span>
                                        </span>
                                        <span className={`${GRADE_COL} flex justify-end`}>
                                          <span className="hidden print:inline mono text-sm">
                                            {value ?? "—"}
                                          </span>
                                          <NoteInput
                                            value={value}
                                            simulated={overridden}
                                            placeholder="à venir"
                                            ariaLabel={`Note pour ${evaluation.description || "cette évaluation"}`}
                                            onChange={(next) => onChange(key, next)}
                                          />
                                        </span>
                                      </div>
                                      {isSelected && !printMode && (
                                        <div className="px-2 pt-1.5 pb-2">
                                          <Suspense
                                            fallback={
                                              <div className="h-[132px] rounded-lg bg-inset animate-pulse" />
                                            }
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
                          ) : (
                            <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1">
                              <span className="text-xs text-subtle italic">Aucune évaluation publiée</span>
                              <span className="hidden print:inline mono text-sm">
                                {overrides[manualKey(group, moduleCode)] ?? "—"}
                              </span>
                              <NoteInput
                                value={overrides[manualKey(group, moduleCode)]}
                                simulated={manualKey(group, moduleCode) in overrides}
                                placeholder="note"
                                ariaLabel={`Note simulée pour le module ${mod.titre || moduleCode}`}
                                onChange={(next) => onChange(manualKey(group, moduleCode), next)}
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
    </Card>
  );
}

export default memo(UeTable, (prev, next) => {
  return (
    prev.ueCode === next.ueCode &&
    prev.ue === next.ue &&
    prev.releve === next.releve &&
    prev.onChange === next.onChange &&
    prev.onSelect === next.onSelect &&
    prev.selectedKey === next.selectedKey &&
    prev.defaultOpen === next.defaultOpen &&
    prev.printMode === next.printMode &&
    prev.newIds === next.newIds &&
    overridesEqualForUe(next.ue, prev.overrides, next.overrides)
  );
});
