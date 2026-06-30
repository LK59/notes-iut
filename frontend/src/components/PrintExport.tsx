import type { ModuleEntry, Releve } from "../types";
import {
  fmt,
  moduleAggregate,
  moduleWeightInUe,
  numericNoteValue,
  toNumber,
  ueAggregate,
  ueRang,
  ueWeightInGlobal,
} from "../simulator";

interface Props {
  releve: Releve;
  overrides: Record<string, number>;
  username: string;
  semestreTitle: string;
  hasSimulation: boolean;
  moyenneGenerale: number | null;
}

/**
 * Rendu dédié à l'export "non officiel" — une mise en page propre en tableaux, pensée pour
 * être imprimée/exportée en PDF et transmise (ex. dossier d'études supérieures) : le PDF
 * officiel ScoDoc affiche un gros tampon "PROVISOIRE" et une mise en page peu lisible, alors
 * que les données elles-mêmes sont identiques.
 */
export default function PrintExport({ releve, overrides, username, semestreTitle, hasSimulation, moyenneGenerale }: Props) {
  const ueEntries = Object.entries(releve.ues).filter(([, ue]) => ue.type !== 1);
  const etu = releve.etudiant;
  const nomComplet = etu ? `${etu.prenom ?? ""} ${etu.nom ?? ""}`.trim() : username;

  // Une matière peut alimenter plusieurs UE à la fois : on part de la liste canonique des
  // modules (chacun présent une seule fois dans releve.ressources/saes) et on cumule son poids
  // sur toutes les UE contributrices, plutôt que de dupliquer la ligne une fois par UE.
  const recapRows = (["ressources", "saes"] as const)
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
          ueCode: ueCodes.join("/"),
          titre: mod.titre || moduleCode,
          value: agg.value,
          weightGlobal: hasWeight ? weightGlobal : null,
        };
      })
    )
    .sort((a, b) => (b.weightGlobal ?? 0) - (a.weightGlobal ?? 0));

  return (
    <div className="hidden print:block text-black text-[11px] leading-snug">
      <div className="flex items-baseline justify-between border-b-2 border-sky-700 pb-2 mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-sky-700">IUT Annecy</p>
          <h1 className="text-xl font-bold">Relevé de notes — {semestreTitle}</h1>
        </div>
        <p className="text-[10px] text-neutral-500 text-right">
          Généré le {new Date().toLocaleDateString("fr-FR")} à{" "}
          {new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>

      <div className="flex justify-between mb-3">
        <div>
          <p className="font-semibold text-sm">{nomComplet}</p>
          {releve.formation?.titre && <p className="text-neutral-600">{releve.formation.titre}</p>}
        </div>
        <table className="border-collapse">
          <tbody>
            <tr>
              <td className="font-semibold py-0.5 pr-4">Moyenne générale</td>
              <td className="py-0.5 font-semibold">{moyenneGenerale !== null ? moyenneGenerale.toFixed(2) : "—"} / 20</td>
            </tr>
            {releve.semestre.rang && (
              <tr>
                <td className="font-semibold py-0.5 pr-4">Rang général</td>
                <td className="py-0.5">
                  {releve.semestre.rang.value} / {releve.semestre.rang.total}
                </td>
              </tr>
            )}
            {releve.semestre.ECTS && (
              <tr>
                <td className="font-semibold py-0.5 pr-4">ECTS</td>
                <td className="py-0.5">
                  {releve.semestre.ECTS.acquis ?? "-"} / {releve.semestre.ECTS.total ?? "-"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasSimulation && (
        <p className="mb-3 text-amber-700 bg-amber-50 border border-amber-300 rounded px-2 py-1 inline-block">
          Ce document contient des notes simulées (non publiées par l'établissement) — voir colonne « simulé ».
        </p>
      )}

      <div className="mb-4" style={{ breakInside: "avoid" }}>
        <h2 className="text-sm font-semibold border-b border-neutral-400 pb-0.5 mb-1">Récapitulatif par matière</h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-neutral-600 border-b border-neutral-300">
              <th className="py-0.5 pr-2 font-medium">Matière</th>
              <th className="py-0.5 pr-2 font-medium">UE</th>
              <th className="py-0.5 pr-2 font-medium">Moyenne</th>
              <th className="py-0.5 font-medium">Poids dans la moyenne générale</th>
            </tr>
          </thead>
          <tbody>
            {recapRows.map((row) => (
              <tr key={row.key} className="border-b border-neutral-100">
                <td className="py-0.5 pr-2">{row.titre}</td>
                <td className="py-0.5 pr-2">{row.ueCode}</td>
                <td className="py-0.5 pr-2">{fmt(row.value)}</td>
                <td className="py-0.5">{row.weightGlobal !== null ? `${row.weightGlobal.toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ueEntries.map(([code, ue]) => {
        const ueAgg = ueAggregate(ue, releve, overrides);
        const rang = ueRang(ue);
        const modules: { code: string; mod: ModuleEntry; group: "ressources" | "saes" }[] = [
          ...Object.keys(ue.ressources || {})
            .map((c) => ({ code: c, mod: releve.ressources[c], group: "ressources" as const }))
            .filter((m) => m.mod),
          ...Object.keys(ue.saes || {})
            .map((c) => ({ code: c, mod: releve.saes[c], group: "saes" as const }))
            .filter((m) => m.mod),
        ];

        return (
          <div key={code} className="mb-4" style={{ breakInside: "avoid" }}>
            <h2 className="text-sm font-semibold border-b border-neutral-400 pb-0.5 mb-1">
              {code}
              {ue.titre ? ` — ${ue.titre}` : ""} — Moyenne {fmt(ueAgg.value)}
              {rang ? ` (rang ${rang.rang}/${rang.total})` : ""}
            </h2>
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-neutral-600 border-b border-neutral-300">
                  <th className="py-0.5 pr-2 font-medium">Module / évaluation</th>
                  <th className="py-0.5 pr-2 font-medium">Note</th>
                  <th className="py-0.5 pr-2 font-medium">Coef</th>
                  <th className="py-0.5 pr-2 font-medium">Moy. cl.</th>
                  <th className="py-0.5 font-medium">Simulé</th>
                </tr>
              </thead>
              <tbody>
                {modules.map(({ code: moduleCode, mod, group }) => {
                  const modAgg = moduleAggregate(mod, group, moduleCode, overrides);
                  const summary = (group === "ressources" ? ue.ressources : ue.saes)?.[moduleCode];
                  return (
                    <>
                      <tr key={moduleCode} className="border-b border-neutral-200">
                        <td className="py-0.5 pr-2 font-medium">
                          {moduleCode} — {mod.titre}
                        </td>
                        <td className="py-0.5 pr-2 font-medium">{fmt(modAgg.value)}</td>
                        <td className="py-0.5 pr-2">{toNumber(summary?.coef, 1).toFixed(1)}</td>
                        <td className="py-0.5 pr-2">{fmt(modAgg.moy)}</td>
                        <td className="py-0.5"></td>
                      </tr>
                      {(mod.evaluations ?? []).map((evaluation, idx) => {
                        const key = `${group}-${moduleCode}-${idx}`;
                        const overridden = key in overrides;
                        const value = overridden ? overrides[key] : numericNoteValue(evaluation.note.value);
                        return (
                          <tr key={key} className="text-neutral-700 border-b border-neutral-100">
                            <td className="py-0.5 pr-2 pl-3 italic">{evaluation.description || "Évaluation"}</td>
                            <td className="py-0.5 pr-2">{value ?? "—"}</td>
                            <td className="py-0.5 pr-2">{toNumber(evaluation.coef, 1).toFixed(1)}</td>
                            <td className="py-0.5 pr-2">
                              {fmt(numericNoteValue(evaluation.note.moy))}
                              <span className="text-neutral-400">
                                {" "}
                                (min {fmt(numericNoteValue(evaluation.note.min))} · max {fmt(numericNoteValue(evaluation.note.max))})
                              </span>
                            </td>
                            <td className="py-0.5">{overridden ? "oui" : ""}</td>
                          </tr>
                        );
                      })}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      <p className="mt-6 pt-2 border-t border-neutral-300 text-[9px] text-neutral-500">
        Document généré automatiquement par l'application non-officielle « Notes IUT Annecy » à partir des données du
        portail ScoDoc de l'étudiant. Les valeurs reprennent fidèlement celles du bulletin officiel ; seule la
        présentation diffère. En cas de notes simulées (mention ci-dessus), celles-ci ne reflètent aucune décision de
        l'établissement.
      </p>
    </div>
  );
}
