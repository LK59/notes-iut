import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NoteValue } from "../types";
import { numericNoteValue } from "../simulator";
import { getDistribution } from "../api";

const COLORS = ["#7dd3fc", "#38bdf8", "#0284c7", "#7dd3fc"];

interface Props {
  note: NoteValue;
  ma?: number | null;
  evaluationId?: number;
}

type Status = "loading" | "real" | "fallback";

/** Histogramme de position dans la promo : distribution réelle si dispo (listeNotes côté ScoDoc), sinon estimation min/moy/max. */
export default function PromoHistogram({ note, ma, evaluationId }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [distribution, setDistribution] = useState<number[]>([]);

  useEffect(() => {
    setStatus("loading");
    setDistribution([]);
    if (evaluationId === undefined) {
      setStatus("fallback");
      return;
    }
    let cancelled = false;
    getDistribution(evaluationId)
      .then((res) => {
        if (cancelled) return;
        if (Array.isArray(res) && res.length > 0 && typeof res[0] === "number") {
          setDistribution(res as number[]);
          setStatus("real");
        } else {
          setStatus("fallback");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("fallback");
      });
    return () => {
      cancelled = true;
    };
  }, [evaluationId]);

  const maNote = ma ?? numericNoteValue(note.value);

  // On ne montre jamais le repli min/moy/max avant de savoir si une vraie distribution existe :
  // ça évite le "flash" d'un graphique qui se fait immédiatement remplacer par un autre.
  if (status === "loading") {
    return <div className="h-[150px] flex items-center justify-center text-xs text-slate-400">Chargement…</div>;
  }

  if (status === "real") {
    const buckets = new Array(21).fill(0);
    distribution.forEach((n) => {
      const b = Math.min(20, Math.max(0, Math.round(n)));
      buckets[b]++;
    });
    const maBucket = maNote !== null ? Math.min(20, Math.max(0, Math.round(maNote))) : null;
    const data = buckets.map((count, n) => ({ note: String(n), count }));

    return (
      <div>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#bae6fd" />
            <XAxis dataKey="note" tick={{ fontSize: 9, fill: "#0369a1" }} interval={1} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="count" radius={[2, 2, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={Number(d.note) === maBucket ? "#0284c7" : "#93c5fd"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">
          Distribution réelle des notes de la promo ({distribution.length} étudiants) — ta note en bleu foncé.
        </p>
      </div>
    );
  }

  const data = [
    { label: "Min", valeur: numericNoteValue(note.min) },
    { label: "Moy. promo", valeur: numericNoteValue(note.moy) },
    { label: "Ma note", valeur: maNote },
    { label: "Max", valeur: numericNoteValue(note.max) },
  ];

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#bae6fd" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#0369a1" }} />
        <YAxis domain={[0, 20]} tick={{ fontSize: 10 }} />
        <Tooltip />
        <Bar dataKey="valeur" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
