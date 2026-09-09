/**
 * Banc d'essai visuel — DÉVELOPPEMENT UNIQUEMENT.
 *
 * Rend les vues authentifiées (celles qui composent le tableau de bord) avec un relevé
 * entièrement inventé, pour pouvoir regarder et retoucher le design sans identifiants CAS
 * et sans jamais afficher de données réelles.
 *
 * Servi par `vite dev` sur /harness.html ; absent du bundle de production, où Vite ne
 * construit que index.html. Voir dev/README.md.
 *
 *   ?theme=dark      force le thème sombre
 *   ?bloc=<nom>      n'affiche qu'un bloc (utile pour une capture ciblée)
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import AbsencesPanel from "../src/components/AbsencesPanel";
import MatieresRecap from "../src/components/MatieresRecap";
import PendingNotes from "../src/components/PendingNotes";
import SemestreSummary from "../src/components/SemestreSummary";
import SimpleView from "../src/components/SimpleView";
import UeTable from "../src/components/UeTable";
import { Card } from "../src/components/ui";
import { pendingItems } from "../src/simulator";
import { absencesFictives, releveFictif } from "./fixture";
import "../src/index.css";

const params = new URLSearchParams(location.search);
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");
const blocDemande = params.get("bloc");

function Bloc({ nom, titre, children }: { nom: string; titre: string; children: React.ReactNode }) {
  if (blocDemande && blocDemande !== nom) return null;
  return (
    <section className="space-y-3">
      <h2 className="mono text-[11px] uppercase tracking-wider text-subtle">{titre}</h2>
      {children}
    </section>
  );
}

function Harness() {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const onChange = (key: string, value: number | undefined) =>
    setOverrides((prev) => {
      const suivant = { ...prev };
      if (value === undefined) delete suivant[key];
      else suivant[key] = value;
      return suivant;
    });

  const ueEntries = Object.entries(releveFictif.ues).filter(([, ue]) => ue.type !== 1);

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-6">
        <p className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-warn">
          Banc d'essai — données inventées, développement uniquement.
        </p>

        <Bloc nom="resume" titre="SemestreSummary">
          <SemestreSummary releve={releveFictif} trend={0.42} />
        </Bloc>

        <Bloc nom="simple" titre="SimpleView">
          <SimpleView
            releve={releveFictif}
            overrides={overrides}
            newIds={new Set([1])}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
        </Bloc>

        <Bloc nom="attente" titre="PendingNotes">
          <PendingNotes items={pendingItems(releveFictif)} overrides={overrides} onChange={onChange} />
        </Bloc>

        <Bloc nom="matieres" titre="MatieresRecap">
          <MatieresRecap releve={releveFictif} overrides={overrides} />
        </Bloc>

        <Bloc nom="ue" titre="UeTable">
          <div className="grid grid-cols-1 lg:grid-cols-2 items-start gap-4">
            {ueEntries.map(([code, ue], i) => (
              <UeTable
                key={code}
                ueCode={code}
                ue={ue}
                releve={releveFictif}
                overrides={overrides}
                onChange={onChange}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                defaultOpen={i === 0}
                newIds={new Set([1])}
              />
            ))}
          </div>
        </Bloc>

        <Bloc nom="absences" titre="AbsencesPanel">
          <AbsencesPanel absences={absencesFictives} officialAbsences={releveFictif.semestre.absences} />
        </Bloc>

        <Bloc nom="simulee" titre="Bandeau de simulation">
          <Card tone="simulated" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-xs text-sim">Moyenne générale simulée</p>
              <p className="mono text-2xl font-medium leading-tight text-sim">
                13.94<span className="text-sm text-muted"> / 20</span>
              </p>
            </div>
          </Card>
        </Bloc>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>
);
