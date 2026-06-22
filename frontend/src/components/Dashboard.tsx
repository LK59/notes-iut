import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { getReleve, getSemestres, logout } from "../api";
import { cacheGet } from "../offlineCache";
import type { AbsencesByDate, PremiereConnexionResponse, Releve, ReleveResponse, Semestre } from "../types";
import { moyenneGenerale, newlyPublishedIds, numericNoteValue, pendingItems, ueMoyenne } from "../simulator";
import type { SemestrePoint } from "./EvolutionChart";
import UeTable from "./UeTable";
import SemestreSummary from "./SemestreSummary";
import PendingNotes from "./PendingNotes";
import ObjectiveCalculator from "./ObjectiveCalculator";
import AbsencesPanel from "./AbsencesPanel";
import BonusMalusPanel from "./BonusMalusPanel";
import SectionNav from "./SectionNav";
import ThemeToggle from "./ThemeToggle";
import { useOnline } from "../useOnline";

// Recharts pèse lourd dans le bundle : on ne le charge qu'une fois le dashboard affiché,
// pas dès le chargement de la page de login.
const RadarUE = lazy(() => import("./RadarUE"));
const EvolutionChart = lazy(() => import("./EvolutionChart"));

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

export default function Dashboard({ username, onLoggedOut }: { username: string; onLoggedOut: () => void }) {
  const [bootstrap, setBootstrap] = useState<PremiereConnexionResponse | null>(null);
  const [semestreId, setSemestreId] = useState<string | null>(null);
  const [releve, setReleve] = useState<Releve | null>(null);
  const [absences, setAbsences] = useState<AbsencesByDate | undefined>(undefined);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [evolution, setEvolution] = useState<SemestrePoint[]>([]);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [printMode, setPrintMode] = useState(false);
  const online = useOnline();

  useEffect(() => {
    getSemestres()
      .then((data) => {
        setBootstrap(data);
        const initial = data.semestres[data.semestres.length - 1]?.formsemestre_id ?? null;
        setSemestreId(initial);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!semestreId) return;
    let cancelled = false;
    setOverrides(loadSimulation(semestreId));
    setSelectedKey(null);
    // On lit le cache local AVANT le fetch (qui l'écrasera) pour détecter les notes
    // apparues depuis la dernière visite sur ce semestre.
    const previous = cacheGet<ReleveResponse>(`releve:${semestreId}`);
    getReleve(semestreId)
      .then((data) => {
        if (cancelled) return;
        setReleve(data.relevé);
        setAbsences(data.absences);
        setNewIds(newlyPublishedIds(previous?.relevé ?? null, data.relevé));
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
          return { titre: semestreLabel(s), moyenne: numericNoteValue(data.relevé.semestre?.notes?.value) };
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
    try {
      const previous = cacheGet<ReleveResponse>(`releve:${semestreId}`);
      const data = await getReleve(semestreId, true);
      setReleve(data.relevé);
      setAbsences(data.absences);
      setNewIds(newlyPublishedIds(previous?.relevé ?? null, data.relevé));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors du rechargement");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleReset() {
    if (!semestreId) return;
    setOverrides({});
    setSelectedKey(null);
    setResetting(true);
    try {
      const data = await getReleve(semestreId, true);
      setReleve(data.relevé);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors du rechargement");
    } finally {
      setResetting(false);
    }
  }

  if (loading) return <Centered>Chargement de tes relevés…</Centered>;
  if (error) return <Centered className="text-red-600 dark:text-red-400">{error}</Centered>;
  if (!bootstrap || !releve) return null;

  const ueEntries = Object.entries(releve.ues).filter(([, ue]) => ue.type !== 1);
  const currentSemestre = bootstrap.semestres.find((s) => s.formsemestre_id === semestreId);

  return (
    <div className="min-h-screen bg-sky-50 dark:bg-slate-950 overflow-x-hidden">
      <header className="print:hidden bg-white dark:bg-slate-900 border-b border-sky-200 dark:border-slate-800 px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
          {semestreId && (
            <a
              href={`/api/bulletin-pdf/${semestreId}?type=BUT`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/40 px-3 py-1.5 text-sm text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              Bulletin PDF (officiel)
            </a>
          )}
          <button
            onClick={() => setPrintMode(true)}
            className="rounded-md border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            Exporter en PDF (simulation)
          </button>
          <ThemeToggle />
          <button
            onClick={() => logout().then(onLoggedOut)}
            className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 whitespace-nowrap"
          >
            Déconnexion
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="hidden print:block mb-2">
          <h1 className="text-lg font-semibold text-slate-900">Notes IUT Annecy — {username}</h1>
          <p className="text-sm text-slate-600">
            {currentSemestre ? semestreLabel(currentSemestre) : ""} · généré le {new Date().toLocaleDateString("fr-FR")}
            {hasSimulation ? " · contient des notes simulées" : ""}
          </p>
        </div>

        <SectionNav />

        {!online && (
          <div className="print:hidden bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm rounded-lg p-3">
            Mode hors-ligne : affichage des dernières données enregistrées sur cet appareil, possiblement obsolètes.
          </div>
        )}

        {releve.message && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm rounded-lg p-3">
            {releve.message}
          </div>
        )}

        <div id="resume">
          <SemestreSummary releve={releve} absences={absences} />
        </div>

        <div id="absences" className="print:hidden">
          <AbsencesPanel absences={absences} />
        </div>

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
            <button
              onClick={handleReset}
              disabled={resetting}
              className="print:hidden rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap self-start sm:self-auto"
            >
              {resetting ? "Réinitialisation…" : "Réinitialiser (revenir à la vérité)"}
            </button>
          </div>
        )}

        <div id="objectif" className="print:hidden">
          <ObjectiveCalculator releve={releve} overrides={overrides} onApply={handleApplyMany} />
        </div>

        <div id="graphiques" className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <Suspense fallback={<ChartFallback />}>
            <RadarUE ues={releve.ues} moyennes={ueMoyennes} />
          </Suspense>
          <Suspense fallback={<ChartFallback />}>
            <EvolutionChart points={evolution} />
          </Suspense>
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
      </main>
    </div>
  );
}

function ChartFallback() {
  return (
    <div className="bg-white dark:bg-slate-900 border border-sky-200 dark:border-slate-800 rounded-xl shadow-sm p-4 h-[300px] flex flex-col gap-2 animate-pulse">
      <div className="h-3 w-1/3 rounded bg-sky-100 dark:bg-slate-700" />
      <div className="flex-1 rounded bg-sky-50 dark:bg-slate-800" />
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
