import { useCallback, useEffect, useMemo, useState } from "react";
import { moyenneGenerale, pendingItems, ueAggregate, type Agg } from "../simulator";
import type { Releve } from "../types";

const SIM_PREFIX = "notes-iut-sim:";
const EMPTY_OVERRIDES: Record<string, number> = {};

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
  // Le semestre auquel appartiennent les surcharges est porté par le même état qu'elles.
  // Avec deux états séparés, l'effet de sauvegarde se déclenchait au changement de semestre
  // avec les surcharges de l'ancien encore en mémoire, et les écrivait sous la clé du
  // nouveau — écrasé au rendu suivant, sauf si le composant était démonté entre-temps.
  const [sim, setSim] = useState<{ semestreId: string | null; overrides: Record<string, number> }>({
    semestreId: null,
    overrides: {},
  });
  const overrides = sim.semestreId === semestreId ? sim.overrides : EMPTY_OVERRIDES;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  useEffect(() => {
    if (!semestreId) return;
    setSim({ semestreId, overrides: loadSimulation(semestreId) });
    setSelectedKey(null);
    setConfirmingReset(false);
  }, [semestreId]);

  useEffect(() => {
    if (!sim.semestreId || sim.semestreId !== semestreId) return;
    saveSimulation(sim.semestreId, sim.overrides);
  }, [semestreId, sim]);

  // L'état "confirmation demandée" ne doit pas rester actif indéfiniment ni survivre à un
  // changement de semestre — sinon un clic accidentel plus tard pourrait effacer la simulation
  // sans qu'on s'en rende compte.
  useEffect(() => {
    if (!confirmingReset) return;
    const id = setTimeout(() => setConfirmingReset(false), 4000);
    return () => clearTimeout(id);
  }, [confirmingReset]);

  // Ces trois calculs parcourent toutes les UE, tous les modules et toutes les évaluations.
  // Sans mémoïsation ils étaient refaits à chaque rendu — donc à chaque caractère tapé dans
  // un champ de note, ce qui était la cause principale de la latence de saisie sur mobile.
  // Agrégats complets (valeur + min/moy/max de promo) calculés une fois pour toutes : la
  // moyenne seule était recalculée ici, puis une seconde fois par la vue Graphiques qui a
  // besoin de `moy`. Les UeTable, elles, gardent leur calcul local — grâce au memo ci-dessus
  // il ne tourne que pour l'UE effectivement modifiée, plutôt que pour toutes.
  const ueAggregates = useMemo<Record<string, Agg>>(() => {
    const result: Record<string, Agg> = {};
    if (!releve) return result;
    for (const [code, ue] of Object.entries(releve.ues)) {
      result[code] = ueAggregate(ue, releve, overrides, code);
    }
    return result;
  }, [releve, overrides]);

  const ueMoyennes = useMemo<Record<string, number | null>>(() => {
    const result: Record<string, number | null> = {};
    for (const [code, aggregate] of Object.entries(ueAggregates)) result[code] = aggregate.value;
    return result;
  }, [ueAggregates]);

  const moyenneSimulee = useMemo(
    () => (releve ? moyenneGenerale(releve.ues, ueMoyennes) : null),
    [releve, ueMoyennes]
  );

  // Ne dépend que du relevé : les surcharges ne changent pas la liste des notes non publiées.
  const pending = useMemo(() => (releve ? pendingItems(releve) : []), [releve]);

  const hasSimulation = Object.keys(overrides).length > 0;

  const updateOverrides = useCallback(
    (update: (prev: Record<string, number>) => Record<string, number>) => {
      setSim((prev) => {
        if (prev.semestreId !== semestreId) return prev;
        return { semestreId: prev.semestreId, overrides: update(prev.overrides) };
      });
    },
    [semestreId]
  );

  // useCallback, sinon ces fonctions changent d'identité à chaque rendu du tableau de bord
  // et suffisent à elles seules à annuler le memo() de UeTable — donc à re-rendre toutes
  // les UE de la page à chaque caractère saisi dans un champ de note.
  const handleOverrideChange = useCallback(
    (key: string, value: number | undefined) => {
      updateOverrides((prev) => {
        const next = { ...prev };
        if (value === undefined) delete next[key];
        else next[key] = value;
        return next;
      });
    },
    [updateOverrides]
  );

  const handleApplyMany = useCallback(
    (keys: string[], value: number) => {
      updateOverrides((prev) => {
        const next = { ...prev };
        for (const k of keys) next[k] = value;
        return next;
      });
    },
    [updateOverrides]
  );

  async function handleReset() {
    if (!semestreId) return;
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }
    setConfirmingReset(false);
    updateOverrides(() => ({}));
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
    ueAggregates,
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
