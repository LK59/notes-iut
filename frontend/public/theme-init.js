/*
 * Applique le thème AVANT la première peinture.
 *
 * Ce code était auparavant inline dans index.html, où la CSP du backend
 * (`script-src 'self'`) le bloquait silencieusement : il n'a jamais tourné en
 * production, et le thème sombre s'installait donc après un flash clair. Servi
 * comme fichier séparé, il est autorisé — et reste bloquant dans <head>, donc
 * toujours exécuté avant le rendu.
 */
(function () {
  var dark;
  try {
    var stored = localStorage.getItem("notes-iut-theme");
    dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (e) {
    dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  if (dark) {
    document.documentElement.classList.add("dark");
    document.documentElement.style.background = "#0d0e11";
  } else {
    document.documentElement.style.background = "#fbfbfa";
  }
})();
