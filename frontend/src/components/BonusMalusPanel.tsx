import type { ModuleEntry, Releve } from "../types";
import { fmt, numericNoteValue, toNumber } from "../simulator";
import Chip from "./Chip";
import { Panel } from "./ui";

export default function BonusMalusPanel({ releve }: { releve: Releve }) {
  const bonusUes = Object.entries(releve.ues).filter(([, ue]) => ue.type === 1);
  const recap = Object.entries(releve.ues)
    .filter(([, ue]) => ue.type !== 1)
    .map(([code, ue]) => ({ code, bonus: toNumber(ue.bonus), malus: toNumber(ue.malus) }))
    .filter((row) => row.bonus !== 0 || row.malus > 0);

  if (bonusUes.length === 0 && recap.length === 0) return null;

  return (
    <Panel
      title="Bonus et malus"
      subtitle="Points ajoutés ou retirés aux moyennes d'UE (sport, engagement…)."
    >
      <div className="p-4 space-y-4">
        {recap.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {recap.map((row) => (
              <Chip key={row.code} color={row.bonus !== 0 ? "pos" : "neg"} title={`UE ${row.code}`}>
                {row.code} {row.bonus !== 0 ? `+${row.bonus}` : `−${row.malus}`}
              </Chip>
            ))}
          </div>
        )}

        {bonusUes.map(([code, ue]) => (
          <div key={code} className="space-y-1.5">
            <p className="text-xs font-medium text-muted">
              {code}
              {ue.bonus_description ? ` — ${ue.bonus_description}` : ""}
            </p>
            {Object.entries<ModuleEntry>(ue.modules || {}).map(([moduleCode, mod]) => {
              const evaluations = Array.isArray(mod.evaluations)
                ? mod.evaluations
                : (Object.values(mod.evaluations || {}) as typeof mod.evaluations);
              return (
                <div key={moduleCode} className="space-y-0.5">
                  {evaluations.map((evaluation, index) => (
                    <div key={index} className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="text-fg min-w-0 truncate">
                        {mod.titre}
                        {evaluation.description ? ` — ${evaluation.description}` : ""}
                      </span>
                      <span className="mono text-xs text-muted shrink-0">
                        {fmt(numericNoteValue(evaluation.note?.value))} · coef{" "}
                        {toNumber(evaluation.coef, 1).toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Panel>
  );
}
