import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";
import type { Ue } from "../types";
import { round2 } from "../simulator";
import { useDarkMode } from "../theme";

export default function RadarUE({ ues, moyennes }: { ues: Record<string, Ue>; moyennes: Record<string, number | null> }) {
  const dark = useDarkMode();
  const data = Object.entries(ues)
    .filter(([, ue]) => ue.type !== 1)
    .map(([code]) => ({
      ue: code,
      moyenne: round2(moyennes[code]),
    }));

  const gridColor = dark ? "#1e3a5f" : "#bae6fd";
  const tickColor = dark ? "#7dd3fc" : "#0369a1";
  const axisTickColor = dark ? "#94a3b8" : "#64748b";
  const radarColor = dark ? "#38bdf8" : "#0284c7";

  return (
    <div className="bg-sky-50/85 dark:bg-slate-900/65 backdrop-blur-lg border border-sky-300/70 dark:border-slate-700/70 ring-1 ring-black/5 dark:ring-white/5 rounded-xl shadow-sm p-4">
      <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-2">Moyenne par UE</h2>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={data}>
          <PolarGrid stroke={gridColor} />
          <PolarAngleAxis dataKey="ue" tick={{ fontSize: 11, fill: tickColor }} />
          <PolarRadiusAxis domain={[0, 20]} tick={{ fontSize: 10, fill: axisTickColor }} />
          <Radar name="Moyenne" dataKey="moyenne" stroke={radarColor} fill={radarColor} fillOpacity={0.35} />
          <Tooltip
            contentStyle={{
              background: dark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.95)",
              border: dark ? "1px solid #334155" : "1px solid #bae6fd",
              borderRadius: "6px",
              color: dark ? "#e2e8f0" : "#0f172a",
              fontSize: 12,
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
