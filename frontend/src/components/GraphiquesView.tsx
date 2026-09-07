import { Suspense, lazy, useEffect, useMemo, useState } from "react";
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
import type { ModuleEntry, Releve, Semestre } from "../types";
import { numericNoteValue, round2, ueMoyenneCompat, ueAggregate } from "../simulator";
import type { SemestrePoint } from "./EvolutionChart";
import type { ProgressionPoint } from "../simulator";
import { useChartTheme } from "../chartTheme";
import { Card } from "./ui";

const RadarUE = lazy(() => import("./RadarUE"));
const EvolutionChart = lazy(() => import("./EvolutionChart"));
const ProgressionChart = lazy(() => import("./ProgressionChart"));

interface Props {
  releve: Releve;
  overrides: Record<string, number>;
  ueMoyennes: Record<string, number | null>;
  evolution: SemestrePoint[];
  progression: ProgressionPoint[];
  allReleves: Record<string, Releve>;
  semestres: Semestre[];
  currentSemestreId: string | null;
}

function semLabel(s: Semestre): string {
  if (s.semestre_id && s.annee_scolaire) return `S${s.semestre_id} ${s.annee_scolaire}`;
  if (s.semestre_id) return `S${s.semestre_id}`;
  return s.titre;
}

/** Les libellés d'évaluation ScoDoc peuvent faire une phrase entière ("Travail de groupe
 * concernant la création d'entreprises avec M. Anselmo") : affichés en entier sur l'axe,
 * ils se repliaient sur quatre lignes et recouvraient les entrées voisines. Le libellé
 * complet reste accessible dans l'infobulle. */
const MAX_AXIS_LABEL = 26;
function truncate(label: string): string {
  return label.length > MAX_AXIS_LABEL ? `${label.slice(0, MAX_AXIS_LABEL - 1)}…` : label;
}

interface EvalDatum {
  key: string;
  label: string;
  fullLabel: string;
  module: string;
  ue: string;
  value: number | null;
  classMoy: number | null;
  min: number | null;
  max: number | null;
  base: number;
  range: number;
}

export default function GraphiquesView({
  releve,
  overrides,
  ueMoyennes,
  evolution,
  progression,
  allReleves,
  semestres,
  currentSemestreId,
}: Props) {
  const theme = useChartTheme();

  // Tri par numéro pour un ordre stable et cohérent avec le semestre comparé.
  const ueEntries = useMemo(
    () =>
      Object.entries(releve.ues)
        .filter(([, ue]) => ue.type !== 1)
        .sort((a, b) => a[1].numero - b[1].numero),
    [releve]
  );

  const comparisonData = useMemo(
    () =>
      ueEntries.map(([code, ue]) => {
        const aggregate = ueAggregate(ue, releve, overrides, code);
        return { ue: code, moi: round2(aggregate.value), promo: round2(aggregate.moy) };
      }),
    [ueEntries, releve, overrides]
  );

  /**
   * Une évaluation par ligne — exactement une.
   *
   * En BUT, une ressource alimente plusieurs UE. La version précédente parcourait les UE
   * puis leurs modules : chaque évaluation d'une ressource partagée était donc émise une
   * fois par UE contributrice, et le graphique affichait les mêmes notes en double. On
   * part ici de la liste canonique des modules (releve.ressources / releve.saes, où chaque
   * module figure une seule fois), et on rattache les UE en second — même correctif que
   * celui déjà appliqué au récapitulatif par matière.
   */
  const evalData = useMemo(() => {
    const ueCodesByModule = new Map<string, string[]>();
    for (const [ueCode, ue] of ueEntries) {
      for (const group of ["ressources", "saes"] as const) {
        for (const moduleCode of Object.keys(ue[group] || {})) {
          const key = `${group}-${moduleCode}`;
          const list = ueCodesByModule.get(key);
          if (list) list.push(ueCode);
          else ueCodesByModule.set(key, [ueCode]);
        }
      }
    }

    const rows: EvalDatum[] = [];
    for (const group of ["ressources", "saes"] as const) {
      const modules: Record<string, ModuleEntry> = releve[group] || {};
      for (const [moduleCode, mod] of Object.entries(modules)) {
        const ueCodes = ueCodesByModule.get(`${group}-${moduleCode}`);
        // Module qui n'alimente aucune UE notée (UE bonus) : hors périmètre du graphique.
        if (!ueCodes || !mod.evaluations) continue;
        mod.evaluations.forEach((evaluation, index) => {
          const key = `${group}-${moduleCode}-${index}`;
          const value = key in overrides ? overrides[key] : numericNoteValue(evaluation.note.value);
          if (value === null) return;
          const classMoy = numericNoteValue(evaluation.note.moy);
          const min = numericNoteValue(evaluation.note.min);
          const max = numericNoteValue(evaluation.note.max);
          const fullLabel = evaluation.description || mod.titre || moduleCode;
          rows.push({
            key,
            label: truncate(fullLabel),
            fullLabel,
            module: mod.titre || moduleCode,
            ue: ueCodes.join(" / "),
            value: round2(value),
            classMoy: classMoy === null ? null : round2(classMoy),
            min: min === null ? null : round2(min),
            max: max === null ? null : round2(max),
            base: min ?? 0,
            range: min === null || max === null ? 0 : Math.round((max - min) * 100) / 100,
          });
        });
      }
    }
    return rows;
  }, [releve, ueEntries, overrides]);

  // Semestres disponibles pour la comparaison (tous sauf le courant).
  // On ne filtre pas par allReleves pour que le sélecteur reste stable pendant le chargement.
  const comparableSemestres = semestres.filter((s) => s.formsemestre_id !== currentSemestreId);

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

  const semesterCompareData = ueEntries.map(([code], index) => {
    const current = ueMoyennes[code];
    const [, comparedUe] = compareUeEntries[index] ?? [];
    const compareUeCode = compareUeEntries[index]?.[0];
    const compared =
      comparedUe && compareReleve ? ueMoyenneCompat(comparedUe, compareReleve, compareUeCode) : null;
    return {
      ue: `UE${index + 1}`,
      actuel: current !== null && current !== undefined ? round2(current) : null,
      compare: compared !== null && compared !== undefined ? round2(compared) : null,
    };
  });

  const axisTick = { fontSize: 11, fill: theme.axis, fontFamily: "Geist Mono, monospace" };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Suspense fallback={<ChartFallback />}>
          <RadarUE ues={releve.ues} moyennes={ueMoyennes} />
        </Suspense>
        <Suspense fallback={<ChartFallback />}>
          <EvolutionChart points={evolution} />
        </Suspense>
        <Suspense fallback={<ChartFallback />}>
          <ProgressionChart points={progression} />
        </Suspense>
      </div>

      <ChartCard title="Toi et la promo, UE par UE">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={comparisonData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey="ue" tick={axisTick} tickLine={false} axisLine={{ stroke: theme.grid }} />
            <YAxis domain={[0, 20]} tick={axisTick} tickLine={false} axisLine={false} width={34} />
            <Tooltip contentStyle={theme.tooltip} cursor={{ fill: theme.grid, fillOpacity: 0.4 }} />
            <Legend wrapperStyle={{ fontSize: 11, color: theme.axis }} />
            <Bar dataKey="moi" name="Toi" fill={theme.primary} radius={[4, 4, 0, 0]} maxBarSize={38} />
            <Bar dataKey="promo" name="Moyenne promo" fill={theme.neutral} radius={[4, 4, 0, 0]} maxBarSize={38} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {comparableSemestres.length > 0 && (
        <ChartCard
          title="D'un semestre à l'autre, UE par UE"
          action={
            <label className="flex items-center gap-2 text-xs text-muted">
              <span>Comparer avec</span>
              <select
                value={compareId}
                onChange={(event) => setCompareId(event.target.value)}
                className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-fg mono"
              >
                {comparableSemestres.map((semestre) => (
                  <option key={semestre.formsemestre_id} value={semestre.formsemestre_id}>
                    {semLabel(semestre)}
                  </option>
                ))}
              </select>
            </label>
          }
        >
          {compareReleve ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={semesterCompareData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={theme.grid} />
                <XAxis dataKey="ue" tick={axisTick} tickLine={false} axisLine={{ stroke: theme.grid }} />
                <YAxis domain={[0, 20]} tick={axisTick} tickLine={false} axisLine={false} width={34} />
                <Tooltip contentStyle={theme.tooltip} cursor={{ fill: theme.grid, fillOpacity: 0.4 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: theme.axis }} />
                <Bar
                  dataKey="actuel"
                  name={currentLabel ? semLabel(currentLabel) : "Actuel"}
                  fill={theme.primary}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={38}
                />
                <Bar
                  dataKey="compare"
                  name={compareLabel ? semLabel(compareLabel) : "Comparaison"}
                  fill={theme.compare}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={38}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] rounded-lg bg-inset animate-pulse" />
          )}
        </ChartCard>
      )}

      <ChartCard
        title="Chaque évaluation dans sa promo"
        subtitle="Barre claire : l'écart entre la plus basse et la plus haute note. Trait : la moyenne de la classe. Point : ta note, coloré selon qu'elle est au-dessus ou en dessous."
      >
        <ResponsiveContainer width="100%" height={Math.max(240, evalData.length * 30)}>
          <ComposedChart data={evalData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid horizontal={false} stroke={theme.grid} />
            <XAxis
              type="number"
              domain={[0, 20]}
              ticks={[0, 5, 10, 15, 20]}
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: theme.grid }}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={132}
              interval={0}
              tick={{ fontSize: 11, fill: theme.axisStrong }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<EvalTooltip theme={theme} />} cursor={{ fill: theme.grid, fillOpacity: 0.4 }} />
            <Bar dataKey="base" stackId="range" fill="transparent" isAnimationActive={false} />
            <Bar
              dataKey="range"
              stackId="range"
              fill={theme.neutral}
              fillOpacity={0.45}
              radius={[4, 4, 4, 4]}
              barSize={9}
              isAnimationActive={false}
            />
            <Scatter dataKey="classMoy" name="Moyenne classe" shape="cross" fill={theme.axisStrong} />
            <Scatter dataKey="value" name="Ta note">
              {evalData.map((row) => (
                <Cell
                  key={row.key}
                  fill={
                    row.classMoy !== null && row.value !== null && row.value < row.classMoy
                      ? theme.negative
                      : theme.positive
                  }
                />
              ))}
            </Scatter>
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-muted max-w-prose">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function EvalTooltip({
  active,
  payload,
  theme,
}: {
  active?: boolean;
  payload?: { payload: EvalDatum }[];
  theme: ReturnType<typeof useChartTheme>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0].payload;
  const below = datum.classMoy !== null && datum.value !== null && datum.value < datum.classMoy;

  return (
    <div style={{ ...theme.tooltip, maxWidth: 260 }}>
      <p style={{ fontWeight: 600, marginBottom: 2 }}>{datum.fullLabel}</p>
      <p style={{ color: theme.axis, fontSize: 11, marginBottom: 4 }}>
        {datum.module} · {datum.ue}
      </p>
      <p style={{ color: below ? theme.negative : theme.positive, fontFamily: "Geist Mono, monospace" }}>
        Ta note {datum.value?.toFixed(2) ?? "—"}
      </p>
      <p style={{ color: theme.axisStrong, fontFamily: "Geist Mono, monospace" }}>
        Classe {datum.classMoy?.toFixed(2) ?? "—"}
      </p>
      <p style={{ color: theme.axis, fontFamily: "Geist Mono, monospace", fontSize: 11 }}>
        Min {datum.min?.toFixed(2) ?? "—"} · Max {datum.max?.toFixed(2) ?? "—"}
      </p>
    </div>
  );
}

function ChartFallback() {
  return <div className="h-[320px] rounded-xl bg-inset animate-pulse" />;
}
