import { useEffect, useState } from "react";

export type ViewMode = "simple" | "complet" | "graphiques";
const VALID: ViewMode[] = ["simple", "complet", "graphiques"];
const STORAGE_KEY = "notes-iut-view";

function getInitialView(): ViewMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return (VALID as string[]).includes(stored ?? "") ? (stored as ViewMode) : "simple";
}

export function useViewMode() {
  const [view, setView] = useState<ViewMode>(getInitialView);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, view);
  }, [view]);

  return { view, setView };
}
