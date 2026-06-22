import { useMemo, useState } from "react";
import type { Releve } from "../types";
import { moyenneGenerale, pendingItems, solveUniformTarget, ueMoyenne } from "../simulator";
import Collapsible from "./Collapsible";

interface Props {
  releve: Releve;
  overrides: Record<string, number>;
  onApply: (keys: string[], value: number) => void;
}

const GENERAL = "__general__";

export default function ObjectiveCalculator({ releve, overrides, onApply }: Props) {
  const [scope, setScope] = useState(GENERAL);
  const [target, setTarget] = useState(10);

  const ueEntries = useMemo(() => Object.entries(releve.ues).filter(([, ue]) => ue.type !== 1), [releve]);

  const pendingKeys = useMemo(() => {
    const all = pendingItems(releve);
    if (scope === GENERAL) return all.map((p) => p.key).filter((k) => !(k in overrides));
    // Notes en attente appartenant aux modules de l'UE choisie
    const ue = releve.ues[scope];
    if (!ue) return [];
    const moduleCodes = new Set([...Object.keys(ue.ressources || {}), ...Object.keys(ue.saes || {})]);
    return all
      .map((p) => p.key)
      .filter((k) => !(k in overrides))
      .filter((k) => {
        const moduleCode = k.split("-")[1];
        return moduleCodes.has(moduleCode);
      });
  }, [releve, overrides, scope]);

  const solution = useMemo(() => {
    const evaluate =
      scope === GENERAL
        ? (o: Record<string, number>) => {
            const moyennes: Record<string, number | null> = {};
            for (const [code, ue] of Object.entries(releve.ues)) moyennes[code] = ueMoyenne(ue, releve, o);
            return moyenneGenerale(releve.ues, moyennes);
          }
        : (o: Record<string, number>) => ueMoyenne(releve.ues[scope], releve, o);
    return solveUniformTarget(overrides, pendingKeys, target, evaluate);
  }, [releve, overrides, pendingKeys, target, scope]);

  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-900 shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-sky-50 dark:hover:bg-slate-800/60 rounded-t-xl"
      >
        <div>
          <h2 className="font-semibold text-sky-900 dark:text-sky-100">Simulation d'objectif</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Quelle moyenne te faut-il sur tes évaluations non publiées restantes pour atteindre un objectif ?
          </p>
        </div>
        <Chevron open={open} />
      </button>

      <Collapsible open={open}>
      <div className="px-4 pb-4 space-y-3 max-w-full overflow-hidden">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto min-w-0">
          <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Objectif sur</label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="w-full sm:w-auto sm:max-w-[16rem] truncate rounded-md border border-sky-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-1.5 text-sm"
          >
            <option value={GENERAL}>Moyenne générale</option>
            {ueEntries.map(([code, ue]) => (
              <option key={code} value={code}>
                UE {code}
                {ue.titre ? ` — ${ue.titre}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Moyenne visée</label>
          <input
            type="number"
            step="0.5"
            min={0}
            max={20}
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            className="w-24 rounded border border-sky-300 dark:border-slate-600 dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <Result solution={solution} pendingCount={pendingKeys.length} onApply={() => solution.x !== null && onApply(pendingKeys, Math.round(solution.x * 100) / 100)} />
      </div>
      </Collapsible>
    </div>
  );
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

function Result({
  solution,
  pendingCount,
  onApply,
}: {
  solution: ReturnType<typeof solveUniformTarget>;
  pendingCount: number;
  onApply: () => void;
}) {
  if (pendingCount === 0) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Toutes les évaluations de ce périmètre sont déjà notées (ou déjà simulées) — rien à projeter.
      </p>
    );
  }
  if (solution.unreachable && solution.atMax !== null && solution.x === 20) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        Hors de portée : même avec 20/20 sur les {pendingCount} note(s) restante(s), le maximum atteignable est{" "}
        {solution.atMax.toFixed(2)}.
      </p>
    );
  }
  if (solution.alreadyMet) {
    return (
      <p className="text-sm text-emerald-600 dark:text-emerald-400">
        Objectif déjà acquis : même avec 0 sur les {pendingCount} note(s) restante(s), tu resterais à{" "}
        {solution.atMin?.toFixed(2)}.
      </p>
    );
  }
  if (solution.x === null) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">Pas assez de données pour calculer.</p>;
  }
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <p className="text-sm text-slate-700 dark:text-slate-200">
        Il te faut une moyenne d'environ{" "}
        <strong className="text-sky-700 dark:text-sky-300">{solution.x.toFixed(2)} / 20</strong> sur chacune des {pendingCount}{" "}
        note(s) restante(s).
      </p>
      <button
        onClick={onApply}
        className="rounded-md border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/40 px-3 py-1.5 text-sm text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-slate-700 whitespace-nowrap"
      >
        Appliquer aux notes manquantes
      </button>
    </div>
  );
}
