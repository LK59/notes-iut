import { useEffect, useRef, useState } from "react";

interface Props {
  semestreId: string;
  onExportSimulation: () => void;
}

export default function ExportMenu({ semestreId, onExportSimulation }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-slate-700 whitespace-nowrap flex items-center gap-1.5"
      >
        Export
        <svg className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.084l3.71-3.855a.75.75 0 1 1 1.08 1.04l-4.25 4.42a.75.75 0 0 1-1.08 0l-4.25-4.42a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 w-64 rounded-lg border border-sky-200/70 dark:border-slate-700/70 bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl ring-1 ring-black/5 dark:ring-white/10 shadow-lg overflow-hidden z-20">
          <a
            href={`/api/bulletin-pdf/${semestreId}?type=BUT`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 text-sm text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-slate-700 border-b border-sky-100 dark:border-slate-700"
          >
            <span className="font-medium">Bulletin officiel</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">Document PDF généré par ScoDoc</span>
          </a>
          <button
            onClick={() => {
              setOpen(false);
              onExportSimulation();
            }}
            className="block w-full text-left px-3 py-2.5 text-sm text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-slate-700"
          >
            <span className="font-medium">Export avec simulation</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Mise en page propre incluant tes notes simulées
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
