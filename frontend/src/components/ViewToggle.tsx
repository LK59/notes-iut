import type { ViewMode } from "../viewMode";

/** Un seul libellé par vue dans toute l'app — voir aussi SectionNav. */
export const VIEW_LABELS: Record<ViewMode, string> = {
  simple: "Simple",
  complet: "Détaillé",
  graphiques: "Graphiques",
};

const OPTIONS: ViewMode[] = ["simple", "complet", "graphiques"];

/**
 * Bascule segmentée. La pastille active glisse en `transform` sur une grille à
 * colonnes égales : le composant s'étire sur toute la largeur en mobile sans
 * qu'aucune largeur ne soit codée en dur (l'ancienne version fixait 5,5 rem par
 * segment, ce qui l'empêchait de s'adapter).
 */
export default function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}) {
  const index = OPTIONS.indexOf(view);

  return (
    <div
      role="tablist"
      aria-label="Mode d'affichage"
      className="relative grid grid-cols-3 w-full sm:w-auto sm:min-w-[19rem] rounded-lg bg-inset p-1 text-sm"
    >
      <span
        aria-hidden="true"
        className="absolute top-1 bottom-1 left-1 rounded-md bg-surface border border-line shadow-sm transition-transform duration-200 ease-out"
        style={{
          width: `calc((100% - 0.5rem) / 3)`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {OPTIONS.map((option) => (
        <button
          key={option}
          role="tab"
          aria-selected={option === view}
          onClick={() => onChange(option)}
          className={`relative z-10 rounded-md py-1.5 text-center font-medium transition-colors ${
            option === view ? "text-fg" : "text-muted hover:text-fg"
          }`}
        >
          {VIEW_LABELS[option]}
        </button>
      ))}
    </div>
  );
}
