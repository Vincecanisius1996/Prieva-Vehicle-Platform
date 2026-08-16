# CLAUDE.md — Prieva Vehicle Platform (PVP)

Dit bestand is context voor Claude Code. Lees dit eerst voordat je wijzigingen maakt.
Antwoord en commit-berichten in het **Nederlands**. De UI van PVP is volledig Nederlands.

## Wat is PVP
Intern platform van Prieva B.V. (autobedrijf) om de doorloop van ingekochte/geïmporteerde auto's
te volgen: van "komend" → binnengekomen → import/BPM-traject → foto's → advertentie → verkoopklaar.
Draait live op **https://pvp.prieva.nl**. Meerdere gebruikers, met rollen en login.

## Architectuur (bewust simpel — geen build-stap, geen frameworks)
- **Frontend:** één bestand `index.html` (HTML + inline CSS + inline JS, geen bundler). Alle state
  in JS-geheugen, gesynct met de backend via `fetch`. CDN alleen voor Montserrat-font en JSZip.
- **Backend:** `server.js` — puur Node op één uitzondering na: `pg` (de PostgreSQL-driver).
  Draait als systemd-service `pvp-api` op `127.0.0.1:3000`.
- **`setpw.js`:** los scriptje om accounts aan te maken/wijzigen (schrijft in de tabel `users`).
- **Webserver:** nginx serveert `/var/www/html/index.html`; proxyt `/api/` → `127.0.0.1:3000`;
  serveert `/uploads/` vanaf `/var/pvp/uploads`.
- **Opslag: PostgreSQL 16, database `pvp`, rol `pvp_app`** (sinds 15-08-2026, Fase 1 afgerond).
  Tabellen: `vehicles` (catalogus + status + `photos`/`subtasks`/`ad_photos` als jsonb),
  `global_todos`, `activity_log`, `bpm_reports`, `bpm_notifs`, `users`, `meta` (tellers `subUid`/`gtUid`).
  Schema staat in `/opt/pvp-api/schema.sql` (idempotent).
  - Verbinding: `/var/pvp/pg.env` (chmod 600, `PVP_PG=postgresql://…`), ingeladen via
    `EnvironmentFile=` in de systemd-unit. **Nooit committen.**
  - **Geüploade bestanden blijven op schijf** in `/var/pvp/uploads`; alleen de URL's staan in de database.
  - `/var/pvp/secret` (HMAC-sleutel voor de sessiecookie) blijft een bestand.
  - De oude JSON-bestanden staan er nog als `*.json` + `*.json.bak-20260815`, maar worden **niet meer
    gelezen of geschreven** — ze zijn bevroren op het moment van de migratie en dienen als rollback.

## Belangrijk: bestandslocaties
- Repo (GitHub): `github.com/Vincecanisius1996/Prieva-Vehicle-Platform`, op de server gecloned in
  `/root/pvp`. **Op 16-08-2026 gelijkgetrokken met live** — daarvóór liep de kloon maanden achter.
  De **bron van waarheid blijft de live code**: de repo is een kopie, geen deploydoel. Controleer
  met een `diff` tegen `/var/www/html/` en `/opt/pvp-api/` dat het nog klopt vóór je iets overneemt.
- Live frontend: `/var/www/html/index.html` — in de repo `index.html`.
- Live backend: `/opt/pvp-api/server.js` + `setpw.js` + `schema.sql` — in de repo dezelfde namen.
- `beheer/` — de scripts en systemd-units van `/usr/local/bin/` en `/etc/systemd/system/`. Zie
  `beheer/LEESMIJ.md`. Wijzig je daar iets, kopieer het dan ook naar de server; ze draaien vanaf
  de server, niet vanuit de repo.
- `pg/` — archief van de Postgres-migratie, alleen nog `import-json.js` + `package*.json`. Zie
  `pg/LEESMIJ.md`. De kopieën van `server.js`/`setpw.js`/`schema.sql` die hier stonden zijn weg;
  twee exemplaren van hetzelfde bestand lopen uiteen en dan weet niemand meer welke geldt.
- In de repo staan historische `index_N.html`-kopieën en een bestand `server.js update`; die zijn
  van vóór deze opschoning en niet meer in gebruik. Bron van waarheid is `index.html`.
- **Niet in de repo, met opzet:** `/var/pvp/pg.env`, `/var/pvp/secret`, `/var/pvp/uploads`, de
  JSON-back-ups en alles wat `.gitignore` uitsluit.

## Rollen (server dwingt af)
- `team` — volledige app.
- `admin` — team + 📜 Logboek (activiteitenlog). Accounts: `vince`, `floris`.
- `foto` — alleen advertentiefoto's uploaden. Account: `fotograaf`.
- `taxateur` — eigen S-TAX-portaal: alleen auto's op taxatie (route=JA), RDW/papieren-foto's
  bekijken/downloaden, BPM-taxatierapport uploaden/verwijderen. Account: `s-tax`.
Accounts aanmaken (de DSN moet in de omgeving staan):
```
set -a; . /var/pvp/pg.env; set +a
node /opt/pvp-api/setpw.js <gebruiker> <team|admin|foto|taxateur> "<wachtwoord>" "<naam>"
```

## API-endpoints (in server.js)
`/api/login`, `/api/logout`, `/api/me`, `/api/health`, `/api/state` (team+admin GET/PUT),
`/api/status` (elke rol), `/api/vehicles` (elke rol, alleen-lezen catalogus — nog niet gebruikt door de
frontend; haak voor Fase 3), `/api/photo` (team+admin), `/api/adphotos` + `/api/adphoto` +
`/api/adphotos-set`, `/api/taxstate` (taxateur+team+admin), `/api/bpmreports`, `/api/bpmreport`,
`/api/bpmnotif-seen`, `/api/bpmreport-del`, `/uploads/*` (auth).
Auth = HMAC-ondertekende cookie (stateless).

## Lokaal testen (voordat je deployt)
Er staat een testdatabase `pvp_test` klaar (zelfde rol `pvp_app`; `pg_hba` staat beide toe). De backend
kan de frontend zelf serveren en luistert op de poort uit `PVP_PORT`, zodat de live service op 3000
ongestoord doordraait:
```
set -a; . /var/pvp/pg.env; set +a
export PVP_PG=${PVP_PG/\/pvp/\/pvp_test}
psql "$PVP_PG" -f /opt/pvp-api/schema.sql          # schema (idempotent)
node setpw.js testteam team "testpw" "Test team"   # testaccount in pvp_test
PVP_DATA=/tmp/pvptest PVP_FRONTEND=<pad> PVP_PORT=3001 node server.js
# dan: http://127.0.0.1:3001/
```
Testdatabase leegmaken kan met `TRUNCATE vehicles, global_todos, activity_log, bpm_reports, bpm_notifs, meta;`.
Test end-to-end met een headless browser als die beschikbaar is. Controleer bij frontend-wijzigingen
minimaal: geen JS-fouten in de console, en de rol-flows (team, admin, foto, taxateur).

## Deployen
Als Claude Code **op de server** draait: bewerk de bestanden direct en herstart:
```
cp index.html /var/www/html/index.html          # frontend
cp server.js /opt/pvp-api/server.js             # backend (indien gewijzigd)
systemctl restart pvp-api
systemctl is-active pvp-api && curl -s http://127.0.0.1:3000/api/health   # verwacht: {"ok":true,...,"db":true}
```
`db:false` in `/api/health` betekent: de service draait wél, maar de database is onbereikbaar
(controleer `/var/pvp/pg.env`, `systemctl status postgresql` en `journalctl -u pvp-api`).
Werk je **op de Mac**: commit + push naar GitHub, dan op de server `cd /root/pvp && git pull` en
bovenstaande `cp`/restart. Doe daarna `grep -c renderTax /var/www/html/index.html` als snelle sanity-check
op de frontend.

## Back-up van de database
`pvp-backup.timer` draait elke nacht om 02:15 UTC `/usr/local/bin/pvp-backup.sh`: een `pg_dump` van
**alleen** de database `pvp` naar `/var/backups/pvp/pvp-<stempel>.sql.gz` (mode 600, map 700),
30 dagen bewaartermijn. Het script controleert daarna of het gzip-bestand heel is én of de tabel
`vehicles` er echt in zit; zo niet, gooit het de dump weg en faalt de service (zichtbaar via
`systemctl --failed`). Handmatig draaien: `systemctl start pvp-backup.service`.

Herstellen:
```
systemctl stop pvp-api
gunzip -c /var/backups/pvp/pvp-<stempel>.sql.gz | sudo -u postgres psql -d pvp
systemctl start pvp-api
```
Wat er **niet** in zit: `/var/pvp/uploads` (zie hieronder) en `/var/pvp/secret`.

## Back-up van de uploads (foto's en BPM-rapporten)
`pvp-uploads-snapshot.timer` draait elke nacht om 02:30 UTC `/usr/local/bin/pvp-uploads-snapshot.sh`:
een complete momentopname van `/var/pvp/uploads` in `/var/backups/pvp/uploads/<stempel>/`, 14 dagen
bewaartermijn. Ongewijzigde bestanden krijgen een **hardlink** naar de vorige nacht in plaats van een
kopie — een tweede momentopname van 148 foto's kost daardoor circa 20 KB in plaats van 571 MB. Dat kan
omdat de app bestanden nooit overschrijft: elke upload krijgt een eigen willekeurige naam. Het script
weigert een momentopname die qua aantal bestanden of bytes afwijkt van de bron.

Eén foto terugzetten:
```
cp /var/backups/pvp/uploads/laatste/<auto>/<bestand> /var/pvp/uploads/<auto>/
```
Alles terugzetten: `rsync -a /var/backups/pvp/uploads/<stempel>/ /var/pvp/uploads/`.
De URL's in de database wijzen naar hetzelfde pad, dus verder hoeft er niets aangepast te worden.

**Dit is stap A** uit `PVP-uploads-backup-voorstel.md` en beschermt tegen per ongeluk verwijderen.
**Stap B — een versleutelde kopie buiten de droplet — staat nog open**; zonder dat is verlies van de
server nog steeds verlies van alle foto's.

## Wees-bestanden in uploads
De app verwijdert URL's uit de database zonder het bestand van schijf te halen — zowel via
`/api/adphotos-set` (advertentiefoto weggegooid) als via `PUT /api/state` (keuringsfoto verwijderd
**of overschreven**). Zonder opruimen groeit `/var/pvp/uploads` dus door met onzichtbare bestanden;
op 15-08-2026 was dat al 16 bestanden / 49 MB (8%) na drie dagen.

`pvp-uploads-opruimen.timer` (02:20 UTC, dus vóór de momentopname) stemt schijf en database op elkaar
af en verplaatst wezen naar `/var/pvp/prullenbak/<stempel>/`. Daar staan ze nog 30 dagen; er wordt
nooit direct iets gewist.

Bewust zo gebouwd, niet als directe `unlink` in de endpoints:
- één plek dekt álle lekken, ook toekomstige, en het live request-pad blijft ongemoeid;
- de app heeft een knop **"Ongedaan maken"** na het verwijderen van een foto — direct wissen zou die
  stukmaken, met een wachttijd van 7 dagen is dat uitgesloten;
- een client met verouderde gegevens kan foto's van een ander uit de lijst duwen; die zijn nu terug
  te halen in plaats van meteen weg.

Veiligheidskleppen (getest): het script breekt af als de database onbereikbaar is, als die naar
**0** bestanden verwijst, of als **meer dan 25%** van de bestanden wees lijkt — dat duidt op een fout,
niet op afval. Bewust doorgaan kan met `--forceer`. Kijken zonder iets te doen: `--proefdraai`.
Raakt nooit bestanden aan die jonger zijn dan 60 minuten (`/api/photo` schrijft het bestand ~0,4 s
vóórdat de frontend de URL opslaat).

Ter info: `crp-backup.sh` gebruikt `pg_dumpall` en dumpt dus álle databases op deze host, inclusief
`pvp`. Dat is meegenomen, maar geen vervanging — dat script en `/var/backups/crp` zijn van CRP; **niet
aanpassen en niet als PVP-back-up gebruiken.**

## Foto's verkleinen bij het uploaden
Sinds 16-08-2026 verkleint `index.html` afbeeldingen in de browser vóór het uploaden — geen extra
afhankelijkheid, puur `createImageBitmap` + canvas. Instellingen staan als constanten bij elkaar:
`FOTO_MAX=2560` (langste zijde), `FOTO_KWALITEIT=0.92`, `FOTO_MIN_BYTES=600*1024`.

Gemeten op de 132 bestaande advertentiefoto's: 560 MB → 119 MB (4,7x), gemiddeld 4,25 MB → 926 KB,
6224×4672 → 2560×1922, afwijking 39,6 dB PSNR (boven ~36 dB is verschil met het blote oog weg).
Bij kwaliteit 0,88 zou het 106 MB zijn en bij 0,95 186 MB; 0,92 is bewust gekozen als het punt
waar de winst afvlakt maar de afwijking blijft oplopen.

- Aanroepers: `setPhoto`, `addToTray`, `uploadAdFiles` gaan via `leesFoto()`.
  **`uploadBpm` bewust niet** — dat zijn PDF's, die mogen nergens langs een canvas.
- **Verkleinen mag nooit een upload kosten.** Elk faalpad (HEIC, geen canvas, te weinig geheugen,
  onleesbaar bestand) valt terug op het originele bestand, precies zoals het vroeger ging.
- Niet aanraken: bestanden < `FOTO_MIN_BYTES`, niet-afbeeldingen, en foto's die qua afmeting al
  onder `FOTO_MAX` zitten — die worden **niet** opnieuw gecomprimeerd.
- `imageOrientation:'from-image'` staat er omdat een canvas zonder EXIF hercodeert; zonder die vlag
  komen telefoonfoto's gedraaid binnen. Alle 148 foto's van vóór deze wijziging hadden oriëntatie 1.
- Stapsgewijs halveren als de decoder niet zelf kan schalen: in één keer meer dan 2x verkleinen geeft
  kartelranden. Het snelpad (`resizeWidth` in `createImageBitmap`) vermijdt een canvas van 29 megapixel,
  wat op iOS Safari tegen de maximale canvasgrootte aan loopt.
- Lost meteen op dat nginx uploads boven 30 MB weigert (`client_max_body_size` in
  `/etc/nginx/sites-available/default`) terwijl de app die fout stil slikt.
- **Bestaande foto's zijn niet omgezet** — dit werkt vanaf de eerstvolgende upload.

Testen zonder browser (er staat er geen op de droplet, en Chrome-afhankelijkheden ontbreken): knip het
blok uit `index.html` en draai het met `@napi-rs/canvas` in de scratchpad. Let op: `toDataURL` neemt
kwaliteit als 0–1 (browserconventie), `toBuffer` als 0–100 — dat verschil kost je een meting.

## Regels & valkuilen (belangrijk)
- **Houd PVP strikt gescheiden van CRP.** Op dezelfde droplet draait een aparte reporting-tool (CRP)
  op `reporting.prieva.nl` (Docker-container `crp`, eigen nginx-blok, gedeelde PostgreSQL). **Raak nooit**
  de `crp`-container, de CRP-databases, of de nginx-config van `crp` aan. PVP heeft z'n eigen service,
  poort (3000) en nginx-blok (`pvp.prieva.nl`).
- **Geen geheimen in de repo:** geen wachtwoorden, geen `/var/pvp/secret`, geen `/var/pvp/pg.env`,
  geen API-sleutels. Wachtwoorden worden alleen via `setpw.js` gezet.
- **`pg_hba.conf` is gedeeld met CRP.** Onderaan staat één PVP-regel
  (`host pvp,pvp_test pvp_app 127.0.0.1/32 scram-sha-256`); de CRP-regels erboven blijven onaangeroerd.
  Na een wijziging **`systemctl reload postgresql`** — nooit `restart`, dat verbreekt CRP-verbindingen.
  Back-up: `pg_hba.conf.bak-20260815-pvp`.
- **`import-json.js` (in `/root/pvp/pg/`) is eenmalig geweest.** De JSON-bestanden zijn bevroren;
  opnieuw draaien overschrijft de database met oude data. Het script weigert dat zonder `--overschrijf`.
- **`window.history` i.p.v. `history`:** in `index.html` bestaat een lokale `const history = []`
  (de undo-stack) die de globale `history` overschaduwt. Gebruik voor routing altijd `window.history`.
- **Voertuiglijst is nog een vaste snapshot** (`const V = [...]` in index.html, overgenomen uit het
  Autoboek op 12-08-2026). Er is nog géén automatische koppeling met het Autoboek (dat is Fase 3).
- **Geen npm-afhankelijkheden in de backend** toevoegen tenzij expliciet afgesproken. `pg` is de enige
  toegestane uitzondering (een DB-driver kan niet puur-Node).
- **Eén verbetering per keer**, en test rol-flows voordat je live zet.

## Stijl
PRIEVA-huisstijl: font Montserrat, blauwverloop `#0D9EBF → #056A7F`, zwart woordmerk, hexagon-logo,
géén oranje. Single-file, inline CSS/JS, Nederlandse teksten.

## Roadmap (kort)
- ~~Fase 1: JSON-opslag vervangen door een eigen PostgreSQL-database (los van CRP).~~ **Klaar 15-08-2026.**
- Fase 2 (klein, nog te doen): `index.html` de lijst `V` uit `GET /api/vehicles` laten laden, met de
  hardcoded lijst als fallback. Daarna is de catalogus alleen nog in de database te beheren.
- Fase 3: automatische instroom van "Komende auto's" uit het Autoboek (Google Sheet) — de sync hoeft
  dan alleen nog rijen te upserten in `vehicles`.
- ~~Back-up van `/var/pvp/uploads`.~~ **Klaar 15-08-2026** (stap A: nachtelijke momentopnamen).
- ~~Foto's verkleinen bij het uploaden.~~ **Klaar 16-08-2026.**
- **Nog te regelen (open): een kopie van de back-ups buiten de droplet.** Stap B uit
  `PVP-uploads-backup-voorstel.md`: `restic` naar **Backblaze B2, regio EU Central (Amsterdam)** —
  bewust een andere leverancier dan DigitalOcean, want anders staan server en back-up in hetzelfde
  account. Wacht op bucket + sleutels (Vince regelt dit 17-08-2026) en op een plek buiten de server
  voor het restic-wachtwoord. **Tot die er is, betekent verlies van de droplet verlies van alle foto's.**
- Klein & optioneel: nginx no-cache header voor `/` en `/index.html`.
- Bekend, buiten Fase 1 gelaten: nginx serveert `/uploads/` rechtstreeks met `alias`, dus de
  auth-controle in `serveUpload()` wordt in productie overgeslagen — wie een URL kent, kan het bestand
  zonder inloggen ophalen.
