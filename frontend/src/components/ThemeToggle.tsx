import { useTheme } from "../theme";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label="Changer de thème"
      className="rounded-md border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-sm text-sky-700 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-slate-700"
    >
      {theme === "dark" ? "☀️ Clair" : "🌙 Sombre"}
    </button>
  );
}
