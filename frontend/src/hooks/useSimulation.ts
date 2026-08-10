import { useEffect, useState } from "react";
import { moyenneGenerale, pendingItems, ueMoyenne } from "../simulator";
import type { Releve } from "../types";

const SIM_PREFIX = "notes-iut-sim:";

function loadSimulation(semestreId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(SIM_PREFIX + semestreId);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSimulation(semestreId: string, overrides: Record<string, number>) {
  try {
    localStorage.setItem(SIM_PREFIX + semestreId, JSON.stringify(overrides));
  } catch {
    // best effort — la simulation reste fonctionnelle même si le stockage échoue
  }
}

/** Simulation locale de notes (overrides persistés par semestre en localStorage) : moyennes
 * simulées, notes en attente, et réinitialisation (avec confirmation) vers les vraies données.
 * fetchAndCacheCurrent et setRefreshError viennent de useReleveData : la réinitialisation
 * partage le message d'erreur avec le bouton de rafraîchissement, mais a son propre indicateur
 * de chargement (resetting), indépendant de "refreshing". */
export function useSimulation(
  semestreId: string | null,
  releve: Releve | null,
  fetchAndCacheCurrent: () => Promise<void>,
  setRefreshError: (message: string | null) => void
) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  useEffect(() => {
    if (!semestreId) return;
    setOverrides(loadSimulation(semestreId));
    setSelectedKey(null);
    setConfirmingReset(false);
  }, [semestreId]);

  useEffect(() => {
    if (!semestreId) return;
    saveSimulation(semestreId, overrides);
  }, [semestreId, overrides]);

  // L'état "confirmation demandée" ne doit pas rester actif indéfiniment ni survivre à un
  // changement de semestre — sinon un clic accidentel plus tard pourrait effacer la simulation
  // sans qu'on s'en rende compte.
  useEffect(() => {
    if (!confirmingReset) return;
    const id = setTimeout(() => setConfirmingReset(false), 4000);
    return () => clearTimeout(id);
  }, [confirmingReset]);

  const ueMoyennes: Record<string, number | null> = {};
  if (releve) {
    for (const [code, ue] of Object.entries(releve.ues)) {
      ueMoyennes[code] = ueMoyenne(ue, releve, overrides);
    }
  }

  const moyenneSimulee = releve ? moyenneGenerale(releve.ues, ueMoyennes) : null;
  const pending = releve ? pendingItems(releve) : [];
  const hasSimulation = Object.keys(overrides).length > 0;

  function handleOverrideChange(key: string, value: number | undefined) {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function handleApplyMany(keys: string[], value: number) {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = value;
      return next;
    });
  }

  async function handleReset() {
    if (!semestreId) return;
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }
    setConfirmingReset(false);
    setOverrides({});
    setSelectedKey(null);
    setResetting(true);
    setRefreshError(null);
    try {
      await fetchAndCacheCurrent();
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Erreur lors du rechargement");
    } finally {
      setResetting(false);
    }
  }

  return {
    overrides,
    selectedKey,
    setSelectedKey,
    ueMoyennes,
    moyenneSimulee,
    pending,
    hasSimulation,
    resetting,
    confirmingReset,
    setConfirmingReset,
    handleOverrideChange,
    handleApplyMany,
    handleReset,
  };
}
