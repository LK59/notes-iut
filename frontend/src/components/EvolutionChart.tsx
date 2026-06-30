import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useDarkMode } from "../theme";

export interface SemestrePoint {
  titre: string;
  moyenne: number | null;
}

export default function EvolutionChart({ points }: { points: SemestrePoint[] }) {
  const dark = useDarkMode();
  const gridColor = dark ? "#1e3a5f" : "#bae6fd";
  const xTickColor = dark ? "#7dd3fc" : "#0369a1";
  const yTickColor = dark ? "#94a3b8" : "#64748b";
  const lineColor = dark ? "#38bdf8" : "#0284c7";

  return (
    <div className="bg-sky-50/85 dark:bg-slate-900/65 backdrop-blur-lg border border-sky-300/70 dark:border-slate-700/70 ring-1 ring-black/5 dark:ring-white/5 rounded-xl shadow-sm p-4">
      <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-2">Évolution inter-semestres</h2>
      {points.length < 2 ? (
        <div className="h-[260px] flex items-center justify-center text-sm text-slate-500 dark:text-slate-400 text-center px-4">
          Un seul semestre disponible pour l'instant — la courbe apparaîtra à partir du suivant.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="titre" tick={{ fontSize: 11, fill: xTickColor }} />
            <YAxis domain={[0, 20]} tick={{ fontSize: 10, fill: yTickColor }} />
            <Tooltip
              contentStyle={{
                background: dark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.95)",
                border: dark ? "1px solid #334155" : "1px solid #bae6fd",
                borderRadius: "6px",
                color: dark ? "#e2e8f0" : "#0f172a",
                fontSize: 12,
              }}
            />
            <Line type="monotone" dataKey="moyenne" stroke={lineColor} strokeWidth={2} dot={{ r: 4, fill: lineColor }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
