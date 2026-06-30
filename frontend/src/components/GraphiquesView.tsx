import { Suspense, lazy, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Releve, Semestre, Ue } from "../types";
import { numericNoteValue, round2, ueAggregate } from "../simulator";
import type { SemestrePoint } from "./EvolutionChart";
import { useDarkMode } from "../theme";

const RadarUE = lazy(() => import("./RadarUE"));
const EvolutionChart = lazy(() => import("./EvolutionChart"));

interface Props {
  releve: Releve;
  overrides: Record<string, number>;
  ueMoyennes: Record<string, number | null>;
  evolution: SemestrePoint[];
  allReleves: Record<string, Releve>;
  semestres: Semestre[];
  currentSemestreId: string | null;
}

function semLabel(s: Semestre): string {
  if (s.semestre_id && s.annee_scolaire) return `S${s.semestre_id} ${s.annee_scolaire}`;
  if (s.semestre_id) return `S${s.semestre_id}`;
  return s.titre;
}


// Pour les semestres archivés dans ScoDoc, ue.ressources/saes est souvent vide →
// ueAggregate retourne null. On lit alors la moyenne officielle directement sur ue.moyenne.
function cmpUeMoyenne(ue: Ue, releve: Releve): number | null {
  const agg = ueAggregate(ue, releve, {}).value;
  if (agg !== null) return agg;
  const m = ue.moyenne;
  if (m === null || m === undefined) return null;
  if (typeof m === "object") return numericNoteValue((m as { value?: number | string | null }).value ?? null);
  return numericNoteValue(m as number | string);
}

export default function GraphiquesView({ releve, overrides, ueMoyennes, evolution, allReleves, semestres, currentSemestreId }: Props) {
  const dark = useDarkMode();
  const gridColor = dark ? "#1e3a5f" : "#bae6fd";
  const xTickColor = dark ? "#7dd3fc" : "#0369a1";
  const yTickColor = dark ? "#94a3b8" : "#64748b";
  const myBarColor = dark ? "#38bdf8" : "#0284c7";
  const promoBarColor = dark ? "#0c4a6e" : "#bae6fd";
  const rangeBarColor = dark ? "#164e63" : "#e0f2fe";
  const classMoyColor = dark ? "#94a3b8" : "#64748b";
  const belowColor = dark ? "#fb7185" : "#f43f5e";
  const aboveColor = dark ? "#38bdf8" : "#0284c7";
  const compareBarColor = dark ? "#a78bfa" : "#7c3aed";
  const tooltipStyle = {
    background: dark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.95)",
    border: dark ? "1px solid #334155" : "1px solid #bae6fd",
    borderRadius: "6px",
    color: dark ? "#e2e8f0" : "#0f172a",
    fontSize: 12,
  };

  // Tri par numero pour un ordre stable et cohérent avec le semestre comparé
  const ueEntries = Object.entries(releve.ues)
    .filter(([, ue]) => ue.type !== 1)
    .sort((a, b) => a[1].numero - b[1].numero);

  const comparisonData = ueEntries.map(([code, ue]) => {
    const agg = ueAggregate(ue, releve, overrides);
    return { ue: code, moi: round2(agg.value), promo: round2(agg.moy) };
  });

  const evalData = ueEntries.flatMap(([ueCode, ue]) => {
    const groups: { group: "ressources" | "saes"; codes: string[] }[] = [
      { group: "ressources", codes: Object.keys(ue.ressources || {}) },
      { group: "saes", codes: Object.keys(ue.saes || {}) },
    ];
    return groups.flatMap(({ group, codes }) =>
      codes.flatMap((moduleCode) => {
        const mod = (group === "ressources" ? releve.ressources : releve.saes)[moduleCode];
        if (!mod?.evaluations) return [];
        return mod.evaluations.map((evaluation, idx) => {
          const key = `${group}-${moduleCode}-${idx}`;
          const value = key in overrides ? overrides[key] : numericNoteValue(evaluation.note.value);
          const classMoy = numericNoteValue(evaluation.note.moy);
          const min = numericNoteValue(evaluation.note.min);
          const max = numericNoteValue(evaluation.note.max);
          return {
            label: evaluation.description || moduleCode,
            ue: ueCode,
            value: value === null ? null : round2(value),
            classMoy: classMoy === null ? null : round2(classMoy),
            min: min === null ? null : round2(min),
            max: max === null ? null : round2(max),
            base: min === null ? 0 : round2(min),
            range: min === null || max === null ? 0 : round2(max - min),
          };
        });
      })
    );
  }).filter((e) => e.value !== null);

  // Semestres disponibles pour la comparaison (tous sauf le courant)
  // On ne filtre pas par allReleves pour que le sélecteur reste stable pendant le chargement
  const comparableSemestres = semestres.filter(
    (s) => s.formsemestre_id !== currentSemestreId
  );

  const [compareId, setCompareId] = useState<string>(
    () => comparableSemestres[comparableSemestres.length - 1]?.formsemestre_id ?? ""
  );

  // Quand le semestre courant change, le compareId peut pointer dessus ou être invalide
  useEffect(() => {
    const valid = comparableSemestres.find((s) => s.formsemestre_id === compareId);
    if (!valid) {
      setCompareId(comparableSemestres[comparableSemestres.length - 1]?.formsemestre_id ?? "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSemestreId]);

  const compareReleve = compareId ? allReleves[compareId] : null;
  const currentLabel = semestres.find((s) => s.formsemestre_id === currentSemestreId);
  const compareLabel = semestres.find((s) => s.formsemestre_id === compareId);

  // Les codes UE changent entre semestres (UE3.1, UE4.1…) et le champ `numero`
  // suit le schéma ScoDoc (S1→1-4, S2→5-8, S3→9-12…) donc ne peut pas servir de
  // clé de jonction. On trie les deux listes par numero et on matche par position.
  const compareUeEntries = compareReleve
    ? Object.entries(compareReleve.ues)
        .filter(([, u]) => u.type !== 1)
        .sort((a, b) => a[1].numero - b[1].numero)
    : [];

  const semesterCompareData = ueEntries.map(([code], idx) => {
    const curMoy = ueMoyennes[code];
    const [, cmpUe] = compareUeEntries[idx] ?? [];
    const cmpMoy = cmpUe && compareReleve ? cmpUeMoyenne(cmpUe, compareReleve) : null;
    return {
      ue: `UE${idx + 1}`,
      actuel: curMoy !== null && curMoy !== undefined ? round2(curMoy) : null,
      compare: cmpMoy !== null && cmpMoy !== undefined ? round2(cmpMoy) : null,
    };
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Suspense fallback={<ChartFallback />}>
          <RadarUE ues={releve.ues} moyennes={ueMoyennes} />
        </Suspense>
        <Suspense fallback={<ChartFallback />}>
          <EvolutionChart points={evolution} />
        </Suspense>
      </div>

      <div className="bg-sky-50/85 dark:bg-slate-900/65 backdrop-blur-lg border border-sky-300/70 dark:border-slate-700/70 ring-1 ring-black/5 dark:ring-white/5 rounded-xl shadow-sm p-4">
        <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-2">Toi vs la promo, UE par UE</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={comparisonData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="ue" tick={{ fontSize: 11, fill: xTickColor }} />
            <YAxis domain={[0, 20]} tick={{ fontSize: 10, fill: yTickColor }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="moi" name="Toi" fill={myBarColor} radius={[3, 3, 0, 0]} />
            <Bar dataKey="promo" name="Moy. promo" fill={promoBarColor} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Comparaison entre semestres */}
      {comparableSemestres.length > 0 && (
        <div className="bg-sky-50/85 dark:bg-slate-900/65 backdrop-blur-lg border border-sky-300/70 dark:border-slate-700/70 ring-1 ring-black/5 dark:ring-white/5 rounded-xl shadow-sm p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-100">Comparaison entre semestres, UE par UE</h2>
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span>Comparer avec :</span>
              <select
                value={compareId}
                onChange={(e) => setCompareId(e.target.value)}
                className="rounded-md border border-sky-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2 py-1 text-xs"
              >
                {comparableSemestres.map((s) => (
                  <option key={s.formsemestre_id} value={s.formsemestre_id}>
                    {semLabel(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {compareReleve ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={semesterCompareData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="ue" tick={{ fontSize: 11, fill: xTickColor }} />
                <YAxis domain={[0, 20]} tick={{ fontSize: 10, fill: yTickColor }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="actuel"
                  name={currentLabel ? semLabel(currentLabel) : "Actuel"}
                  fill={myBarColor}
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="compare"
                  name={compareLabel ? semLabel(compareLabel) : "Comparaison"}
                  fill={compareBarColor}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
              Chargement des données du semestre à comparer…
            </p>
          )}
        </div>
      )}

      <div className="bg-sky-50/85 dark:bg-slate-900/65 backdrop-blur-lg border border-sky-300/70 dark:border-slate-700/70 ring-1 ring-black/5 dark:ring-white/5 rounded-xl shadow-sm p-4">
        <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-2">Notes par évaluation</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          Pour chaque évaluation : la plage min–max de la promo (barre claire), sa moyenne de classe (losange gris) et
          ta note (point bleu si au-dessus de la moyenne, rose si en-dessous).
        </p>
        <ResponsiveContainer width="100%" height={Math.max(260, evalData.length * 26)}>
          <ComposedChart data={evalData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis type="number" domain={[0, 20]} tick={{ fontSize: 10, fill: yTickColor }} />
            <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 10, fill: yTickColor }} />
            <Tooltip content={<EvalTooltip dark={dark} />} />
            <Bar dataKey="base" stackId="range" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="range" stackId="range" fill={rangeBarColor} fillOpacity={0.7} radius={[3, 3, 3, 3]} barSize={10} isAnimationActive={false} />
            <Scatter dataKey="classMoy" name="Moy. classe" shape="diamond" fill={classMoyColor} />
            <Scatter dataKey="value" name="Ta note">
              {evalData.map((e, i) => (
                <Cell key={i} fill={e.classMoy !== null && e.value !== null && e.value < e.classMoy ? belowColor : aboveColor} />
              ))}
            </Scatter>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface EvalDatum {
  label: string;
  value: number | null;
  classMoy: number | null;
  min: number | null;
  max: number | null;
}

function EvalTooltip({ active, payload, dark }: { active?: boolean; payload?: { payload: EvalDatum }[]; dark?: boolean }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: dark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.95)",
        border: dark ? "1px solid #334155" : "1px solid #bae6fd",
        borderRadius: "6px",
        fontSize: 12,
        padding: "6px 10px",
      }}
    >
      <p style={{ fontWeight: 600, color: dark ? "#f1f5f9" : "#1e293b", marginBottom: 2 }}>{d.label}</p>
      <p style={{ color: dark ? "#38bdf8" : "#0369a1" }}>Ta note : {d.value?.toFixed(2) ?? "—"}</p>
      <p style={{ color: dark ? "#cbd5e1" : "#475569" }}>Moy. classe : {d.classMoy?.toFixed(2) ?? "—"}</p>
      <p style={{ color: dark ? "#94a3b8" : "#64748b" }}>
        Min {d.min?.toFixed(2) ?? "—"} · Max {d.max?.toFixed(2) ?? "—"}
      </p>
    </div>
  );
}

function ChartFallback() {
  return (
    <div className="bg-sky-50/85 dark:bg-slate-900/65 backdrop-blur-lg border border-sky-300/70 dark:border-slate-700/70 ring-1 ring-black/5 dark:ring-white/5 rounded-xl shadow-sm p-4 h-[300px] flex flex-col gap-2 animate-pulse">
      <div className="h-3 w-1/3 rounded bg-sky-200 dark:bg-slate-700" />
      <div className="flex-1 rounded bg-sky-100 dark:bg-slate-800" />
    </div>
  );
}
