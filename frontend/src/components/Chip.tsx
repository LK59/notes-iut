export type ChipColor = "slate" | "sky" | "violet" | "amber" | "emerald" | "rose";

const COLOR_MAP: Record<ChipColor, string> = {
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

export default function Chip({ color, title, children }: { color: ChipColor; title?: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap ${COLOR_MAP[color]}`}
    >
      {children}
    </span>
  );
}
