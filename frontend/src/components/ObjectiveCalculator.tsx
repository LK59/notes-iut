import { useMemo, useState } from "react";
import type { Releve } from "../types";
import { moyenneGenerale, pendingItems, solveUniformTarget, ueMoyenne } from "../simulator";
import { Button, Panel } from "./ui";
import { SECTION_LABEL } from "./SectionNav";

interface Props {
  releve: Releve;
  overrides: Record<string, number>;
  onApply: (keys: string[], value: number) => void;
}

const GENERAL = "__general__";

export default function ObjectiveCalculator({ releve, overrides, onApply }: Props) {
  const [scope, setScope] = useState(GENERAL);
  const [target, setTarget] = useState(10);

  const ueEntries = useMemo(
    () => Object.entries(releve.ues).filter(([, ue]) => ue.type !== 1),
    [releve]
  );

  const pendingKeys = useMemo(() => {
    const all = pendingItems(releve);
    const notYetSimulated = all.map((item) => item.key).filter((key) => !(key in overrides));
    if (scope === GENERAL) return notYetSimulated;

    const ue = releve.ues[scope];
    if (!ue) return [];
    // Les clés ont la forme `${group}-${moduleCode}-${index}` : on retire le préfixe de
    // groupe et le suffixe d'index plutôt que de découper sur le premier tiret, pour rester
    // correct si un code de module en contient un.
    const moduleCodes = new Set([...Object.keys(ue.ressources || {}), ...Object.keys(ue.saes || {})]);
    return notYetSimulated.filter((key) => {
      const withoutGroup = key.replace(/^(ressources|saes)-/, "");
      const moduleCode = withoutGroup.slice(0, withoutGroup.lastIndexOf("-"));
      return moduleCodes.has(moduleCode);
    });
  }, [releve, overrides, scope]);

  const solution = useMemo(() => {
    const evaluate =
      scope === GENERAL
        ? (candidate: Record<string, number>) => {
            const moyennes: Record<string, number | null> = {};
            for (const [code, ue] of Object.entries(releve.ues)) {
              moyennes[code] = ueMoyenne(ue, releve, candidate);
            }
            return moyenneGenerale(releve.ues, moyennes);
          }
        : (candidate: Record<string, number>) => ueMoyenne(releve.ues[scope], releve, candidate);
    return solveUniformTarget(overrides, pendingKeys, target, evaluate);
  }, [releve, overrides, pendingKeys, target, scope]);

  return (
    <Panel
      title={SECTION_LABEL.objectif}
      subtitle="Quelle note te faut-il sur les évaluations restantes pour atteindre une moyenne donnée ?"
    >
      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 sm:flex-none">
            <span className="block text-xs text-muted mb-1">Portée</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              className="w-full sm:w-auto sm:max-w-[18rem] rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-fg"
            >
              <option value={GENERAL}>Moyenne générale</option>
              {ueEntries.map(([code, ue]) => (
                <option key={code} value={code}>
                  {code}
                  {ue.titre ? ` — ${ue.titre}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="block text-xs text-muted mb-1">Objectif</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              min={0}
              max={20}
              value={target}
              onChange={(event) => setTarget(Number(event.target.value))}
              className="w-24 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-fg mono"
            />
          </label>
        </div>

        <Result
          solution={solution}
          pendingCount={pendingKeys.length}
          onApply={() =>
            solution.x !== null && onApply(pendingKeys, Math.round(solution.x * 100) / 100)
          }
        />
      </div>
    </Panel>
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
      <p className="text-sm text-muted">
        Toutes les évaluations de cette portée sont déjà notées ou simulées — rien à projeter.
      </p>
    );
  }

  const notes = `${pendingCount} note${pendingCount > 1 ? "s" : ""} restante${pendingCount > 1 ? "s" : ""}`;

  if (solution.unreachable && solution.atMax !== null && solution.x === 20) {
    return (
      <p className="text-sm text-neg">
        Hors de portée : même avec 20/20 sur les {notes}, tu plafonnes à{" "}
        <span className="mono font-medium">{solution.atMax.toFixed(2)}</span>.
      </p>
    );
  }

  if (solution.alreadyMet) {
    return (
      <p className="text-sm text-pos">
        Objectif déjà acquis : même avec 0 sur les {notes}, tu restes à{" "}
        <span className="mono font-medium">{solution.atMin?.toFixed(2)}</span>.
      </p>
    );
  }

  if (solution.x === null) {
    return <p className="text-sm text-muted">Pas assez de données pour calculer.</p>;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-inset px-4 py-3">
      <p className="text-sm text-fg">
        Il te faut environ{" "}
        <span className="mono text-lg font-medium text-accent">{solution.x.toFixed(2)}</span> sur
        chacune des {notes}.
      </p>
      <Button onClick={onApply}>Appliquer comme simulation</Button>
    </div>
  );
}
