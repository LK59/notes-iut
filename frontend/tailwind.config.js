/** @type {import('tailwindcss').Config} */

// Les jetons sont définis en variables CSS dans src/index.css (:root et :root.dark)
// et exposés ici sous des noms sémantiques. Un composant s'écrit donc une seule fois
// (`bg-surface text-muted border-line`) au lieu de doubler chaque classe d'un `dark:`,
// ce qui garantit que les deux thèmes restent cohérents.
const token = (name) => ({ opacityValue }) =>
  opacityValue === undefined
    ? `rgb(var(${name}))`
    : `rgb(var(${name}) / ${opacityValue})`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: token("--c-canvas"),
        surface: token("--c-surface"),
        inset: token("--c-inset"),
        line: token("--c-line"),
        "line-strong": token("--c-line-strong"),

        fg: token("--c-fg"),
        muted: token("--c-muted"),
        subtle: token("--c-subtle"),

        accent: token("--c-accent"),
        "accent-hover": token("--c-accent-hover"),
        "accent-fg": token("--c-accent-fg"),
        "accent-soft": token("--c-accent-soft"),

        pos: token("--c-pos"),
        "pos-soft": token("--c-pos-soft"),
        neg: token("--c-neg"),
        "neg-soft": token("--c-neg-soft"),
        warn: token("--c-warn"),
        "warn-soft": token("--c-warn-soft"),
        sim: token("--c-sim"),
        "sim-soft": token("--c-sim-soft"),
      },
      fontFamily: {
        sans: [
          "Geist",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["Geist Mono", "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      borderRadius: {
        lg: "0.625rem",
        xl: "0.875rem",
      },
      boxShadow: {
        // Une seule ombre dans toute l'app, réservée aux éléments qui flottent
        // réellement au-dessus du contenu (en-tête collant, popovers, modales).
        pop: "0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -6px rgb(0 0 0 / 0.12)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(-4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 140ms ease-out",
      },
    },
  },
  plugins: [],
};
