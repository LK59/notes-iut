import { useEffect, useState } from "react";
import { moyenneGenerale, ueMoyenne } from "../simulator";
import type { Releve } from "../types";

const PREVIEW_PREFIX = "notes-iut-preview:";

function loadOverrides(semestreId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(PREVIEW_PREFIX + semestreId);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveOverrides(semestreId: string, overrides: Record<string, number>) {
  try {
    localStorage.setItem(PREVIEW_PREFIX + semestreId, JSON.stringify(overrides));
  } catch {
    // best effort — la simulation reste fonctionnelle même si le stockage échoue
  }
}

/** Simulation locale de notes fictives pour un semestre prévisionnel (S5/S6), persistée par
 * semestre en localStorage. Même mécanisme que useSimulation, mais sans notion de "vraies
 * données" à recharger : reset revient simplement à des overrides vides. */
export function usePrevisionSimulation(semestreId: string, releve: Releve) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [confirmingReset, setConfirmingReset] = useState(false);

  useEffect(() => {
    setOverrides(loadOverrides(semestreId));
    setConfirmingReset(false);
  }, [semestreId]);

  useEffect(() => {
    saveOverrides(semestreId, overrides);
  }, [semestreId, overrides]);

  useEffect(() => {
    if (!confirmingReset) return;
    const id = setTimeout(() => setConfirmingReset(false), 4000);
    return () => clearTimeout(id);
  }, [confirmingReset]);

  const ueMoyennes: Record<string, number | null> = {};
  for (const [code, ue] of Object.entries(releve.ues)) {
    ueMoyennes[code] = ueMoyenne(ue, releve, overrides);
  }
  const moyenneSimulee = moyenneGenerale(releve.ues, ueMoyennes);
  const hasSimulation = Object.keys(overrides).length > 0;

  function handleOverrideChange(key: string, value: number | undefined) {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function handleReset() {
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }
    setConfirmingReset(false);
    setOverrides({});
  }

  return {
    overrides,
    ueMoyennes,
    moyenneSimulee,
    hasSimulation,
    confirmingReset,
    handleOverrideChange,
    handleReset,
  };
}
