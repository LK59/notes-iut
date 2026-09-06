import type { Releve } from "../types";
import { fmt, moduleAggregate, moduleIsSimulated, moduleWeightInUe, ueWeightInGlobal } from "../simulator";
import { Grade, Panel } from "./ui";
import { SECTION_LABEL } from "./SectionNav";
import { comparedToClass } from "./SimpleView";

/**
 * Récapitulatif matière par matière, avec le poids exact de chacune dans la moyenne
 * générale — distinct du détail par UE (qui sert à explorer et simuler) : ici la
 * question est « combien compte l'anglais, au final ».
 *
 * Une matière peut alimenter plusieurs UE à la fois (coef réparti dans chacune) : on part
 * donc de la liste canonique des modules (releve.ressources/saes, chacun présent une seule
 * fois) et on cumule son poids sur toutes les UE auxquelles il contribue, plutôt que de
 * boucler sur les UE en premier — ce qui dupliquait la ligne une fois par UE contributrice.
 */
export default function MatieresRecap({
  releve,
  overrides,
}: {
  releve: Releve;
  overrides: Record<string, number>;
}) {
  const ueEntries = Object.entries(releve.ues).filter(([, ue]) => ue.type !== 1);

  const rows = (["ressources", "saes"] as const)
    .flatMap((group) =>
      Object.entries(releve[group] || {}).map(([moduleCode, mod]) => {
        const aggregate = moduleAggregate(mod, group, moduleCode, overrides);
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
          aggregate,
          simulated: moduleIsSimulated(mod, group, moduleCode, overrides),
          weightGlobal: hasWeight ? weightGlobal : null,
        };
      })
    )
    .sort((a, b) => (b.weightGlobal ?? 0) - (a.weightGlobal ?? 0));

  const maxWeight = Math.max(...rows.map((row) => row.weightGlobal ?? 0), 1);

  return (
    <Panel
      title={SECTION_LABEL["par-matiere"]}
      subtitle="Chaque matière une fois, triée par son poids réel dans la moyenne générale."
      defaultOpen
    >
      <div className="divide-y divide-line">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-fg truncate">{row.titre}</p>
              <p className="mono text-[11px] text-subtle truncate">{row.ueCodes.join(" / ")}</p>
            </div>

            {/* Le poids est la donnée du bloc : une barre le rend comparable d'une ligne
                à l'autre bien plus vite qu'une colonne de pourcentages. */}
            <div className="hidden sm:flex items-center gap-2 w-32 shrink-0">
              <div className="h-1.5 flex-1 rounded-full bg-inset overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent/70"
                  style={{ width: `${((row.weightGlobal ?? 0) / maxWeight) * 100}%` }}
                />
              </div>
            </div>

            <span className="mono text-xs text-muted w-12 text-right shrink-0">
              {row.weightGlobal !== null ? `${row.weightGlobal.toFixed(1)}%` : "—"}
            </span>
            <span className="w-12 text-right shrink-0">
              <Grade
                value={fmt(row.aggregate.value)}
                size="sm"
                simulated={row.simulated}
                state={comparedToClass(row.aggregate.value, row.aggregate.moy)}
              />
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
