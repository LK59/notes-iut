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
import { semestreLabel, semestreLabelShort } from "../semestreLabel";
import UeTable from "./UeTable";
import SemestreSummary from "./SemestreSummary";
import PendingNotes from "./PendingNotes";
import ObjectiveCalculator from "./ObjectiveCalculator";
import AbsencesPanel from "./AbsencesPanel";
import BonusMalusPanel from "./BonusMalusPanel";
import SectionNav, { SECTION_LABEL } from "./SectionNav";
import AppMenu from "./AppMenu";
import ScrollToTop from "./ScrollToTop";
import PrintExport from "./PrintExport";
import SimpleView from "./SimpleView";
import ViewToggle from "./ViewToggle";
import MatieresRecap from "./MatieresRecap";
import { Button, Card, Notice } from "./ui";
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

  function handleLogout() {
    logout()
      .catch(() => {})
      .finally(() => {
        queryClient.clear();
        onLoggedOut();
      });
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
    <div className="min-h-screen bg-canvas">
      {/* ── En-tête : deux rangées, une seule zone d'actions ────────────────── */}
      <header className="print:hidden sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <img
              src="/api/photo"
              alt=""
              className="h-8 w-8 shrink-0 rounded-full object-cover bg-inset"
              onError={(event) => {
                event.currentTarget.style.visibility = "hidden";
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg leading-tight truncate">Notes IUT</p>
              <p className="text-xs text-muted leading-tight truncate">{username}</p>
            </div>

            {newIds.size > 0 && (
              <button
                onClick={() =>
                  document
                    .getElementById(view === "complet" ? "detail-ue" : "matieres-simple")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="shrink-0 rounded-full bg-pos-soft px-2.5 py-1 text-xs font-medium text-pos hover:opacity-80"
              >
                {newIds.size} nouvelle{newIds.size > 1 ? "s" : ""}
              </button>
            )}

            <button
              onClick={refreshCurrent}
              disabled={refreshing}
              aria-label="Actualiser les données"
              title="Actualiser"
              className="shrink-0 rounded-lg border border-line-strong bg-surface p-2 text-fg hover:bg-inset transition-colors disabled:opacity-50"
            >
              <svg
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            <AppMenu
              semestreId={semestreId}
              isAdmin={isAdmin}
              onExportSimulation={() => setPrintMode(true)}
              onOpenSessions={() => setSessionsOpen(true)}
              onOpenAdmin={() => setAdminOpen(true)}
              onLogout={handleLogout}
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={semestreId ?? ""}
              onChange={(event) => setSemestreId(event.target.value)}
              aria-label="Semestre"
              className="shrink-0 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm font-medium text-fg mono"
            >
              {bootstrap.semestres.map((semestre) => (
                <option key={semestre.formsemestre_id} value={semestre.formsemestre_id}>
                  {semestreLabelShort(semestre)}
                </option>
              ))}
            </select>
            <ViewToggle view={view} onChange={setView} />
          </div>
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

      <main className="print:hidden max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 overflow-x-hidden">
        {view === "complet" && <SectionNav />}

        {(!online || cacheFallback === "offline") && (
          <Notice>Hors ligne — dernières données enregistrées sur cet appareil, possiblement dépassées.</Notice>
        )}

        {online && cacheFallback === "scodoc_down" && (
          <Notice tone="warn">
            Le portail de l'IUT ne répond pas — affichage des dernières données connues.
          </Notice>
        )}

        {reauthWarning && (
          <Notice
            tone="warn"
            action={
              <Button tone="primary" onClick={handleReconnect} disabled={reconnecting}>
                {reconnecting ? "Reconnexion…" : "Se reconnecter"}
              </Button>
            }
          >
            {reauthWarning === "idle"
              ? "Tu n'as pas ouvert l'app depuis un moment : ta connexion va bientôt expirer."
              : "Ta connexion arrive à expiration. Reconnecte-toi pour continuer à recevoir tes notes."}
          </Notice>
        )}

        {refreshError && (
          <Notice
            tone="error"
            action={
              <button
                onClick={() => setRefreshError(null)}
                aria-label="Masquer le message"
                className="shrink-0 px-1 opacity-60 hover:opacity-100"
              >
                ✕
              </button>
            }
          >
            {refreshError}
          </Notice>
        )}

        {releve.message && <Notice tone="warn">{releve.message}</Notice>}

        <GradeHistoryPanel items={gradeHistory} />

        <div id="resume" className="scroll-mt-32">
          <SemestreSummary releve={releve} trend={trend} />
        </div>

        {hasSimulation && (
          <Card tone="simulated" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-xs text-sim">Moyenne générale simulée</p>
              <p className="mono text-2xl font-medium text-sim leading-tight">
                {moyenneSimulee !== null ? moyenneSimulee.toFixed(2) : "—"}
                <span className="text-sm text-muted"> / 20</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {confirmingReset && (
                <Button onClick={() => setConfirmingReset(false)}>Annuler</Button>
              )}
              <Button
                tone={confirmingReset ? "danger" : "neutral"}
                onClick={handleReset}
                disabled={resetting}
              >
                {resetting ? "Réinitialisation…" : confirmingReset ? "Confirmer ?" : "Effacer mes simulations"}
              </Button>
            </div>
          </Card>
        )}

        {view === "simple" && (
          <div id="matieres-simple" className="scroll-mt-32">
            <SimpleView
              releve={releve}
              overrides={overrides}
              newIds={newIds}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
            />
          </div>
        )}

        {view === "complet" && (
          <>
            <div id="notes-non-publiees" className="scroll-mt-32">
              <PendingNotes items={pending} overrides={overrides} onChange={handleOverrideChange} />
            </div>

            <div id="objectif" className="scroll-mt-32">
              <ObjectiveCalculator releve={releve} overrides={overrides} onApply={handleApplyMany} />
            </div>

            <div id="par-matiere" className="scroll-mt-32">
              <MatieresRecap releve={releve} overrides={overrides} />
            </div>

            <section id="detail-ue" className="scroll-mt-32">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-fg">{SECTION_LABEL["detail-ue"]}</h2>
                <p className="text-xs text-muted">
                  Déplie une UE, puis un module, pour voir chaque évaluation et sa place dans la promo.
                </p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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
            </section>

            <BonusMalusPanel releve={releve} />

            <div id="absences" className="scroll-mt-32">
              <AbsencesPanel absences={absences} officialAbsences={releve.semestre.absences} />
            </div>
          </>
        )}

        {view === "graphiques" && (
          <Suspense fallback={<div className="h-[300px] rounded-xl bg-inset animate-pulse" />}>
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

      <footer className="print:hidden border-t border-line px-4 sm:px-6 py-4 text-center">
        <p className="text-xs text-subtle">
          Notes IUT Annecy — simulateur non officiel · v{APP_VERSION} · <span className="mono">{BUILD_ID}</span>
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

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas text-muted px-4 text-center text-sm">
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
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
      <Card className="max-w-sm w-full p-6 text-center space-y-4">
        <p className="text-sm text-neg">{message}</p>
        <div className="flex flex-col gap-2">
          <Button tone="primary" onClick={handleClearAndReload}>
            Vider les données locales
          </Button>
          <Button onClick={() => window.location.reload()}>Recharger</Button>
          {onLoggedOut && (
            <Button tone="quiet" onClick={handleLogout}>
              Se déconnecter
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
