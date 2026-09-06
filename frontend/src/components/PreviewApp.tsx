import { useEffect, useMemo, useState } from "react";
import { PREVISIONS, buildPrevisionReleve, type PrevisionSemestre } from "../previsions/previsionRT";
import { usePrevisionSimulation } from "../hooks/usePrevisionSimulation";
import { fmt } from "../simulator";
import { me } from "../api";
import UeTable from "./UeTable";
import ThemeToggle from "./ThemeToggle";
import { Button, Card, Notice } from "./ui";

function semestreKeyFromPath(): "s5" | "s6" {
  return window.location.pathname.startsWith("/preview/s6") ? "s6" : "s5";
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
      <Card className="flex flex-wrap items-end justify-between gap-4 px-4 py-3.5">
        <div>
          <p className="text-xs text-muted">Moyenne générale projetée</p>
          <p className="flex items-baseline gap-2">
            <span className="mono text-[2.25rem] leading-none font-medium tracking-tight text-fg">
              {fmt(moyenneSimulee)}
            </span>
            <span className="text-sm text-subtle">/ 20</span>
          </p>
          <p className="mt-1 mono text-xs text-subtle">
            {filledCount}/{totalModules} matières saisies · {ectsTotal.toFixed(0)} ECTS
          </p>
        </div>
        {hasSimulation && (
          <Button tone={confirmingReset ? "danger" : "neutral"} onClick={handleReset}>
            {confirmingReset ? "Confirmer ?" : "Effacer mes notes"}
          </Button>
        )}
      </Card>

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
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-2.5 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg leading-tight">Prévisionnel BUT R&amp;T</p>
              <p className="text-xs text-muted leading-tight">Matières et coefficients indicatifs</p>
            </div>
            <ThemeToggle />
            <Button
              tone="primary"
              onClick={() => (window.location.href = "/")}
              disabled={checkingAuth}
            >
              {actuallyLoggedIn ? "Mes notes" : "Se connecter"}
            </Button>
          </div>

          <div
            role="tablist"
            aria-label="Semestre"
            className="relative grid grid-cols-2 w-full sm:w-64 rounded-lg bg-inset p-1 text-sm"
          >
            <span
              aria-hidden="true"
              className="absolute top-1 bottom-1 left-1 rounded-md bg-surface border border-line shadow-sm transition-transform duration-200 ease-out"
              style={{
                width: "calc((100% - 0.5rem) / 2)",
                transform: `translateX(${semestreKey === "s6" ? 100 : 0}%)`,
              }}
            />
            {(["s5", "s6"] as const).map((key) => (
              <button
                key={key}
                role="tab"
                aria-selected={semestreKey === key}
                onClick={() => switchTo(key)}
                className={`relative z-10 rounded-md py-1.5 text-center font-medium transition-colors ${
                  semestreKey === key ? "text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {PREVISIONS[key].label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-4 space-y-4">
        <Notice tone="warn">
          Ces matières et coefficients sont indicatifs et n'ont aucune valeur officielle tant que
          ScoDoc n'a pas ouvert le semestre. Les notes que tu saisis sont fictives, restent sur cet
          appareil et ne servent qu'à projeter une moyenne.
        </Notice>
        <PrevisionSection semestre={PREVISIONS[semestreKey]} />
      </main>
    </div>
  );
}
