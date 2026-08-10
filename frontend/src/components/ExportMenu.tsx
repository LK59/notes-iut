import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  semestreId: string;
  onExportSimulation: () => void;
}

export default function ExportMenu({ semestreId, onExportSimulation }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const popup = document.querySelector("[data-export-popup]");
      if (buttonRef.current?.contains(e.target as Node) || popup?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Ferme au clavier (Échap) et rend le focus au bouton déclencheur ; déplace le focus
  // dans le menu à l'ouverture pour les utilisateurs au clavier/lecteur d'écran.
  useEffect(() => {
    if (!open) return;
    popupRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function toggleMenu() {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const margin = 8;
      const width = Math.min(320, window.innerWidth - margin * 2);
      const top = Math.min(rect.bottom + margin, window.innerHeight - margin);
      const left =
        window.innerWidth < 640
          ? (window.innerWidth - width) / 2
          : Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
      setPopupStyle({
        position: "fixed",
        top,
        left,
        width,
        maxHeight: `calc(100vh - ${top + margin}px)`,
        overflowY: "auto",
      });
    }
    setOpen((o) => !o);
  }

  const popup = open ? (
    <div
      data-export-popup
      ref={popupRef}
      role="menu"
      aria-label="Export"
      tabIndex={-1}
      style={popupStyle}
      className="rounded-lg border border-sky-200/70 dark:border-slate-700/70 bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl ring-1 ring-black/5 dark:ring-white/10 shadow-lg overflow-hidden z-[9999] focus:outline-none"
    >
      <a
        href={`/api/bulletin-pdf/${semestreId}?type=BUT`}
        target="_blank"
        rel="noopener noreferrer"
        role="menuitem"
        onClick={() => setOpen(false)}
        className="block px-3 py-2.5 text-sm text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-slate-700 border-b border-sky-100 dark:border-slate-700"
      >
        <span className="font-medium">Bulletin officiel</span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">Document PDF généré par ScoDoc</span>
      </a>
      <button
        role="menuitem"
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
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggleMenu}
        aria-haspopup="menu"
        aria-expanded={open}
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
      {createPortal(popup, document.body)}
    </>
  );
}
