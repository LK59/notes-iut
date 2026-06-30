import type { GradeHistoryItem } from "../gradeHistory";

function fmtValue(value: number | null): string {
  return value === null ? "non publiee" : `${value.toFixed(2)} / 20`;
}

function fmtDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

export default function GradeHistoryPanel({ items }: { items: GradeHistoryItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="print:hidden rounded-xl border border-emerald-200/70 dark:border-emerald-800/70 bg-emerald-50/80 dark:bg-emerald-950/30 p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">Historique des notes detectees</h2>
        <span className="text-xs text-emerald-700/70 dark:text-emerald-300/70">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.slice(0, 5).map((item) => (
          <div key={item.id} className="text-xs text-emerald-900 dark:text-emerald-100">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium truncate">{item.evaluationLabel}</span>
              <span className="shrink-0 text-emerald-700/70 dark:text-emerald-300/70">{fmtDate(item.discoveredAt)}</span>
            </div>
            <p className="text-emerald-800/75 dark:text-emerald-200/75 truncate">{item.moduleLabel}</p>
            <p className="font-semibold">
              {fmtValue(item.previousValue)}{" -> "}{fmtValue(item.newValue)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
