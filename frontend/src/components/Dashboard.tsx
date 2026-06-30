import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { clearServerCache, getReleve, getSemestres, logout } from "../api";
import { cacheGet, cacheSet, clearDataCache } from "../offlineCache";
import type { AbsencesByDate, PremiereConnexionResponse, Releve, ReleveResponse, Semestre } from "../types";
import { moyenneGenerale, newlyPublishedIds, numericNoteValue, pendingItems, ueAggregate, ueMoyenne } from "../simulator";
import type { SemestrePoint } from "./EvolutionChart";
import UeTable from "./UeTable";
import SemestreSummary from "./SemestreSummary";
import PendingNotes from "./PendingNotes";
import ObjectiveCalculator from "./ObjectiveCalculator";
import AbsencesPanel from "./AbsencesPanel";
import BonusMalusPanel from "./BonusMalusPanel";
import SectionNav from "./SectionNav";
import ThemeToggle from "./ThemeToggle";
import ScrollToTop from "./ScrollToTop";
import PrintExport from "./PrintExport";
import ExportMenu from "./ExportMenu";
import SimpleView from "./SimpleView";
import ViewToggle from "./ViewToggle";
import MatieresRecap from "./MatieresRecap";
import { useViewMode } from "../viewMode";
import { useOnline } from "../useOnline";
import { getGradeHistory, recordGradeHistory, type GradeHistoryItem } from "../gradeHistory";
import GradeHistoryPanel from "./GradeHistoryPanel";
import { APP_VERSION, BUILD_ID } from "../version";
import SessionsPanel from "./SessionsPanel";
import AdminPanel from "./AdminPanel";

// Recharts pèse lourd dans le bundle : on ne le charge que si la vue Graphique est ouverte.
const GraphiquesView = lazy(() => import("./GraphiquesView"));

const SIM_PREFIX = "notes-iut-sim:";

function semestreLabel(s: Semestre): string {
  const num = s.semestre_id ? `S${s.semestre_id}` : "";
  const annee = s.annee_scolaire ? `(${s.annee_scolaire})` : "";
  return [s.titre, num, annee].filter(Boolean).join(" ");
}

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

function officialSemesterAverage(releve: Releve): number | null {
  return numericNoteValue(releve.semestre?.notes?.value);
}

export default function Dashboard({ username, isAdmin, onLoggedOut }: { username: string; isAdmin?: boolean; onLoggedOut: () => void }) {
  const [bootstrap, setBootstrap] = useState<PremiereConnexionResponse | null>(null);
  const [semestreId, setSemestreId] = useState<string | null>(null);
  const [releve, setReleve] = useState<Releve | null>(null);
  const [absences, setAbsences] = useState<AbsencesByDate | undefined>(undefined);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [evolution, setEvolution] = useState<SemestrePoint[]>([]);
  const [allReleves, setAllReleves] = useState<Record<string, Releve>>({});
  const [gradeHistory, setGradeHistory] = useState<GradeHistoryItem[]>([]);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [printMode, setPrintMode] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const online = useOnline();
  const { view, setView } = useViewMode();
  // Tracks which semestreId already has its relevé loaded from the bootstrap response,
  // so the semestreId effect can skip the redundant getReleve() network call.
  const bootstrapReleveId = useRef<string | null>(null);

  useEffect(() => {
    getSemestres()
      .then((data) => {
        setBootstrap(data);
        const initial = data.semestres[data.semestres.length - 1]?.formsemestre_id ?? null;
        setSemestreId(initial);
        // premiere_connexion already returns the last semester's relevé — use it directly
        // to skip a redundant getReleve() call and avoid the "Chargement du relevé…" phase.
        if (data.relevé && initial) {
          const prev = cacheGet<ReleveResponse>(`releve:${initial}`);
          setReleve(data.relevé);
          setAbsences(data.absences);
          setNewIds(newlyPublishedIds(prev?.relevé ?? null, data.relevé));
          setGradeHistory(recordGradeHistory(initial, prev?.relevé ?? null, data.relevé));
          setAllReleves({ [initial]: data.relevé });
          cacheSet(`releve:${initial}`, { relevé: data.relevé, absences: data.absences });
          bootstrapReleveId.current = initial;
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!semestreId) return;
    setOverrides(loadSimulation(semestreId));
    setSelectedKey(null);
    const knownReleve = allReleves[semestreId];
    if (knownReleve) {
      setReleve(knownReleve);
    }
    // Skip if the relevé was already populated from the bootstrap response above.
    if (semestreId === bootstrapReleveId.current) {
      bootstrapReleveId.current = null;
      return;
    }
    let cancelled = false;
    // On lit le cache local AVANT le fetch (qui l'écrasera) pour détecter les notes
    // apparues depuis la dernière visite sur ce semestre.
    const previous = cacheGet<ReleveResponse>(`releve:${semestreId}`);
    setGradeHistory(getGradeHistory(semestreId));
    getReleve(semestreId)
      .then((data) => {
        if (cancelled) return;
        setReleve(data.relevé);
        setAbsences(data.absences);
        setNewIds(newlyPublishedIds(previous?.relevé ?? null, data.relevé));
        setGradeHistory(recordGradeHistory(semestreId, previous?.relevé ?? null, data.relevé));
        setAllReleves((prev) => ({ ...prev, [semestreId]: data.relevé }));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [semestreId]);

  // Persiste la simulation en cours (localStorage) sans jamais bloquer le rendu : c'est de
  // l'état purement local à l'utilisateur, distinct des données réseau (network-first).
  useEffect(() => {
    if (!semestreId) return;
    saveSimulation(semestreId, overrides);
  }, [semestreId, overrides]);

  // Charge la moyenne officielle de chaque semestre pour la courbe d'évolution
  useEffect(() => {
    if (!bootstrap) return;
    let cancelled = false;
    Promise.all(
      bootstrap.semestres.map(async (s) => {
        try {
          const data = await getReleve(s.formsemestre_id);
          if (!cancelled) setAllReleves((prev) => ({ ...prev, [s.formsemestre_id]: data.relevé }));
          return { titre: semestreLabel(s), moyenne: officialSemesterAverage(data.relevé) };
        } catch {
          return { titre: semestreLabel(s), moyenne: null };
        }
      })
    ).then((points) => {
      if (!cancelled) setEvolution(points);
    });
    return () => {
      cancelled = true;
    };
  }, [bootstrap]);

  // Tendance vs semestre précédent.
  // Utilise allReleves[semestreId] (pas `releve`) pour éviter le décalage transitoire
  // où semestreId vient de changer mais releve contient encore le semestre précédent.
  // ueAggregate recompute depuis les évaluations brutes (fiable pour semestres en cours) ;
  // fallback sur ue.moyenne pour les semestres archivés où ScoDoc ne renvoie plus le détail.
  const trend = useMemo(() => {
    if (!bootstrap || !semestreId) return null;
    const idx = bootstrap.semestres.findIndex((s) => s.formsemestre_id === semestreId);
    if (idx <= 0) return null;
    const currentPoint = evolution[idx];
    const previousPoint = evolution[idx - 1];
    if (currentPoint?.moyenne !== null && currentPoint?.moyenne !== undefined && previousPoint?.moyenne !== null && previousPoint?.moyenne !== undefined) {
      return currentPoint.moyenne - previousPoint.moyenne;
    }
    const prevId = bootstrap.semestres[idx - 1].formsemestre_id;
    const curReleve = allReleves[semestreId] ?? releve;
    const prevReleve = allReleves[prevId];
    if (!curReleve || !prevReleve) return null;
    function semMoy(r: Releve): number | null {
      const moys: Record<string, number | null> = {};
      for (const [code, ue] of Object.entries(r.ues)) {
        if (ue.type === 1) continue;
        const agg = ueAggregate(ue, r, {}).value;
        if (agg !== null) { moys[code] = agg; continue; }
        // Semestre archivé : la note est stockée directement sur l'UE
        const m = ue.moyenne;
        moys[code] = typeof m === "object" && m !== null
          ? numericNoteValue((m as { value?: unknown }).value as never)
          : numericNoteValue(m as never);
      }
      return moyenneGenerale(r.ues, moys);
    }
    const cur = semMoy(curReleve);
    const prev = semMoy(prevReleve);
    if (cur === null || prev === null) return null;
    return cur - prev;
  }, [bootstrap, semestreId, evolution, allReleves, releve]);

  // Export PDF : on force tout en ouvert et en thème clair pour le rendu imprimé (les classes
  // dark: de Tailwind dépendent de la classe .dark sur <html>, pas du media query print), puis
  // on imprime — la boîte de dialogue "Enregistrer en PDF" du navigateur fait le reste. La
  // restauration du thème se fait sur "afterprint" plutôt que juste après print() : sur Chrome,
  // print() rend la prévisualisation de façon asynchrone, donc restaurer trop tôt la ferait dark.
  const wasDarkRef = useRef(false);
  useEffect(() => {
    if (!printMode) return;
    wasDarkRef.current = document.documentElement.classList.contains("dark");
    document.documentElement.classList.remove("dark");
    const id = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(id);
  }, [printMode]);

  useEffect(() => {
    const handleAfterPrint = () => {
      if (wasDarkRef.current) document.documentElement.classList.add("dark");
      setPrintMode(false);
    };
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  const hasSimulation = Object.keys(overrides).length > 0;

  // L'état "confirmation demandée" ne doit pas rester actif indéfiniment ni survivre à un
  // changement de semestre — sinon un clic accidentel plus tard pourrait effacer la simulation
  // sans qu'on s'en rende compte.
  useEffect(() => {
    if (!confirmingReset) return;
    const id = setTimeout(() => setConfirmingReset(false), 4000);
    return () => clearTimeout(id);
  }, [confirmingReset]);

  useEffect(() => {
    setConfirmingReset(false);
  }, [semestreId]);

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

  const ueMoyennes = useMemo(() => {
    if (!releve) return {};
    const result: Record<string, number | null> = {};
    for (const [code, ue] of Object.entries(releve.ues)) {
      result[code] = ueMoyenne(ue, releve, overrides);
    }
    return result;
  }, [releve, overrides]);

  const moyenneSimulee = useMemo(() => (releve ? moyenneGenerale(releve.ues, ueMoyennes) : null), [releve, ueMoyennes]);
  const pending = useMemo(() => (releve ? pendingItems(releve) : []), [releve]);

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

  async function handleRefresh() {
    if (!semestreId || refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const previous = cacheGet<ReleveResponse>(`releve:${semestreId}`);
      const data = await getReleve(semestreId, true);
      setReleve(data.relevé);
      setAbsences(data.absences);
      setNewIds(newlyPublishedIds(previous?.relevé ?? null, data.relevé));
      setGradeHistory(recordGradeHistory(semestreId, previous?.relevé ?? null, data.relevé));
      setAllReleves((prev) => ({ ...prev, [semestreId]: data.relevé }));
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Erreur lors du rechargement");
    } finally {
      setRefreshing(false);
    }
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
      const previous = cacheGet<ReleveResponse>(`releve:${semestreId}`);
      const data = await getReleve(semestreId, true);
      setReleve(data.relevé);
      setGradeHistory(recordGradeHistory(semestreId, previous?.relevé ?? null, data.relevé));
      setAllReleves((prev) => ({ ...prev, [semestreId]: data.relevé }));
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Erreur lors du rechargement");
    } finally {
      setResetting(false);
    }
  }

  if (loading) return <Centered>Chargement de tes relevés…</Centered>;
  if (error) return <DashboardError message={error} onLoggedOut={onLoggedOut} />;
  if (!bootstrap || !releve) return <Centered>Chargement du relevé…</Centered>;

  const ueEntries = Object.entries(releve.ues).filter(([, ue]) => ue.type !== 1);
  const currentSemestre = bootstrap.semestres.find((s) => s.formsemestre_id === semestreId);

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-100 via-sky-50 to-sky-200 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 relative">
      {/* Motif abstrait statique — met en valeur l'effet de transparence des tuiles */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 w-full h-full text-sky-900 dark:text-sky-300 opacity-[0.07] dark:opacity-[0.09]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="bg-pattern" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="20" cy="20" r="1.3" fill="currentColor" />
            <circle cx="0" cy="0" r="1.3" fill="currentColor" />
            <circle cx="40" cy="0" r="1.3" fill="currentColor" />
            <circle cx="0" cy="40" r="1.3" fill="currentColor" />
            <circle cx="40" cy="40" r="1.3" fill="currentColor" />
            <line x1="14" y1="20" x2="26" y2="20" stroke="currentColor" strokeWidth="0.7" />
            <line x1="20" y1="14" x2="20" y2="26" stroke="currentColor" strokeWidth="0.7" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg-pattern)" />
      </svg>
      <header className="print:hidden sticky top-0 z-20 bg-white/60 dark:bg-slate-900/60 backdrop-blur-2xl border-b border-sky-200/60 dark:border-slate-800/60 shadow-sm px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/api/photo"
            alt=""
            className="h-9 w-9 rounded-full object-cover border border-sky-200 dark:border-slate-700 shrink-0"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          <h1 className="text-base sm:text-lg font-semibold text-sky-950 dark:text-sky-100 truncate">
            Notes IUT Annecy — {username}
          </h1>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Rafraîchir les données"
            title="Rafraîchir les données"
            className="shrink-0 p-1.5 rounded-full text-slate-400 hover:text-sky-700 hover:bg-sky-50 dark:text-slate-500 dark:hover:text-sky-300 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <svg
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {newIds.size > 0 && (
            <button
              onClick={() =>
                document
                  .getElementById(view === "simple" ? "matieres" : "detail-ue")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              title="Aller aux nouvelles notes"
              className="shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-xs font-medium px-2 py-0.5 whitespace-nowrap hover:bg-emerald-200 dark:hover:bg-emerald-900/60"
            >
              {newIds.size} nouvelle{newIds.size > 1 ? "s" : ""} note{newIds.size > 1 ? "s" : ""}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <select
            value={semestreId ?? ""}
            onChange={(e) => setSemestreId(e.target.value)}
            className="rounded-md border border-sky-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-1.5 text-sm flex-1 min-w-0"
          >
            {bootstrap.semestres.map((s) => (
              <option key={s.formsemestre_id} value={s.formsemestre_id}>
                {semestreLabel(s)}
              </option>
            ))}
          </select>
          <ViewToggle view={view} onChange={setView} />
          {semestreId && <ExportMenu semestreId={semestreId} onExportSimulation={() => setPrintMode(true)} />}
          <ThemeToggle />
          <button
            onClick={() => setSessionsOpen(true)}
            className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 whitespace-nowrap"
          >
            Sessions
          </button>
          {isAdmin && (
            <button
              onClick={() => setAdminOpen(true)}
              className="text-sm text-sky-700 dark:text-sky-300 hover:text-sky-900 dark:hover:text-sky-100 whitespace-nowrap"
            >
              Admin
            </button>
          )}
          <button
            onClick={() => logout().catch(() => {}).finally(onLoggedOut)}
            className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 whitespace-nowrap"
          >
            Déconnexion
          </button>
        </div>
      </header>

      <PrintExport
        releve={releve}
        overrides={overrides}
        username={username}
        semestreTitle={currentSemestre ? semestreLabel(currentSemestre) : ""}
        hasSimulation={hasSimulation}
        moyenneGenerale={moyenneSimulee}
      />

      <main className="print:hidden max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6 overflow-x-hidden">
        {view === "complet" && <SectionNav />}
        <GradeHistoryPanel items={gradeHistory} />

        {!online && (
          <div className="print:hidden bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm rounded-lg p-3">
            Mode hors-ligne : affichage des dernières données enregistrées sur cet appareil, possiblement obsolètes.
          </div>
        )}

        {refreshError && (
          <div className="print:hidden flex items-center justify-between gap-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm rounded-lg p-3">
            <span>{refreshError}</span>
            <button onClick={() => setRefreshError(null)} className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-200" aria-label="Fermer">✕</button>
          </div>
        )}

        {releve.message && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm rounded-lg p-3">
            {releve.message}
          </div>
        )}

        <div id="resume">
          <SemestreSummary releve={releve} trend={trend} />
        </div>

        {view === "simple" && (
          <div id="matieres">
            <SimpleView releve={releve} selectedKey={selectedKey} onSelect={setSelectedKey} />
          </div>
        )}

        {view === "complet" && (
          <>
        <div id="notes-a-saisir" className="print:hidden">
          <PendingNotes items={pending} overrides={overrides} onChange={handleOverrideChange} />
        </div>

        {hasSimulation && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-sm text-amber-700 dark:text-amber-300">Moyenne générale simulée avec tes modifications</span>
              <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">
                {moyenneSimulee !== null ? moyenneSimulee.toFixed(2) : "—"} / 20
              </div>
            </div>
            <div className="print:hidden flex items-center gap-2 self-start sm:self-auto">
              {confirmingReset && (
                <button
                  onClick={() => setConfirmingReset(false)}
                  className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
                >
                  Annuler
                </button>
              )}
              <button
                onClick={handleReset}
                disabled={resetting}
                className={`rounded-md border px-3 py-1.5 text-sm disabled:opacity-50 whitespace-nowrap ${
                  confirmingReset
                    ? "border-red-300 dark:border-red-700 bg-red-600 text-white hover:bg-red-700"
                    : "border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-slate-700"
                }`}
              >
                {resetting ? "Réinitialisation…" : confirmingReset ? "Confirmer la réinitialisation ?" : "Réinitialiser (revenir à la vérité)"}
              </button>
            </div>
          </div>
        )}

        <div id="objectif" className="print:hidden">
          <ObjectiveCalculator releve={releve} overrides={overrides} onApply={handleApplyMany} />
        </div>

        <div id="matieres">
          <MatieresRecap releve={releve} overrides={overrides} />
        </div>

        <div id="detail-ue">
          <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-1">Détail par UE</h2>
          <p className="print:hidden text-xs text-slate-600 dark:text-slate-400 mb-3">
            Clique l'en-tête d'une UE pour la replier, clique un module pour replier ses évaluations, clique une
            évaluation pour voir sa position dans la promo.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
            {ueEntries.map(([code, ue]) => (
              <UeTable
                key={code}
                ueCode={code}
                ue={ue}
                releve={releve}
                overrides={overrides}
                onChange={handleOverrideChange}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                printMode={printMode}
                newIds={newIds}
              />
            ))}
          </div>
        </div>

        <div className="print:hidden">
          <BonusMalusPanel releve={releve} />
        </div>

        <div id="absences" className="print:hidden">
          <AbsencesPanel absences={absences} officialAbsences={releve.semestre.absences} />
        </div>
          </>
        )}

        {view === "graphiques" && (
          <Suspense fallback={<div className="h-[300px]" />}>
            <GraphiquesView
              releve={releve}
              overrides={overrides}
              ueMoyennes={ueMoyennes}
              evolution={evolution}
              allReleves={allReleves}
              semestres={bootstrap.semestres}
              currentSemestreId={semestreId}
            />
          </Suspense>
        )}
      </main>

      <footer className="print:hidden border-t border-sky-200/60 dark:border-slate-800/60 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl px-4 sm:px-6 py-3 text-center">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Notes IUT Annecy — simulateur non officiel · v{APP_VERSION} · {BUILD_ID}
        </p>
      </footer>

      <ScrollToTop />
      {sessionsOpen && <SessionsPanel onClose={() => setSessionsOpen(false)} />}
      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
    </div>
  );
}

function Centered({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-h-screen flex items-center justify-center bg-sky-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 px-4 text-center ${className}`}>
      {children}
    </div>
  );
}

function DashboardError({ message, onLoggedOut }: { message: string; onLoggedOut?: () => void }) {
  function handleClearAndReload() {
    clearDataCache();
    clearServerCache().catch(() => {}).finally(() => window.location.reload());
  }
  function handleLogout() {
    logout().catch(() => {}).finally(() => onLoggedOut?.());
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-sky-50 dark:bg-slate-950 px-4 text-center">
      <div className="max-w-sm space-y-4">
        <p className="text-red-600 dark:text-red-400">{message}</p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center flex-wrap">
          <button
            onClick={handleClearAndReload}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-700 dark:bg-sky-700 dark:hover:bg-sky-600"
          >
            Vider les donnees locales
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md border border-sky-300 dark:border-sky-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-slate-700"
          >
            Recharger
          </button>
          {onLoggedOut && (
            <button
              onClick={handleLogout}
              className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              Se déconnecter
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
