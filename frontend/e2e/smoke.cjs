/*
 * Test de fumée : défilement, mise en page et erreurs console, dans un vrai navigateur.
 *
 * Couvre les pages accessibles sans authentification (connexion, prévisions), donc
 * la majeure partie du système de composants : cartes, repli, champs de note, thèmes.
 *
 * Volontairement hors CI (elle n'a pas de navigateur), et sans dépendance ajoutée au
 * projet : tout est fourni par l'image Docker. Lancer, l'app tournant en local :
 *
 *   docker run --rm --network container:notes-iut \
 *     -v "$PWD/frontend/e2e:/work" -w /usr/src/app \
 *     -e NODE_PATH=/usr/src/app/node_modules \
 *     --entrypoint node zenika/alpine-chrome:with-puppeteer /work/smoke.cjs
 *
 * C'est cette passe qui a mis au jour deux défauts invisibles autrement : la barre de
 * sections qui remontait la page à chaque changement de section, et le script
 * d'initialisation du thème bloqué par la CSP.
 */
const puppeteer = require("puppeteer");

const BASE = "http://localhost:8000";
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium-browser",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  for (const [label, path] of [["login", "/"], ["prévisions", "/preview/s5"]]) {
    const page = await browser.newPage();
    // iPhone 14 : la cible réelle de l'app.
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

    const consoleErrors = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

    await page.goto(BASE + path, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 800));

    // ── Débordement horizontal : c'est lui qui transforme le défilement vertical
    // en glissement diagonal sur mobile et donne l'impression d'une page bloquée.
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    check(
      `${label} — aucun débordement horizontal`,
      overflow.doc <= overflow.win + 1,
      `scrollWidth=${overflow.doc} innerWidth=${overflow.win}`
    );

    check(`${label} — aucune erreur console`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

    // ── La police auto-hébergée doit réellement être appliquée.
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    check(`${label} — Geist appliquée`, /Geist/.test(font), font.slice(0, 40));

    await page.close();
  }

  // ── Défilement réel de la page prévisions, avec les UE dépliées ──────────────
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(BASE + "/preview/s5", { waitUntil: "networkidle0", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 500));

  // Déplie toutes les UE : c'est le cas qui produisait le contenu tronqué à 6000 px.
  const headers = await page.$$("h3");
  for (const h of headers) {
    await h.evaluate((el) => el.closest("button")?.click());
    await new Promise((r) => setTimeout(r, 120));
  }
  await new Promise((r) => setTimeout(r, 900));

  const heightOpen = await page.evaluate(() => document.documentElement.scrollHeight);
  check("prévisions — le dépli allonge bien la page", heightOpen > 1500, `scrollHeight=${heightOpen}`);

  // Descente par paliers : on vérifie que la page ne remonte jamais toute seule.
  const maxScrollTarget = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight
  );
  const steps = Math.ceil(maxScrollTarget / 400) + 3;
  let previous = 0;
  let regressions = 0;
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => window.scrollBy(0, 400));
    await new Promise((r) => setTimeout(r, 200));
    const y = await page.evaluate(() => window.scrollY);
    if (y < previous - 2) regressions++;
    previous = y;
  }
  check("prévisions — la page ne remonte jamais seule", regressions === 0, `${regressions} retour(s) en arrière`);

  const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  check("prévisions — le bas de page est atteignable", previous >= maxScroll - 40, `y=${previous} max=${maxScroll}`);

  // Contenu tronqué : un panneau ouvert dont le contenu dépasse sa boîte visible.
  const clipped = await page.evaluate(() => {
    let bad = 0;
    for (const el of document.querySelectorAll("[aria-hidden='false'], .grid-rows-\\[1fr\\]")) {
      const inner = el.firstElementChild;
      if (inner && inner.scrollHeight > inner.clientHeight + 2) bad++;
    }
    return bad;
  });
  check("prévisions — aucun contenu tronqué par le repli", clipped === 0, `${clipped} bloc(s)`);

  await page.close();
  await browser.close();

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} vérifications passées`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exit(2);
});
