const SECTIONS = [
  { id: "resume", label: "Résumé" },
  { id: "absences", label: "Absences" },
  { id: "notes-a-saisir", label: "Notes à saisir" },
  { id: "objectif", label: "Objectif" },
  { id: "graphiques", label: "Graphiques" },
  { id: "detail-ue", label: "Détail par UE" },
];

export default function SectionNav() {
  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav className="print:hidden -mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto">
      <div className="flex gap-2 pb-1">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => jump(s.id)}
            className="shrink-0 rounded-full border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1 text-xs text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            {s.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
