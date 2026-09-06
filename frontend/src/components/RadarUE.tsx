import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";
import type { Ue } from "../types";
import { round2 } from "../simulator";
import { useChartTheme } from "../chartTheme";
import { Card } from "./ui";

export default function RadarUE({ ues, moyennes }: { ues: Record<string, Ue>; moyennes: Record<string, number | null> }) {
  const theme = useChartTheme();
  const data = Object.entries(ues)
    .filter(([, ue]) => ue.type !== 1)
    .sort((a, b) => a[1].numero - b[1].numero)
    .map(([code]) => ({ ue: code, moyenne: round2(moyennes[code]) }));

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg mb-3">Profil par UE</h2>
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke={theme.grid} />
          <PolarAngleAxis
            dataKey="ue"
            tick={{ fontSize: 11, fill: theme.axisStrong, fontFamily: "Geist Mono, monospace" }}
          />
          <PolarRadiusAxis
            domain={[0, 20]}
            tickCount={5}
            tick={{ fontSize: 9, fill: theme.axis, fontFamily: "Geist Mono, monospace" }}
            axisLine={false}
          />
          <Radar
            name="Moyenne"
            dataKey="moyenne"
            stroke={theme.primary}
            strokeWidth={2}
            fill={theme.primary}
            fillOpacity={0.18}
          />
          <Tooltip contentStyle={theme.tooltip} />
        </RadarChart>
      </ResponsiveContainer>
    </Card>
  );
}
