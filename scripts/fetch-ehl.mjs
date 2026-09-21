/* =========================================================================
   fetch-ehl.mjs

   Henter EHL-tabellen fra live.hockey.no og skriver data/ehl.json.
   Kjoeres av GitHub Actions, ikke av nettleseren.

   live.hockey.no er en JavaScript-app, saa vi kan ikke bare laste ned
   HTML-en. Skriptet starter derfor en usynlig Chromium, lar siden tegne
   seg ferdig, og leser av tabellen. Samtidig logger det alle JSON-kall
   siden gjoer - finner vi det virkelige API-et der, kan denne fila
   forenkles kraftig senere.

   Lokalt:  npm i playwright && npx playwright install chromium
            node scripts/fetch-ehl.mjs
   ========================================================================= */

import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SIDE = process.env.EHL_URL ||
  "https://live.hockey.no/standings?seasonId=201071&tournamentId=448981";
const UT = join(ROOT, "data", "ehl.json");
const TITTEL = "Elitehockeyligaen";

/* ---------- Kolonnegjenkjenning -----------------------------------------
   Overskriftene paa hockey.no kan endre seg. Legg til flere varianter her
   hvis en kolonne plutselig kommer ut tom.                                */
const KOLONNER = {
  lag:  /^(lag|team|klubb)$/i,
  gp:   /^(gp|k|sp|kamper|spilt|games?)$/i,
  pts:  /^(p|pts|poeng|points)$/i,
  gf:   /^(gf|ms|m\+|scoret|goals? ?for)$/i,
  ga:   /^(ga|mi|m-|innsluppet|goals? ?against)$/i,
  mal:  /^(m[åa]l|goals|score)$/i   // samlekolonne, f.eks. "34-18"
};

const stamp = () => new Date().toLocaleString("nb-NO", {
  dateStyle: "short", timeStyle: "short", timeZone: "Europe/Oslo"
});

function finnIndeks(overskrifter) {
  const i = {};
  overskrifter.forEach((h, n) => {
    for (const [navn, re] of Object.entries(KOLONNER)) {
      if (i[navn] === undefined && re.test(h.trim())) i[navn] = n;
    }
  });
  return i;
}

const tall = v => {
  const m = String(v ?? "").match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
};

function splittMal(v) {
  const m = String(v ?? "").match(/(\d+)\s*[-:]\s*(\d+)/);
  return m ? { gf: +m[1], ga: +m[2] } : { gf: null, ga: null };
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  // Logg alle JSON-svar. Staar det noe her, har vi funnet API-et.
  const jsonKall = [];
  page.on("response", res => {
    const ct = res.headers()["content-type"] || "";
    if (ct.includes("json")) jsonKall.push(res.url());
  });

  console.log("Aapner", SIDE);
  await page.goto(SIDE, { waitUntil: "networkidle", timeout: 60000 });

  // Vent til tabellen faktisk har rader
  try {
    await page.waitForFunction(
      () => document.querySelectorAll("table tbody tr").length > 3,
      { timeout: 30000 }
    );
  } catch {
    console.warn("Fant ingen tabell med rader innen 30 sekunder.");
  }

  const raa = await page.evaluate(() => {
    const table = document.querySelector("table");
    if (!table) return null;
    const overskrifter = [...table.querySelectorAll("thead th, thead td")]
      .map(el => el.innerText.trim());
    const rader = [...table.querySelectorAll("tbody tr")].map(tr => ({
      celler: [...tr.querySelectorAll("td, th")].map(td => td.innerText.trim()),
      logo: tr.querySelector("img")?.src || ""
    }));
    return { overskrifter, rader };
  });

  if (jsonKall.length) {
    console.log("\nJSON-kall siden gjorde (kandidater til API-et):");
    [...new Set(jsonKall)].forEach(u => console.log("  " + u));
  } else {
    console.log("\nIngen JSON-kall fanget opp.");
  }

  await browser.close();

  if (!raa || !raa.rader.length) {
    console.error("\nFikk ikke lest tabellen. data/ehl.json er ikke roert,");
    console.error("saa skjermen viser fortsatt forrige gyldige tabell.");
    process.exit(1);
  }

  console.log("\nOverskrifter:", raa.overskrifter.join(" | "));
  const idx = finnIndeks(raa.overskrifter);
  console.log("Gjenkjente kolonner:", JSON.stringify(idx));

  const lag = raa.rader.map((r, n) => {
    const c = i => (i === undefined ? null : r.celler[i]);

    let gf = tall(c(idx.gf));
    let ga = tall(c(idx.ga));
    if (gf === null && idx.mal !== undefined) ({ gf, ga } = splittMal(c(idx.mal)));

    // Faller tilbake paa aa lete etter et "34-18"-moenster hvor som helst
    if (gf === null) {
      const treff = r.celler.find(v => /^\d+\s*[-:]\s*\d+$/.test(v));
      if (treff) ({ gf, ga } = splittMal(treff));
    }

    return {
      plass: tall(r.celler[0]) ?? n + 1,
      lag: c(idx.lag) || r.celler.find(v => /[a-zæøå]{3}/i.test(v)) || "",
      logo: r.logo,
      gp: tall(c(idx.gp)),
      pts: tall(c(idx.pts)),
      gf,
      ga
    };
  }).filter(r => r.lag);

  const data = {
    _kilde: SIDE,
    navn: TITTEL,
    oppdatert: stamp(),
    lag
  };

  await mkdir(dirname(UT), { recursive: true });
  await writeFile(UT, JSON.stringify(data, null, 2) + "\n", "utf8");

  console.log(`\nSkrev data/ehl.json med ${lag.length} lag.`);
  const mangler = ["gp", "pts", "gf", "ga"].filter(f => lag.every(r => r[f] === null));
  if (mangler.length) {
    console.warn("Tomme kolonner:", mangler.join(", "));
    console.warn("Legg overskriften inn i KOLONNER oeverst i denne fila.");
  }
}

main().catch(err => {
  console.error("Feilet:", err.message);
  process.exit(1);
});
