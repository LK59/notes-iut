export type ChipColor = "neutral" | "accent" | "sim" | "pos" | "neg";

/**
 * Métadonnée courte (coef, rang, poids, ECTS).
 *
 * Volontairement discrète : la version précédente empilait des pastilles de six
 * couleurs différentes sous chaque UE, ce qui mettait des informations secondaires
 * au même niveau visuel que la note elle-même. Ici tout est neutre par défaut, et
 * la couleur est réservée aux deux cas qui portent réellement un sens (valeur
 * simulée, bonus/malus).
 */
const COLOR_MAP: Record<ChipColor, string> = {
  neutral: "bg-inset text-muted",
  accent: "bg-accent-soft text-accent",
  sim: "bg-sim-soft text-sim",
  pos: "bg-pos-soft text-pos",
  neg: "bg-neg-soft text-neg",
};

export default function Chip({
  color = "neutral",
  title,
  children,
}: {
  color?: ChipColor;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-md px-1.5 py-[3px] text-[11px] font-medium leading-none whitespace-nowrap ${COLOR_MAP[color]}`}
    >
      {children}
    </span>
  );
}
