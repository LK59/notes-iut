import { useState } from "react";
import { recentGradeHistory, type GradeHistoryItem } from "../gradeHistory";
import { Card, Chevron, Collapsible, Grade } from "./ui";

function fmtValue(value: number | null): string {
  return value === null ? "non publiée" : value.toFixed(2);
}

function fmtDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

/**
 * Notes apparues depuis la dernière consultation, sur les sept derniers jours.
 *
 * Repliable et daté : la version précédente restait dépliée en tête de tableau de bord
 * indéfiniment, si bien que des notes vieilles de deux semaines occupaient encore la
 * première place à la place du résumé du semestre.
 */
export default function GradeHistoryPanel({ items }: { items: GradeHistoryItem[] }) {
  const recent = recentGradeHistory(items);
  const [open, setOpen] = useState(recent.length > 0 && recent.length <= 3);

  if (recent.length === 0) return null;

  return (
    <Card className="border-pos/40 bg-pos-soft/40 overflow-hidden">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-pos-soft/60 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-pos" />
          <span className="text-sm font-semibold text-pos truncate">
            {recent.length} nouvelle{recent.length > 1 ? "s" : ""} note{recent.length > 1 ? "s" : ""} cette semaine
          </span>
        </span>
        <Chevron open={open} className="text-pos shrink-0" />
      </button>

      <Collapsible open={open}>
        <div className="divide-y divide-pos/20 border-t border-pos/25">
          {recent.slice(0, 8).map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-fg truncate">{item.evaluationLabel}</p>
                <p className="text-xs text-muted truncate">{item.moduleLabel}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="flex items-center justify-end gap-1.5">
                  {item.previousValue !== null && (
                    <>
                      <span className="mono text-xs text-subtle line-through">
                        {fmtValue(item.previousValue)}
                      </span>
                      <span className="text-subtle text-xs" aria-hidden="true">
                        →
                      </span>
                    </>
                  )}
                  <Grade value={fmtValue(item.newValue)} size="sm" />
                </p>
                <p className="mono text-[11px] text-subtle">{fmtDate(item.discoveredAt)}</p>
              </div>
            </div>
          ))}
        </div>
      </Collapsible>
    </Card>
  );
}
