import { Suspense, lazy, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  clearServerCache,
  logout,
  reconnectNow,
  setCacheFallbackHandler,
  type CacheFallbackReason,
  type ReauthWarning,
} from "../api";
import { clearDataCache } from "../offlineCache";
import { semestreLabel } from "../semestreLabel";
import UeTable from "./UeTable";
import SemestreSummary from "./SemestreSummary";
import PendingNotes from "./PendingNotes";
import ObjectiveCalculator from "./ObjectiveCalculator";
import AbsencesPanel from "./AbsencesPanel";
import BonusMalusPanel from "./BonusMalusPanel";
import SectionNav from "./SectionNav";
import SettingsMenu from "./SettingsMenu";
import ScrollToTop from "./ScrollToTop";
import PrintExport from "./PrintExport";
import ExportMenu from "./ExportMenu";
import SimpleView from "./SimpleView";
import ViewToggle from "./ViewToggle";
import MatieresRecap from "./MatieresRecap";
import { useViewMode } from "../viewMode";
import { useOnline } from "../useOnline";
import GradeHistoryPanel from "./GradeHistoryPanel";
import { APP_VERSION, BUILD_ID } from "../version";
import { useReleveData } from "../hooks/useReleveData";
import { useSimulation } from "../hooks/useSimulation";
import { usePrintExport } from "../hooks/usePrintExport";
// Ces composants ne s'ouvrent que sur clic — on les charge à la demande.
const GraphiquesView = lazy(() => import("./GraphiquesView"));
const SessionsPanel = lazy(() => import("./SessionsPanel"));
const AdminPanel = lazy(() => import("./AdminPanel"));

export default function Dashboard({
  username,
  isAdmin,
  reauthWarning,
  onReconnected,
  onLoggedOut,
}: {
  username: string;
  isAdmin?: boolean;
  reauthWarning?: ReauthWarning;
  onReconnected?: () => void;
  onLoggedOut: () => void;
}) {
  const queryClient = useQueryClient();
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [cacheFallback, setCacheFallback] = useState<CacheFallbackReason | null>(null);
  const online = useOnline();
  const { view, setView } = useViewMode();

  useEffect(() => {
    setCacheFallbackHandler(setCacheFallback);
    return () => setCacheFallbackHandler(null);
  }, []);

  async function handleReconnect() {
    setReconnecting(true);
    try {
      await reconnectNow();
      onReconnected?.();
    } catch {
      // La session courante reste valide (4h) même si le renouvellement échoue : pas
      // besoin de bloquer l'utilisateur, il pourra retenter plus tard ou se reconnecter
      // normalement quand sa session expirera.
    } finally {
      setReconnecting(false);
    }
  }

  const {
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
  } = useReleveData(view);

  const {
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
  } = useSimulation(semestreId, releve, fetchAndCacheCurrent, setRefreshError);

  const { printMode, setPrintMode } = usePrintExport();

  if (isLoading) return <Centered>Chargement de tes relevés…</Centered>;
  if (bootstrapError) return <DashboardError message={(bootstrapError as Error).message} onLoggedOut={onLoggedOut} />;
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
            onClick={refreshCurrent}
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
          <SettingsMenu />
          <button
            onClick={() => (window.location.href = "/preview/s5")}
            className="text-sm text-sky-700 dark:text-sky-300 hover:text-sky-900 dark:hover:text-sky-100 whitespace-nowrap"
          >
            Prévisions S5/S6
          </button>
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
            onClick={() => logout().catch(() => {}).finally(() => { queryClient.clear(); onLoggedOut(); })}
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

        {(!online || cacheFallback === "offline") && (
          <div className="print:hidden bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm rounded-lg p-3">
            Mode hors-ligne : affichage des dernières données enregistrées sur cet appareil, possiblement obsolètes.
          </div>
        )}

        {online && cacheFallback === "scodoc_down" && (
          <div className="print:hidden bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm rounded-lg p-3">
            Le portail de notes de l'IUT est indisponible pour le moment : affichage des dernières données connues.
          </div>
        )}

        {reauthWarning && (
          <div className="print:hidden flex items-center justify-between gap-3 flex-wrap bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm rounded-lg p-3">
            <span>
              {reauthWarning === "idle"
                ? "Tu n'as pas ouvert l'app depuis un moment : ta connexion va bientôt expirer."
                : "Ta connexion arrive à expiration : reconnecte-toi pour continuer à recevoir tes notes."}
            </span>
            <button
              onClick={handleReconnect}
              disabled={reconnecting}
              className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {reconnecting ? "Reconnexion…" : "Se reconnecter"}
            </button>
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
      <Suspense fallback={null}>
        {sessionsOpen && <SessionsPanel onClose={() => setSessionsOpen(false)} />}
        {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
      </Suspense>
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
  const queryClient = useQueryClient();
  function handleClearAndReload() {
    queryClient.clear();
    clearDataCache();
    clearServerCache().catch(() => {}).finally(() => window.location.reload());
  }
  function handleLogout() {
    queryClient.clear();
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
