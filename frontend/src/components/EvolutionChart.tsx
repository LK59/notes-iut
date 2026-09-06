import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useChartTheme } from "../chartTheme";
import { Card } from "./ui";

export interface SemestrePoint {
  titre: string;
  moyenne: number | null;
}

export default function EvolutionChart({ points }: { points: SemestrePoint[] }) {
  const theme = useChartTheme();
  const axisTick = { fontSize: 11, fill: theme.axis, fontFamily: "Geist Mono, monospace" };

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg mb-3">Évolution d'un semestre à l'autre</h2>
      {points.length < 2 ? (
        <div className="h-[280px] flex items-center justify-center px-6 text-center text-sm text-muted">
          Un seul semestre disponible pour l'instant — la courbe apparaîtra dès le suivant.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={points} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey="titre" tick={axisTick} tickLine={false} axisLine={{ stroke: theme.grid }} />
            <YAxis domain={[0, 20]} tick={axisTick} tickLine={false} axisLine={false} width={34} />
            <Tooltip contentStyle={theme.tooltip} />
            <Line
              type="monotone"
              dataKey="moyenne"
              name="Moyenne générale"
              stroke={theme.primary}
              strokeWidth={2}
              dot={{ r: 3.5, fill: theme.primary, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
