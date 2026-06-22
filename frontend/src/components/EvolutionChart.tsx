import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface SemestrePoint {
  titre: string;
  moyenne: number | null;
}

export default function EvolutionChart({ points }: { points: SemestrePoint[] }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-sky-200 dark:border-slate-800 rounded-xl shadow-sm p-4">
      <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-2">Évolution inter-semestres</h2>
      {points.length < 2 ? (
        <div className="h-[260px] flex items-center justify-center text-sm text-slate-500 dark:text-slate-500 text-center px-4">
          Un seul semestre disponible pour l'instant — la courbe apparaîtra à partir du suivant.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#bae6fd" />
            <XAxis dataKey="titre" tick={{ fontSize: 11, fill: "#0369a1" }} />
            <YAxis domain={[0, 20]} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line type="monotone" dataKey="moyenne" stroke="#0284c7" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
