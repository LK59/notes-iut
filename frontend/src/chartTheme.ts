import { useMemo } from "react";
import { useDarkMode } from "./theme";

/**
 * Palette unique de tous les graphiques (recharts et SVG maison).
 *
 * Elle existe parce que la version précédente câblait les couleurs claires en dur
 * dans PromoHistogram : grille et graduations restaient bleu clair sur fond sombre,
 * donc illisibles. Un seul endroit à corriger, et les deux thèmes ne peuvent plus
 * diverger d'un graphique à l'autre.
 *
 * Recharts ne lit pas les variables CSS (il sérialise les couleurs dans des attributs
 * SVG), d'où des valeurs littérales ici — tenues alignées à la main sur index.css.
 */
export interface ChartTheme {
  dark: boolean;
  grid: string;
  axis: string;
  axisStrong: string;
  primary: string;
  primarySoft: string;
  compare: string;
  neutral: string;
  positive: string;
  negative: string;
  simulated: string;
  tooltip: React.CSSProperties;
}

export function useChartTheme(): ChartTheme {
  const dark = useDarkMode();
  return useMemo<ChartTheme>(
    () => ({
      dark,
      grid: dark ? "#262a30" : "#e6e6e2",
      axis: dark ? "#6b7280" : "#8b8f98",
      axisStrong: dark ? "#9aa1ad" : "#5c6069",
      primary: dark ? "#a5b4fc" : "#4338ca",
      primarySoft: dark ? "#312e81" : "#e0e3ff",
      compare: dark ? "#67e8f9" : "#0e7490",
      neutral: dark ? "#4b5563" : "#c9cad0",
      positive: dark ? "#5fd3a0" : "#0d7a54",
      negative: dark ? "#ff8a94" : "#c12c3c",
      simulated: dark ? "#f5af60" : "#9a4a06",
      tooltip: {
        background: dark ? "#15171b" : "#ffffff",
        border: `1px solid ${dark ? "#363b43" : "#d1d1cb"}`,
        borderRadius: "10px",
        color: dark ? "#eceef2" : "#16181c",
        fontSize: 12,
        boxShadow: "0 8px 24px -6px rgb(0 0 0 / 0.18)",
        padding: "6px 10px",
      },
    }),
    [dark]
  );
}
