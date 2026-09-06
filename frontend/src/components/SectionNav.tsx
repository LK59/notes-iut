import { useEffect, useRef, useState } from "react";

/**
 * Source unique des libellés de section : la barre de navigation ET les titres de
 * blocs les lisent ici. Auparavant chaque section portait deux noms différents
 * ("Récap matières" dans la barre, "Récapitulatif par matière" en titre), ce qui
 * donnait l'impression que la navigation venait d'une autre application.
 */
export const SECTIONS = [
  { id: "resume", label: "Résumé" },
  { id: "notes-non-publiees", label: "Notes non publiées" },
  { id: "objectif", label: "Objectif" },
  { id: "par-matiere", label: "Par matière" },
  { id: "detail-ue", label: "Détail par UE" },
  { id: "absences", label: "Absences" },
] as const;

export const SECTION_LABEL = Object.fromEntries(
  SECTIONS.map((section) => [section.id, section.label])
) as Record<(typeof SECTIONS)[number]["id"], string>;

export default function SectionNav() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const railRef = useRef<HTMLElement>(null);

  // Section courante mise en évidence : sans ça, la barre était un simple rail de
  // raccourcis sans état, empilé juste sous la bascule de vue — deux barres
  // horizontales de comportements différents à quelques pixels l'une de l'autre.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // Bande de détection sous l'en-tête collant : la section « courante » est celle
      // qui occupe le haut de la zone réellement lisible, pas le haut du viewport.
      { rootMargin: "-140px 0px -55% 0px", threshold: 0 }
    );

    for (const section of SECTIONS) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  // Garde la pastille active visible quand le rail déborde horizontalement.
  //
  // Le défilement est appliqué au rail lui-même, jamais via scrollIntoView : celui-ci
  // remonte TOUS les ancêtres scrollables, la page comprise. Comme la barre sort du
  // champ dès qu'on descend, chaque changement de section active ramenait la fenêtre
  // vers le haut — la page se battait contre l'utilisateur et devenait impossible à
  // faire défiler en vue Détaillé.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || rail.scrollWidth <= rail.clientWidth) return;
    const button = rail.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!button) return;
    const railBox = rail.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    const delta = buttonBox.left - railBox.left - (railBox.width - buttonBox.width) / 2;
    rail.scrollTo({ left: rail.scrollLeft + delta, behavior: "smooth" });
  }, [active]);

  return (
    <nav
      ref={railRef}
      aria-label="Sections"
      className="-mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto no-scrollbar print:hidden"
    >
      <div className="flex gap-1.5 pb-0.5">
        {SECTIONS.map((section) => {
          const isActive = section.id === active;
          return (
            <button
              key={section.id}
              data-section={section.id}
              aria-current={isActive ? "true" : undefined}
              onClick={() =>
                document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                isActive ? "bg-accent-soft text-accent" : "text-muted hover:bg-inset hover:text-fg"
              }`}
            >
              {section.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
