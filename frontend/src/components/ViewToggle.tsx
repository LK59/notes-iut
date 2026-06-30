import type { ViewMode } from "../viewMode";

const OPTIONS: { key: ViewMode; label: string }[] = [
  { key: "simple", label: "Simple" },
  { key: "complet", label: "Avancée" },
  { key: "graphiques", label: "Graphique" },
];

// Largeur fixe par segment (plutôt qu'un pourcentage du conteneur) : évite tout calcul de
// padding approximatif entre la pilule glissante et le conteneur, qui collait trop près des
// lettres du libellé le plus long ("Graphique").
const SEGMENT_WIDTH_REM = 5.5;

export default function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const index = OPTIONS.findIndex((o) => o.key === view);

  return (
    <div className="relative inline-flex items-center rounded-full border border-sky-200/80 dark:border-sky-800/80 bg-sky-50/80 dark:bg-slate-800/80 backdrop-blur-sm p-1 text-xs font-medium whitespace-nowrap select-none">
      <span
        className="absolute top-1 bottom-1 left-1 rounded-full bg-white/90 dark:bg-sky-700/90 shadow-sm ring-1 ring-black/5 dark:ring-white/10 transition-transform duration-200 ease-out"
        style={{ width: `${SEGMENT_WIDTH_REM}rem`, transform: `translateX(${index * SEGMENT_WIDTH_REM}rem)` }}
      />
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          style={{ width: `${SEGMENT_WIDTH_REM}rem` }}
          className={`relative z-10 py-1.5 rounded-full text-center transition-colors ${
            o.key === view ? "text-sky-700 dark:text-white" : "text-slate-500 dark:text-slate-400"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
