import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";
import type { Ue } from "../types";
import { round2 } from "../simulator";

export default function RadarUE({ ues, moyennes }: { ues: Record<string, Ue>; moyennes: Record<string, number | null> }) {
  const data = Object.entries(ues)
    .filter(([, ue]) => ue.type !== 1)
    .map(([code]) => ({
      ue: code,
      moyenne: round2(moyennes[code]),
    }));

  return (
    <div className="bg-white dark:bg-slate-900 border border-sky-200 dark:border-slate-800 rounded-xl shadow-sm p-4">
      <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-2">Moyenne par UE</h2>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={data}>
          <PolarGrid stroke="#bae6fd" />
          <PolarAngleAxis dataKey="ue" tick={{ fontSize: 11, fill: "#0369a1" }} />
          <PolarRadiusAxis domain={[0, 20]} tick={{ fontSize: 10 }} />
          <Radar name="Moyenne" dataKey="moyenne" stroke="#0284c7" fill="#0284c7" fillOpacity={0.4} />
          <Tooltip />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
