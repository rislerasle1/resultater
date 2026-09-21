# Istider Lørenhallen – skjermvisning

Denne nettsiden viser dagens istider i Lørenhallen: hvilket lag som er på
isen akkurat nå, hvilket lag som er neste ut, og garderobe for hvert lag.
Designet for 16:9 (skjerm/TV i hallen), og oppdaterer seg selv gjennom dagen.

## Hvordan det henger sammen

Nettleseren kan **ikke** hente data direkte fra Google Sheets (Google
blokkerer slike kryss-domene-kall). Løsningen:

1. En **GitHub Action** (`.github/workflows/update-schedule.yml`) kjører
   hvert 15. minutt på GitHub sine servere og laster ned rådataene fra
   Google-arket som CSV, lagt i `data/schedule.csv`.
2. Nettsiden (`index.html`) leser `data/schedule.csv` fra sitt eget repo
   (samme domene → ingen blokkering), tolker dagens rader, og viser:
   - **Grønn boks**: lag som er på isen akkurat nå (kan vise flere hvis de
     deler is samtidig)
   - **Blå boks**: neste lag ut
   - En full liste over dagens økter til høyre

## Oppsett (gjør dette én gang)

1. Opprett et nytt repo på GitHub, f.eks. `istider-lorenhallen`.
2. Last opp alle filene i denne mappen (behold mappestrukturen:
   `.github/workflows/update-schedule.yml`, `data/schedule.csv`, `index.html`).
3. Gå til **Settings → Pages** i repoet, velg branch `main` og mappe `/ (root)`.
   GitHub gir deg en lenke som `https://dittbrukernavn.github.io/istider-lorenhallen/`.
4. Gå til **Actions**-fanen og kjør workflowen manuelt én gang
   ("Run workflow") slik at `data/schedule.csv` fylles med ekte data med det
   samme, i stedet for å vente 15 minutter.

Etter dette kjører alt av seg selv – ingen manuell oppdatering nødvendig.

## Hvis Google ber om innlogging i Action-loggen

Hvis du åpner en kjøring under **Actions** og ser at `data/schedule.csv`
inneholder en HTML-innloggingsside i stedet for tall og lagnavn, betyr det
at arket ikke er delt bredt nok for anonym nedlasting. Løsning:

1. Åpne Google-arket → **Fil → Del → Publiser på nettet**.
2. Velg fanen "Lørenhallen 26/27" og format **CSV**, trykk **Publiser**.
3. Kopier lenken du får (ser omtrent slik ut:
   `https://docs.google.com/spreadsheets/d/e/2PACX-xxxxxxxx/pub?gid=1742117620&single=true&output=csv`).
4. Lim den inn i `.github/workflows/update-schedule.yml`, i `curl`-linjen,
   i stedet for den nåværende `.../export?format=csv&gid=...`-lenken.
5. Commit endringen – Action-en bruker automatisk den nye lenken neste gang
   den kjører.

## Endre hvilket ark/fane som leses

Hvis lagnavnet på fanen i Google Sheets endres (f.eks. neste sesong blir det
"Lørenhallen 27/28"), trenger du ikke endre noe her – workflowen bruker
`gid` (fane-ID), ikke fanenavnet, så den følger automatisk med selv om du
bytter navn på fanen. Bytter du derimot til en helt ny fane (nytt `gid`),
må du oppdatere `gid=...` i `update-schedule.yml`.
