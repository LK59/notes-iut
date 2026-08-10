import { useEffect, useRef, useState } from "react";

/** Export PDF : on force tout en ouvert et en thème clair pour le rendu imprimé (les classes
 * dark: de Tailwind dépendent de la classe .dark sur <html>, pas du media query print), puis
 * on imprime — la boîte de dialogue "Enregistrer en PDF" du navigateur fait le reste. La
 * restauration du thème se fait sur "afterprint" plutôt que juste après print() : sur Chrome,
 * print() rend la prévisualisation de façon asynchrone, donc restaurer trop tôt la ferait dark. */
export function usePrintExport() {
  const [printMode, setPrintMode] = useState(false);
  const wasDarkRef = useRef(false);

  useEffect(() => {
    if (!printMode) return;
    wasDarkRef.current = document.documentElement.classList.contains("dark");
    document.documentElement.classList.remove("dark");
    const id = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(id);
  }, [printMode]);

  useEffect(() => {
    const handleAfterPrint = () => {
      if (wasDarkRef.current) document.documentElement.classList.add("dark");
      setPrintMode(false);
    };
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  return { printMode, setPrintMode };
}
