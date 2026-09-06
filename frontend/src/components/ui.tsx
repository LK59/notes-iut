import { useId, useState, type ReactNode } from "react";

/* ──────────────────────────────────────────────────────────────────────────
   Primitives partagées.

   Six panneaux repliables réimplémentaient auparavant le même en-tête, le même
   chevron et la même bordure avec des valeurs légèrement différentes à chaque
   fois. Tout passe désormais par Panel, ce qui garantit des alignements et des
   états ouverts/fermés identiques d'un bloc à l'autre.
   ────────────────────────────────────────────────────────────────────────── */

export function Chevron({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""} ${className}`}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.084l3.71-3.855a.75.75 0 1 1 1.08 1.04l-4.25 4.42a.75.75 0 0 1-1.08 0l-4.25-4.42a.75.75 0 0 1 .02-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Conteneur de section. Bordure fine, pas d'ombre : seuls les éléments qui flottent
 * réellement au-dessus du contenu (en-tête, popovers) en portent une. */
export function Card({
  children,
  className = "",
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "simulated";
}) {
  return (
    <div
      className={`rounded-xl border bg-surface ${
        tone === "simulated" ? "border-sim/50" : "border-line"
      } ${className}`}
    >
      {children}
    </div>
  );
}

interface PanelProps {
  title: ReactNode;
  /** Chiffre ou libellé court aligné à droite du titre (compteur, moyenne…). */
  aside?: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  /** Force l'ouverture sans interaction (mode impression). */
  forceOpen?: boolean;
  id?: string;
  children: ReactNode;
}

export function Panel({
  title,
  aside,
  subtitle,
  defaultOpen = false,
  forceOpen = false,
  id,
  children,
}: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = forceOpen || open;
  const contentId = useId();

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={isOpen}
        aria-controls={contentId}
        id={id}
        className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left rounded-xl hover:bg-inset transition-colors"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-fg">{title}</span>
          {subtitle && <span className="mt-0.5 block text-xs text-muted">{subtitle}</span>}
        </span>
        <span className="flex items-center gap-2 shrink-0 pt-0.5">
          {aside}
          <Chevron open={isOpen} className="text-subtle" />
        </span>
      </button>
      <Collapsible open={isOpen} id={contentId}>
        <div className="border-t border-line">{children}</div>
      </Collapsible>
    </Card>
  );
}

export function Collapsible({
  open,
  id,
  children,
}: {
  open: boolean;
  id?: string;
  children: ReactNode;
}) {
  // Transition sur grid-template-rows (0fr → 1fr) plutôt que sur une hauteur maximale
  // arbitraire : celle-ci devait être devinée à l'avance, et tronquait silencieusement
  // le contenu des UE les plus fournies une fois le seuil dépassé.
  return (
    <div
      id={id}
      aria-hidden={!open}
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/* ── Messages ─────────────────────────────────────────────────────────────── */

export function Notice({
  tone = "info",
  children,
  action,
}: {
  tone?: "info" | "warn" | "error" | "good";
  children: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    info: "bg-inset border-line text-muted",
    warn: "bg-warn-soft border-warn/30 text-warn",
    error: "bg-neg-soft border-neg/30 text-neg",
    good: "bg-pos-soft border-pos/30 text-pos",
  } as const;

  return (
    <div
      className={`flex items-center justify-between gap-3 flex-wrap rounded-lg border px-3.5 py-2.5 text-sm ${tones[tone]}`}
    >
      <span className="min-w-0">{children}</span>
      {action}
    </div>
  );
}

/* ── Boutons ──────────────────────────────────────────────────────────────── */

const BUTTON_TONES = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover border-transparent",
  neutral: "bg-surface text-fg border-line-strong hover:bg-inset",
  quiet: "bg-transparent text-muted border-transparent hover:bg-inset hover:text-fg",
  danger: "bg-neg text-white border-transparent hover:opacity-90",
} as const;

export function Button({
  tone = "neutral",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof BUTTON_TONES }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap ${BUTTON_TONES[tone]} ${className}`}
    />
  );
}

/* ── Saisie de note ───────────────────────────────────────────────────────── */

/**
 * Champ de note 0-20. `inputMode="decimal"` ouvre le pavé numérique sur mobile.
 *
 * `simulated` est distinct de « le champ a une valeur » : une note réelle s'affiche
 * comme une valeur normale, seule une note inventée prend la couleur dédiée aux
 * valeurs simulées. Afficher la note réelle en simple texte indicatif la faisait
 * passer pour un champ vide.
 */
export function NoteInput({
  value,
  onChange,
  simulated = false,
  placeholder = "—",
  ariaLabel,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  simulated?: boolean;
  placeholder?: string;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="0.01"
      min={0}
      max={20}
      aria-label={ariaLabel}
      value={value ?? ""}
      placeholder={placeholder}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        const raw = event.target.value;
        onChange(raw === "" ? undefined : Number(raw));
      }}
      className={`print:hidden w-[5.25rem] shrink-0 rounded-lg border px-2 py-1 text-sm text-right mono transition-colors ${
        simulated
          ? "border-sim/60 bg-sim-soft text-sim font-medium"
          : "border-line-strong bg-surface text-fg placeholder:text-subtle"
      }`}
    />
  );
}

/* ── Valeur numérique ─────────────────────────────────────────────────────── */

/** Note affichée. `state` encode la position par rapport à la moyenne de classe :
 * la couleur porte une information, elle n'est pas décorative. */
export function Grade({
  value,
  state = "neutral",
  size = "md",
  simulated = false,
}: {
  value: string;
  state?: "neutral" | "above" | "below";
  size?: "sm" | "md" | "lg" | "xl";
  simulated?: boolean;
}) {
  const sizes = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-xl",
    xl: "text-[2.5rem] leading-none tracking-tight",
  } as const;
  const states = {
    neutral: "text-fg",
    above: "text-pos",
    below: "text-neg",
  } as const;

  return (
    <span
      className={`mono font-medium ${sizes[size]} ${simulated ? "text-sim" : states[state]}`}
    >
      {value}
    </span>
  );
}

/** La couleur d'une note encode sa position vis-à-vis de la moyenne de classe — donc
 * une information, pas une décoration. Neutre quand la comparaison est impossible. */
export function comparedToClass(
  value: number | null | undefined,
  classAverage: number | null | undefined
): "neutral" | "above" | "below" {
  if (value === null || value === undefined || classAverage === null || classAverage === undefined) {
    return "neutral";
  }
  if (Math.abs(value - classAverage) < 0.005) return "neutral";
  return value > classAverage ? "above" : "below";
}
