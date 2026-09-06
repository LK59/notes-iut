import { useQuery } from "@tanstack/react-query";
import type { NoteValue } from "../types";
import { numericNoteValue } from "../simulator";
import { getDistribution } from "../api";

interface Props {
  note: NoteValue;
  ma?: number | null;
  evaluationId?: number;
}

/**
 * Position de la note dans la promo : distribution réelle si ScoDoc l'expose
 * (listeNotes), sinon repli sur l'échelle min / moyenne / max de l'évaluation.
 *
 * Dessiné en SVG et non avec recharts : ce composant est atteignable depuis la vue
 * par défaut d'un simple appui sur une évaluation, et il tirait à lui seul le cœur
 * de recharts (~94 Ko gzip) dans le chemin critique. La bibliothèque n'est plus
 * chargée que par la vue Graphiques.
 */
export default function PromoHistogram({ note, ma, evaluationId }: Props) {
  // Mise en cache par React Query : re-sélectionner la même évaluation ne relance
  // plus d'appel réseau (la distribution d'une évaluation notée ne change plus).
  const { data, isPending } = useQuery({
    queryKey: ["distribution", evaluationId],
    queryFn: () => getDistribution(evaluationId!),
    enabled: evaluationId !== undefined,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  const maNote = ma ?? numericNoteValue(note.value);

  if (evaluationId !== undefined && isPending) {
    return <div className="h-[132px] rounded-lg bg-inset animate-pulse" />;
  }

  const distribution =
    Array.isArray(data) && data.length > 0 && typeof data[0] === "number"
      ? (data as number[])
      : null;

  return distribution ? (
    <Distribution values={distribution} maNote={maNote} />
  ) : (
    <Scale note={note} maNote={maNote} />
  );
}

/* ── Distribution réelle ───────────────────────────────────────────────────── */

const W = 320;
const H = 108;
const PAD_L = 4;
const PAD_R = 4;
const PAD_B = 16;

function Distribution({ values, maNote }: { values: number[]; maNote: number | null }) {
  const buckets = new Array(21).fill(0) as number[];
  for (const value of values) {
    buckets[Math.min(20, Math.max(0, Math.round(value)))] += 1;
  }
  const peak = Math.max(...buckets, 1);
  const mine = maNote === null ? null : Math.min(20, Math.max(0, Math.round(maNote)));

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_B;
  const slot = plotW / 21;
  const barW = Math.max(3, slot - 2.5);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Répartition des notes de la promo sur ${values.length} étudiants${
          mine !== null ? `, ta note autour de ${mine} sur 20` : ""
        }`}
      >
        {[0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={PAD_L}
            x2={W - PAD_R}
            y1={plotH - plotH * ratio + 0.5}
            y2={plotH - plotH * ratio + 0.5}
            className="stroke-line"
            strokeWidth="1"
          />
        ))}

        {buckets.map((count, index) => {
          const height = count === 0 ? 0 : Math.max(2, (count / peak) * (plotH - 4));
          const x = PAD_L + index * slot + (slot - barW) / 2;
          const isMine = index === mine;
          return (
            <rect
              key={index}
              x={x}
              y={plotH - height}
              width={barW}
              height={height}
              rx={1.5}
              className={isMine ? "fill-accent" : "fill-line-strong"}
            >
              <title>
                {count} étudiant{count > 1 ? "s" : ""} autour de {index}/20
              </title>
            </rect>
          );
        })}

        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={plotH + 0.5}
          y2={plotH + 0.5}
          className="stroke-line-strong"
          strokeWidth="1"
        />

        {[0, 5, 10, 15, 20].map((tick) => (
          <text
            key={tick}
            x={PAD_L + tick * slot + slot / 2}
            y={H - 4}
            textAnchor="middle"
            className="fill-subtle"
            style={{ fontSize: 8, fontFamily: "Geist Mono, monospace" }}
          >
            {tick}
          </text>
        ))}
      </svg>
      <figcaption className="mt-1 text-[11px] text-subtle">
        Répartition réelle de la promo — {values.length} étudiants, ta note en couleur.
      </figcaption>
    </figure>
  );
}

/* ── Repli : échelle min / moyenne / max ───────────────────────────────────── */

function Scale({ note, maNote }: { note: NoteValue; maNote: number | null }) {
  const min = numericNoteValue(note.min);
  const moy = numericNoteValue(note.moy);
  const max = numericNoteValue(note.max);

  if (min === null && moy === null && max === null && maNote === null) {
    return (
      <p className="text-[11px] text-subtle py-3">
        Aucune donnée de promo pour cette évaluation.
      </p>
    );
  }

  const pct = (value: number) => `${(value / 20) * 100}%`;
  const below = maNote !== null && moy !== null && maNote < moy;

  return (
    <figure className="m-0 pt-1">
      <div className="relative h-9">
        <div className="absolute inset-x-0 top-3 h-1.5 rounded-full bg-inset" />
        {min !== null && max !== null && (
          <div
            className="absolute top-3 h-1.5 rounded-full bg-line-strong"
            style={{ left: pct(min), width: pct(max - min) }}
          />
        )}
        {moy !== null && (
          <div
            className="absolute top-1.5 h-5 w-0.5 -translate-x-1/2 rounded-full bg-muted"
            style={{ left: pct(moy) }}
            title={`Moyenne de la classe : ${moy.toFixed(2)}`}
          />
        )}
        {maNote !== null && (
          <div
            className={`absolute top-[9px] h-3.5 w-3.5 -translate-x-1/2 rounded-full ring-2 ring-surface ${
              below ? "bg-neg" : "bg-pos"
            }`}
            style={{ left: pct(maNote) }}
            title={`Ta note : ${maNote.toFixed(2)}`}
          />
        )}
      </div>
      <div className="flex justify-between text-[11px] text-subtle mono">
        <span>0</span>
        <span>10</span>
        <span>20</span>
      </div>
      <figcaption className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-subtle">
        <span>Min {fmtOrDash(min)}</span>
        <span>Moy. classe {fmtOrDash(moy)}</span>
        <span>Max {fmtOrDash(max)}</span>
        <span className="text-muted">Ta note {fmtOrDash(maNote)}</span>
      </figcaption>
    </figure>
  );
}

function fmtOrDash(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}
