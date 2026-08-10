import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { getReleve, getSemestres } from "../api";
import { cacheGet, cacheSet } from "../offlineCache";
import { getGradeHistory, recordGradeHistory, type GradeHistoryItem } from "../gradeHistory";
import { semestreLabel } from "../semestreLabel";
import { newlyPublishedIds, numericNoteValue, semesterMoyenne } from "../simulator";
import type { AbsencesByDate, Releve, ReleveResponse } from "../types";
import type { SemestrePoint } from "../components/EvolutionChart";
import type { ViewMode } from "../viewMode";

interface ReleveResult {
  releve: Releve;
  absences: AbsencesByDate | undefined;
  previous: Releve | null;
}

async function fetchReleve(semestreId: string, refresh = false): Promise<ReleveResult> {
  // Capture la valeur précédente AVANT que withOfflineFallback l'écrase dans le cache localStorage.
  const previous = cacheGet<ReleveResponse>(`releve:${semestreId}`)?.relevé ?? null;
  const data = await getReleve(semestreId, refresh);
  return { releve: data.relevé, absences: data.absences, previous };
}

/** Bootstrap, sélection du semestre, relevé courant/précédent/historique, badge d'app,
 * et historique des notes découvertes. Regroupe tout ce qui touche aux données ScoDoc
 * elles-mêmes, indépendamment de la simulation ou de l'UI. */
export function useReleveData(view: ViewMode) {
  const queryClient = useQueryClient();
  const [semestreId, setSemestreId] = useState<string | null>(null);
  const [gradeHistory, setGradeHistory] = useState<GradeHistoryItem[]>([]);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  const { data: bootstrap, isLoading, error: bootstrapError } = useQuery({
    queryKey: ["semestres"],
    queryFn: getSemestres,
  });

  // Initialise semestreId et pré-alimente le cache React Query avec le relevé inclus dans
  // la réponse bootstrap pour éviter un second appel réseau sur le semestre courant.
  useEffect(() => {
    if (!bootstrap) return;
    if (!semestreId) {
      setSemestreId(bootstrap.semestres[bootstrap.semestres.length - 1]?.formsemestre_id ?? null);
    }
    if (bootstrap.relevé && bootstrap.semestres.length > 0) {
      const sid = bootstrap.semestres[bootstrap.semestres.length - 1].formsemestre_id;
      if (!queryClient.getQueryData(["releve", sid])) {
        const previous = cacheGet<ReleveResponse>(`releve:${sid}`)?.relevé ?? null;
        queryClient.setQueryData<ReleveResult>(["releve", sid], {
          releve: bootstrap.relevé,
          absences: bootstrap.absences,
          previous,
        });
        cacheSet(`releve:${sid}`, { relevé: bootstrap.relevé, absences: bootstrap.absences });
      }
    }
  }, [bootstrap]);

  // ── Relevé du semestre courant ─────────────────────────────────────────────
  const { data: currentResult } = useQuery({
    queryKey: ["releve", semestreId],
    queryFn: () => fetchReleve(semestreId!),
    enabled: !!semestreId,
  });

  const releve = currentResult?.releve ?? null;
  const absences = currentResult?.absences;

  // ── Semestre précédent (tendance uniquement) ──────────────────────────────
  const prevSemestreId = useMemo(() => {
    if (!bootstrap || !semestreId) return null;
    const idx = bootstrap.semestres.findIndex((s) => s.formsemestre_id === semestreId);
    return idx > 0 ? bootstrap.semestres[idx - 1].formsemestre_id : null;
  }, [bootstrap, semestreId]);

  const { data: prevResult } = useQuery({
    queryKey: ["releve", prevSemestreId],
    queryFn: () => fetchReleve(prevSemestreId!),
    enabled: !!prevSemestreId,
  });

  // ── Relevés de tous les semestres (vue Graphiques seulement) ──────────────
  // useQueries partage le même cache que useQuery ci-dessus : React Query déduplique
  // automatiquement les fetches concurrents sur le même semestre.
  const evolutionQueries = useQueries({
    queries: (bootstrap?.semestres ?? []).map((s) => ({
      queryKey: ["releve", s.formsemestre_id],
      queryFn: () => fetchReleve(s.formsemestre_id),
      enabled: view === "graphiques",
    })),
  });

  const allReleves = useMemo(() => {
    const result: Record<string, Releve> = {};
    evolutionQueries.forEach((q, idx) => {
      const s = bootstrap?.semestres[idx];
      if (q.data && s) result[s.formsemestre_id] = q.data.releve;
    });
    return result;
  }, [evolutionQueries, bootstrap]);

  const evolution = useMemo<SemestrePoint[]>(() => {
    return (bootstrap?.semestres ?? []).map((s, idx) => ({
      titre: semestreLabel(s),
      moyenne: evolutionQueries[idx]?.data?.releve
        ? numericNoteValue(evolutionQueries[idx].data!.releve.semestre.notes?.value)
        : null,
    }));
  }, [evolutionQueries, bootstrap]);

  // ── Nouvelles notes et historique ─────────────────────────────────────────
  const newIds = useMemo(() => {
    if (!releve || !currentResult?.previous) return new Set<number>();
    return newlyPublishedIds(currentResult.previous, releve);
  }, [releve, currentResult?.previous]);

  useEffect(() => {
    if (!releve || !semestreId) return;
    const history = recordGradeHistory(semestreId, currentResult?.previous ?? null, releve);
    setGradeHistory(history);
  }, [releve, semestreId]);

  useEffect(() => {
    if (!semestreId) return;
    setGradeHistory(getGradeHistory(semestreId));
  }, [semestreId]);

  // ── Tendance vs semestre précédent ─────────────────────────────────────────
  const trend = useMemo(() => {
    if (!releve || !prevResult?.releve) return null;
    const cur = semesterMoyenne(releve);
    const prev = semesterMoyenne(prevResult.releve);
    if (cur === null || prev === null) return null;
    return cur - prev;
  }, [releve, prevResult]);

  // Badge de notification sur l'icône de l'app installée (API Badging — iOS 16.4+, Chrome)
  useEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    const nav = navigator as Navigator & {
      setAppBadge(n?: number): Promise<void>;
      clearAppBadge(): Promise<void>;
    };
    if (newIds.size > 0) {
      nav.setAppBadge(newIds.size).catch(() => {});
    } else {
      nav.clearAppBadge().catch(() => {});
    }
    return () => { nav.clearAppBadge?.().catch(() => {}); };
  }, [newIds]);

  // Opération brute (sans gérer d'indicateur de chargement) : réutilisée telle quelle par le
  // bouton de rafraîchissement (refreshing, ci-dessous) et par la réinitialisation de simulation
  // (useSimulation.handleReset, qui a son propre indicateur "resetting") — les deux partagent
  // uniquement le message d'erreur (refreshError).
  async function fetchAndCacheCurrent(): Promise<void> {
    if (!semestreId) return;
    const result = await fetchReleve(semestreId, true);
    queryClient.setQueryData<ReleveResult>(["releve", semestreId], result);
  }

  async function refreshCurrent() {
    if (!semestreId || refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await fetchAndCacheCurrent();
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Erreur lors du rechargement");
    } finally {
      setRefreshing(false);
    }
  }

  return {
    bootstrap,
    isLoading,
    bootstrapError,
    semestreId,
    setSemestreId,
    releve,
    absences,
    newIds,
    trend,
    evolution,
    allReleves,
    gradeHistory,
    refreshing,
    refreshError,
    setRefreshError,
    refreshCurrent,
    fetchAndCacheCurrent,
  };
}
