import { useEffect, useState } from "react";

export default function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Remonter en haut de la page"
      title="Remonter en haut"
      className="print:hidden fixed bottom-5 right-5 z-30 h-10 w-10 rounded-full bg-sky-600 text-white shadow-lg hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400 flex items-center justify-center transition-opacity"
    >
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M14.77 12.79a.75.75 0 0 1-1.06-.02L10 8.832l-3.71 3.938a.75.75 0 1 1-1.08-1.04l4.25-4.5a.75.75 0 0 1 1.08 0l4.25 4.5a.75.75 0 0 1-.02 1.06Z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}
