---
name: pvp-testen
description: Hoe je PVP toetst op de droplet — zonder browser, tegen de testdatabase pvp_test. Gebruik dit vóór elke deploy van index.html of server.js.
---

# PVP toetsen zonder browser

Er staat **geen browser** op de droplet en Chrome-afhankelijkheden ontbreken. Toetsen gaat met
**jsdom**: de echte `index.html` laden tegen een testserver die op de testdatabase draait.

## Opzetten
```bash
set -a; . /var/pvp/pg.env; set +a
export PVP_PG="${PVP_PG%/pvp}/pvp_test"          # alleen de databasenaam achteraan vervangen
psql "$PVP_PG" -f /root/pvp/schema.sql            # idempotent
NODE_PATH=/opt/pvp-api/node_modules \
  PVP_DATA=<scratchpad>/pvptest PVP_FRONTEND=/root/pvp PVP_PORT=3010 \
  PVP_VERKOOP_TOKEN=proeftoken node server.js &
```
- `PVP_PG="${PVP_PG/\/pvp/\/pvp_test}"` is **fout**: dat vervangt de eerste `/pvp` in de DSN, en dat
  is de `//pvp_app` van de gebruikersnaam. Je krijgt `pvp_test_app` en een `pg_hba`-fout die niets
  met je wijziging te maken heeft.
- `PVP_FRONTEND` is een **map**, niet een bestand.
- `NODE_PATH` is nodig: `pg` staat in `/opt/pvp-api/node_modules`, niet in de repo.
- Raakt de Autoboek-koppeling het echte boek? Zet `AUTOBOEK_FILE_ID` op de **kopie**
  (`162eY3ERZBViKBl4d1DVdCZM5wFGM4Z6Z`), of laat hem leeg — dan staat de koppeling uit.

Testaccounts maken (wachtwoord `proefpw`):
```bash
node setpw.js proefteam team "proefpw" "Proef team"      # ook: proefadmin, proefcarport, prooffoto, proeftaxateur
```

## De jsdom-val die je een avond kost
`fetch`, `scrollTo`, `confirm` en `matchMedia` moeten via **`beforeParse`** gezet worden. De scripts
draaien al tijdens het opbouwen van de DOM; zet je ze erna, dan valt `boot()` terug op de demo-modus
en toets je niets.

```js
const dom = new JSDOM(html, { url: BASIS+'/', runScripts:'dangerously', pretendToBeVisual:true,
  beforeParse(w){
    w.fetch=(u,o={})=>fetch(String(u).startsWith('http')?u:BASIS+u,{...o,headers:{...(o.headers||{}),cookie:koek}});
    w.scrollTo=()=>{}; w.confirm=()=>true;
    w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
    w.addEventListener('error',e=>fouten.push(String((e.error&&e.error.stack)||e.message)));
  }});
await new Promise(res => dom.window.addEventListener('load', res));
await new Promise(r => setTimeout(r, 1700));      // de app haalt zijn gegevens asynchroon op
```

Andere vallen, allemaal een keer echt misgegaan:
- **`document.body.textContent` bevat de broncode van het `<script>`** (154 kB). Toets altijd op
  `document.getElementById('app')`, anders slaagt elke controle.
- **`const` en `let` op het hoogste niveau staan niet op `window`.** Lees ze met `window.eval('V')`.
- **Zet in de testdatabase gegevens die afwijken van de terugvallijst `V` in `index.html`**, anders
  bewijst een geslaagde toets niets.
- **Toetsgegevens lopen weg.** Een toets die zelf iets afvinkt of verkoopt, verandert de gegevens voor
  de volgende. Loopt een toets ineens vast, kijk dan eerst of de gegevens nog kloppen vóór je de code
  verdenkt — dat was tot nu toe elke keer de oorzaak.

## Wat je minimaal doorloopt
1. **De vijf rollen laden zonder JS-fouten**: team, admin, foto, taxateur, carport.
2. **De rol-flow van wat je aanraakte**, en dan de handeling écht doen (`w.eval('afleveren(4)')`) en
   nakijken wat er in de database staat — niet alleen of de knop er is.
3. **Wie mag wat**: de rol die het niet mag, ziet de knop niet **én** krijgt 403 op het endpoint.
   Toets die tweede altijd apart; verbergen in beeld is geen beveiliging.
4. **Omkeerbaar**: doe de handeling, draai hem terug, en controleer dat je weer bij de begintoestand
   bent.

## Deployen
```bash
cp index.html /var/www/html/index.html
cp server.js /opt/pvp-api/server.js
systemctl restart pvp-api
systemctl is-active pvp-api && curl -s http://127.0.0.1:3000/api/health   # verwacht db:true
```
`db:false` betekent: de service draait, de database niet bereikbaar. Vergeet niet de testserver te
stoppen (bewaar zijn PID) — twee servers op dezelfde testdatabase geven verwarrende uitkomsten.

## Niet-frontend
- **Beeldbewerking** (`verkleinFoto`): knip het blok uit `index.html` en draai het met
  `@napi-rs/canvas` in de scratchpad. Let op: `toDataURL` neemt kwaliteit als 0–1, `toBuffer` als
  0–100.
- **Het Autoboek**: draai altijd eerst zonder `--echt`, en kijk lokaal na dat de andere tabbladen
  byte-identiek zijn, de koprijen ongewijzigd, en het aantal gevulde regels klopt. Pas dan uploaden.
  Tel op **gevulde** regels, niet op rij-elementen: het boek zit vol lege `<row>`-elementen.
- **Rijnummers uit de database zijn niet te vertrouwen.** Controleer vóór het schrijven of de rij nog
  de auto is die je verwacht (VIN of kenteken). Dat heeft op 23-08-2026 twee verkeerd overschreven
  regels voorkomen.
