import { useEffect, useMemo, useState } from "react";
import { PREVISIONS, buildPrevisionReleve, type PrevisionSemestre } from "../previsions/previsionRT";
import { usePrevisionSimulation } from "../hooks/usePrevisionSimulation";
import { fmt } from "../simulator";
import { me } from "../api";
import UeTable from "./UeTable";
import ThemeToggle from "./ThemeToggle";

function semestreKeyFromPath(): "s5" | "s6" {
  const path = window.location.pathname;
  return path.startsWith("/preview/s6") ? "s6" : "s5";
}

function PrevisionSection({ semestre }: { semestre: PrevisionSemestre }) {
  const releve = useMemo(() => buildPrevisionReleve(semestre), [semestre]);
  const { overrides, moyenneSimulee, hasSimulation, confirmingReset, handleOverrideChange, handleReset } =
    usePrevisionSimulation(semestre.id, releve);

  const ectsTotal = Object.values(releve.ues).reduce((acc, ue) => acc + (Number(ue.ECTS?.total) || 0), 0);
  const filledCount = Object.keys(overrides).length;
  const totalModules = semestre.ues.reduce((acc, ue) => acc + ue.ressources.length + ue.saes.length, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sky-300/70 dark:border-sky-800/70 bg-sky-50/85 dark:bg-slate-900/65 backdrop-blur-lg ring-1 ring-black/5 dark:ring-white/5 shadow-sm px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-400">
            Moyenne générale simulée · {ectsTotal.toFixed(1)} ECTS
          </p>
          <p className="text-2xl font-bold text-sky-700 dark:text-sky-300">{fmt(moyenneSimulee)}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {filledCount} / {totalModules} note{totalModules > 1 ? "s" : ""} de module saisie{filledCount > 1 ? "s" : ""}
          </p>
        </div>
        {hasSimulation && (
          <button
            onClick={handleReset}
            className={`text-sm rounded-md px-3 py-1.5 border whitespace-nowrap ${
              confirmingReset
                ? "border-rose-400 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300"
                : "border-sky-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800"
            }`}
          >
            {confirmingReset ? "Confirmer la réinitialisation ?" : "Réinitialiser mes notes simulées"}
          </button>
        )}
      </div>

      <div className="space-y-3">
        {semestre.ues.map((ue) => (
          <UeTable
            key={ue.code}
            ueCode={ue.code}
            ue={releve.ues[ue.code]}
            releve={releve}
            overrides={overrides}
            onChange={handleOverrideChange}
            selectedKey={null}
            onSelect={() => {}}
            defaultOpen={false}
          />
        ))}
      </div>
    </div>
  );
}

export default function PreviewApp({ loggedIn }: { loggedIn: boolean }) {
  const [semestreKey, setSemestreKey] = useState<"s5" | "s6">(semestreKeyFromPath);
  const [checkingAuth, setCheckingAuth] = useState(!loggedIn);
  const [actuallyLoggedIn, setActuallyLoggedIn] = useState(loggedIn);

  useEffect(() => {
    const path = window.location.pathname;
    if (path !== "/preview/s5" && path !== "/preview/s6") {
      window.history.replaceState(null, "", `/preview/${semestreKey}`);
    }
  }, [semestreKey]);

  useEffect(() => {
    const onPopState = () => setSemestreKey(semestreKeyFromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Le parent (App) peut ne pas encore avoir résolu son propre appel /api/me au premier rendu
  // (accès direct à /preview par URL) : on vérifie ici indépendamment pour savoir si le bouton
  // de retour doit renvoyer au tableau de bord ou à l'écran de connexion.
  useEffect(() => {
    if (loggedIn) {
      setActuallyLoggedIn(true);
      setCheckingAuth(false);
      return;
    }
    me()
      .then((res) => setActuallyLoggedIn(Boolean(res.authenticated)))
      .catch(() => setActuallyLoggedIn(false))
      .finally(() => setCheckingAuth(false));
  }, [loggedIn]);

  function switchTo(key: "s5" | "s6") {
    setSemestreKey(key);
    window.history.pushState(null, "", `/preview/${key}`);
  }

  return (
    <div className="min-h-screen bg-sky-50 dark:bg-slate-950">
      <header className="sticky top-0 z-20 bg-white/60 dark:bg-slate-900/60 backdrop-blur-2xl border-b border-sky-200/60 dark:border-slate-800/60 shadow-sm px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold text-sky-950 dark:text-sky-100">
            Prévisionnel BUT R&amp;T
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Matières et coefficients indicatifs, non officiels</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div className="flex rounded-md border border-sky-200 dark:border-slate-700 overflow-hidden text-sm">
            {(["s5", "s6"] as const).map((key) => (
              <button
                key={key}
                onClick={() => switchTo(key)}
                className={`px-3 py-1.5 ${
                  semestreKey === key
                    ? "bg-sky-700 text-white dark:bg-sky-600"
                    : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-sky-50 dark:hover:bg-slate-700"
                }`}
              >
                {PREVISIONS[key].label}
              </button>
            ))}
          </div>
          <ThemeToggle />
          <button
            onClick={() => (window.location.href = "/")}
            disabled={checkingAuth}
            className="text-sm rounded-md bg-sky-700 hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-500 text-white px-3 py-1.5 disabled:opacity-50 whitespace-nowrap"
          >
            {actuallyLoggedIn ? "Retour à l'app" : "Se connecter"}
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        <p className="text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3">
          Ces matières et coefficients sont donnés à titre indicatif et n'ont aucune valeur
          officielle tant que ScoDoc n'a pas ouvert ce semestre. Les notes saisies ci-dessous sont
          purement fictives, stockées uniquement sur cet appareil (jamais envoyées à un serveur),
          et servent uniquement à projeter une moyenne.
        </p>
        <PrevisionSection semestre={PREVISIONS[semestreKey]} />
      </main>
    </div>
  );
}
