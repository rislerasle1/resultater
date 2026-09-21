/* =========================================================================
   fetch-standings.mjs

   Henter alle tabellene i data/tabeller.json fra TurneringsAdmin og skriver
   dem samlet til data/standings.json. Kjoeres av GitHub Actions.

   Endepunktet ble funnet ved aa logge nettverkskallene live.hockey.no gjoer.

   Legge til en tabell: rediger data/tabeller.json. Ingen kodeendring.

   Lokalt:  node scripts/fetch-standings.mjs
   ========================================================================= */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KONFIG = join(ROOT, "data", "tabeller.json");
const UT = join(ROOT, "data", "standings.json");
const UT_KAMPER = join(ROOT, "data", "kamper.json");

const API = "https://sf34-terminlister-prod-app.azurewebsites.net";
const HENT_LOGOER = process.env.HENT_LOGOER !== "0";

const stamp = () => new Date().toLocaleString("nb-NO", {
  dateStyle: "short", timeStyle: "short", timeZone: "Europe/Oslo"
});

async function api(sti) {
  const res = await fetch(API + sti, {
    headers: { Accept: "application/json", "User-Agent": "lorenhallen-infoskjerm" }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${sti}`);
  return res.json();
}

/* ---------- Finn tabellrekkene uansett hvordan svaret er pakket ---------- */

function erTabellrad(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const n = Object.keys(o).length;
  return n >= 4 && Object.values(o).some(v => typeof v === "string" && /[a-zæøå]{3}/i.test(v));
}

function finnRader(node, dybde = 0) {
  if (dybde > 6 || !node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    return node.length >= 2 && node.every(erTabellrad) ? node : null;
  }
  for (const v of Object.values(node)) {
    const treff = finnRader(v, dybde + 1);
    if (treff) return treff;
  }
  return null;
}

/* ---------- Finn feltnavn uten aa vite dem paa forhaand ------------------ */

const FELT = {
  plass:  [/^(rank|position|pos|placement|plass|no|nr)$/i],
  lag:    [/^(teamname|team_?name|name|team|club|clubname|lag|lagnavn|title)$/i],
  gp:     [/^(gp|gamesplayed|games_?played|played|matches|kamper|spilt)$/i],
  pts:    [/^(pts|points|point|poeng)$/i],
  gf:     [/^(gf|goalsfor|goals_?for|scored|goalsscored|malfor|scoret)$/i],
  ga:     [/^(ga|goalsagainst|goals_?against|conceded|malmot|innsluppet)$/i],
  orgId:  [/^(orgid|organisationid|organizationid|clubid|teamid)$/i],
  logo:   [/logo|emblem|crest|badge|image|picture/i]
};

function kartlegg(rad) {
  const noekler = Object.keys(rad);
  const kart = {};
  for (const [felt, moenstre] of Object.entries(FELT)) {
    kart[felt] = noekler.find(k => moenstre.some(re => re.test(k))) || null;
  }
  return kart;
}

const tall = v => {
  if (typeof v === "number") return v;
  const m = String(v ?? "").match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
};

/* Lagnavn kan ligge nestet: { team: { name: "..." } } */
function lesNavn(rad, noekkel) {
  const v = noekkel ? rad[noekkel] : null;
  if (typeof v === "string" && v.trim()) return v.trim();
  for (const val of Object.values(rad)) {
    if (val && typeof val === "object" && typeof val.name === "string") return val.name;
  }
  for (const val of Object.values(rad)) {
    if (typeof val === "string" && /[a-zæøå]{3}/i.test(val) && !/^https?:/i.test(val)) return val.trim();
  }
  return "";
}

/* ---------- Logoer via organisasjons-oppslaget --------------------------- */

function finnUrl(node, dybde = 0) {
  if (dybde > 5 || !node) return null;
  if (typeof node === "string") {
    return /^https?:\/\/.+\.(png|jpe?g|svg|webp)/i.test(node) ? node : null;
  }
  if (typeof node !== "object") return null;
  for (const [k, v] of Object.entries(node)) {
    if (FELT.logo.some(re => re.test(k))) {
      const u = finnUrl(v, dybde + 1);
      if (u) return u;
    }
  }
  for (const v of Object.values(node)) {
    const u = finnUrl(v, dybde + 1);
    if (u) return u;
  }
  return null;
}

async function hentLogo(orgId) {
  try {
    return finnUrl(await api(`/org/Organisation?orgIds=${orgId}`)) || "";
  } catch {
    return "";
  }
}

/* ---------- En enkelt tabell --------------------------------------------- */

async function hentTabell(t, logoCache) {
  const sti = `/ta/TournamentStandings/?tournamentId=${t.tournamentId}`;
  const svar = await api(sti);
  const rader = finnRader(svar);

  if (!rader) {
    throw new Error("fant ingen tabellrekker i svaret");
  }

  const kart = kartlegg(rader[0]);
  if (!kart._logget) {
    console.log(`    felt: ${Object.keys(rader[0]).join(", ")}`);
    console.log(`    gjenkjent: ${JSON.stringify(kart)}`);
  }

  const lag = rader.map((r, i) => ({
    plass: tall(kart.plass ? r[kart.plass] : null) ?? i + 1,
    lag: lesNavn(r, kart.lag),
    logo: (kart.logo && typeof r[kart.logo] === "string" ? r[kart.logo] : "") || "",
    orgId: kart.orgId ? r[kart.orgId] : null,
    gp: tall(kart.gp ? r[kart.gp] : null),
    pts: tall(kart.pts ? r[kart.pts] : null),
    gf: tall(kart.gf ? r[kart.gf] : null),
    ga: tall(kart.ga ? r[kart.ga] : null)
  })).filter(r => r.lag);

  if (!lag.length) {
    console.error("    foerste rad:", JSON.stringify(rader[0]));
    throw new Error("fikk ingen lagnavn ut av svaret");
  }

  if (HENT_LOGOER) {
    for (const r of lag) {
      if (r.logo || !r.orgId) continue;
      // Samme klubb gaar igjen i flere tabeller - hent hver logo en gang
      if (!logoCache.has(r.orgId)) logoCache.set(r.orgId, await hentLogo(r.orgId));
      r.logo = logoCache.get(r.orgId);
    }
  }

  lag.forEach(r => delete r.orgId);

  return { navn: t.navn, tournamentId: t.tournamentId, kilde: API + sti, lag };
}


/* ---------- Kamper ---------------------------------------------------------
   Endepunkt: /ta/TournamentMatches/?tournamentId=<id>
   Vi vet ikke hva feltene heter, saa de gjenkjennes paa navn - som i tabellen.
   Bare kamper der klubben deltar tas med.
*/

const KLUBB = /hasle\s*[-/ ]?\s*l(ø|o)ren/i;

const KAMPFELT = {
  start:     [/^(matchstarttime|starttime|start|matchdate|date|datetime|playdate|time)$/i],
  hjemme:    [/^(hometeam|hometeamname|home_?team|home|hjemmelag)$/i],
  borte:     [/^(awayteam|awayteamname|away_?team|away|visitingteam|bortelag)$/i],
  hjemmeMal: [/^(homegoals|homescore|homeresult|hometeamgoals|goalshome|malhjemme)$/i],
  borteMal:  [/^(awaygoals|awayscore|awayresult|awayteamgoals|goalsaway|malborte)$/i],
  arena:     [/^(venue|arena|rink|location|facility|hall|bane)$/i]
};

function kartleggKamp(rad) {
  const noekler = Object.keys(rad);
  const kart = {};
  for (const [felt, moenstre] of Object.entries(KAMPFELT)) {
    kart[felt] = noekler.find(k => moenstre.some(re => re.test(k))) || null;
  }
  return kart;
}

/* Lagnavn kan vaere streng eller { name: "..." } */
function navnAv(v) {
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object") return String(v.name || v.teamName || v.title || "").trim();
  return "";
}

/* Finn foerste dato-lignende verdi hvis feltnavnet ikke ble gjenkjent */
function finnDato(rad, noekkel) {
  const kandidat = noekkel ? rad[noekkel] : null;
  const verdier = kandidat != null ? [kandidat] : Object.values(rad);
  for (const v of verdier) {
    const m = String(v ?? "").match(/(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2}:\d{2})?/);
    if (m) return { dato: `${m[1]}-${m[2]}-${m[3]}`, tid: m[4] || "" };
  }
  return null;
}

async function hentKamper(t, foerste) {
  const sti = `/ta/TournamentMatches/?tournamentId=${t.tournamentId}`;
  const rader = finnRader(await api(sti));
  if (!rader) throw new Error("fant ingen kamper i svaret");

  const kart = kartleggKamp(rader[0]);
  if (foerste) {
    console.log(`    kampfelt: ${Object.keys(rader[0]).join(", ")}`);
    console.log(`    gjenkjent: ${JSON.stringify(kart)}`);
  }

  const ut = [];
  for (const r of rader) {
    const hjemme = navnAv(kart.hjemme ? r[kart.hjemme] : null);
    const borte = navnAv(kart.borte ? r[kart.borte] : null);
    if (!hjemme || !borte) continue;
    if (!KLUBB.test(hjemme) && !KLUBB.test(borte)) continue;

    const naar = finnDato(r, kart.start);
    if (!naar) continue;

    ut.push({
      dato: naar.dato,
      tid: naar.tid,
      hjemme,
      borte,
      arena: kart.arena ? String(r[kart.arena] ?? "") : "",
      divisjon: t.navn,
      hjemmeMal: tall(kart.hjemmeMal ? r[kart.hjemmeMal] : null),
      borteMal: tall(kart.borteMal ? r[kart.borteMal] : null)
    });
  }
  return ut;
}

/* ---------- Kjoering ------------------------------------------------------ */

async function main() {
  const konfig = JSON.parse(await readFile(KONFIG, "utf8"));
  const oenskede = (konfig.tabeller || []).filter(t => t.tournamentId);
  const hoppet = (konfig.tabeller || []).filter(t => !t.tournamentId);

  if (hoppet.length) {
    console.log("Uten tournamentId, hoppes over:", hoppet.map(t => t.navn).join(", "));
  }

  const logoCache = new Map();
  const ut = [];
  let feil = 0;

  for (const t of oenskede) {
    console.log(`\n${t.navn} (${t.tournamentId})`);
    try {
      const tabell = await hentTabell(t, logoCache);
      ut.push(tabell);
      const medLogo = tabell.lag.filter(r => r.logo).length;
      console.log(`    ${tabell.lag.length} lag, ${medLogo} med logo`);
    } catch (err) {
      console.error(`    FEIL: ${err.message}`);
      feil++;
    }
  }

  // Kamper for de samme seriene
  console.log("\nKamper:");
  let kamper = [];
  let foerste = true;
  for (const t of oenskede) {
    try {
      const k = await hentKamper(t, foerste);
      foerste = false;
      kamper = kamper.concat(k);
      console.log(`    ${t.navn}: ${k.length} kamper med Hasle/Løren`);
    } catch (err) {
      console.error(`    ${t.navn}: FEIL - ${err.message}`);
    }
  }

  // Samme kamp kan ligge i to serier
  const sett = new Set();
  kamper = kamper
    .filter(k => {
      const id = `${k.dato}|${k.tid}|${k.hjemme}|${k.borte}`;
      if (sett.has(id)) return false;
      sett.add(id);
      return true;
    })
    .sort((a, b) => a.dato.localeCompare(b.dato) || a.tid.localeCompare(b.tid));

  if (kamper.length) {
    await mkdir(dirname(UT_KAMPER), { recursive: true });
    await writeFile(UT_KAMPER, JSON.stringify({
      oppdatert: stamp(),
      kamper
    }, null, 2) + "\n", "utf8");
    console.log(`Skrev data/kamper.json med ${kamper.length} kamper.`);
  } else {
    console.warn("Ingen kamper funnet - data/kamper.json er ikke roert.");
  }

  if (!ut.length) {
    console.error("\nIngen tabeller hentet. data/standings.json er ikke roert,");
    console.error("saa skjermen viser fortsatt forrige gyldige data.");
    process.exit(1);
  }

  await mkdir(dirname(UT), { recursive: true });
  await writeFile(UT, JSON.stringify({
    oppdatert: stamp(),
    tabeller: ut
  }, null, 2) + "\n", "utf8");

  console.log(`\nSkrev data/standings.json med ${ut.length} tabeller` +
              (feil ? ` (${feil} feilet og ble utelatt)` : ""));
}

main().catch(err => {
  console.error("Feilet:", err.message);
  process.exit(1);
});
