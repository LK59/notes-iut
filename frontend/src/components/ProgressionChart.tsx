import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useChartTheme } from "../chartTheme";
import type { ProgressionPoint } from "../simulator";
import { Card } from "./ui";

function dayLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/**
 * Moyenne générale au fil des publications de notes du semestre en cours.
 *
 * Complète EvolutionChart, qui ne compare que des semestres entiers entre eux : ici on voit
 * l'effet de chaque vague de notes sur la moyenne. Les dates viennent de l'historique local
 * (l'app note quand elle découvre une note, ScoDoc ne datant pas ses publications), donc la
 * courbe ne commence qu'à partir des notes découvertes sur cet appareil — d'où la mention
 * sous le titre plutôt qu'un axe qui laisserait croire à un suivi depuis le début du semestre.
 */
export default function ProgressionChart({ points }: { points: ProgressionPoint[] }) {
  const theme = useChartTheme();
  const axisTick = { fontSize: 11, fill: theme.axis, fontFamily: "Geist Mono, monospace" };
  const data = points.map((point) => ({ ...point, label: dayLabel(point.date) }));
  const values = points.map((p) => p.moyenne).filter((v): v is number => v !== null);
  // Une échelle 0-20 écrase des variations de quelques dixièmes, qui sont pourtant tout
  // l'intérêt de la courbe : on cadre autour des valeurs réelles, avec une marge d'un point.
  const domain: [number, number] = values.length
    ? [Math.max(0, Math.floor(Math.min(...values) - 1)), Math.min(20, Math.ceil(Math.max(...values) + 1))]
    : [0, 20];

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg">Progression au fil des notes</h2>
      <p className="mt-0.5 mb-3 text-xs text-muted">
        Moyenne générale après chaque publication, depuis que l'app suit ce semestre.
      </p>
      {points.length < 2 ? (
        <div className="h-[280px] flex items-center justify-center px-6 text-center text-sm text-muted">
          La courbe apparaîtra dès que deux séries de notes auront été publiées.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: theme.grid }} />
            <YAxis domain={domain} tick={axisTick} tickLine={false} axisLine={false} width={34} />
            <Tooltip contentStyle={theme.tooltip} formatter={(value: number) => [value.toFixed(2), "Moyenne"]} />
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
