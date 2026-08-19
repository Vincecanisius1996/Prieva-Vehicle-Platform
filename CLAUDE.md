# CLAUDE.md — Prieva Vehicle Platform (PVP)

Dit bestand is context voor Claude Code. Lees dit eerst voordat je wijzigingen maakt.
Antwoord en commit-berichten in het **Nederlands**. De UI van PVP is volledig Nederlands.

## Wat is PVP
Intern platform van Prieva B.V. (autobedrijf) om de doorloop van ingekochte/geïmporteerde auto's
te volgen: van "komend" → binnengekomen → import/BPM-traject → foto's → advertentie → verkoopklaar →
verkocht. In de app: de pagina's Komende, Lopende en Verkocht.
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
  De kolom `vehicles.sort_order` (nu 0–19, met de hand gezet bij de migratie) bepaalt de volgorde die
  `/api/vehicles`, `/api/state` en `/api/status` teruggeven — en dus de volgorde op het scherm.
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
- **Niet in de repo, met opzet:** `/var/pvp/pg.env`, `/var/pvp/restic.env`, `/var/pvp/secret`,
  `/var/pvp/autoboek.env`, `/var/pvp/autoboek-sleutel.json`,
  `/var/pvp/uploads`, de JSON-back-ups en alles wat `.gitignore` uitsluit.

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
`/api/status` (elke rol), `/api/vehicles` (elke rol, alleen-lezen catalogus — de frontend laadt hier `V`
uit), `/api/photo` (team+admin), `/api/adphotos` + `/api/adphoto` +
`/api/adphotos-set`, `/api/taxstate` (taxateur+team+admin), `/api/bpmreports`, `/api/bpmreport`,
`/api/bpmnotif-seen`, `/api/bpmreport-del`, `/api/vehicle` (team+admin, nieuwe auto),
`/api/vehicle-del` (**alleen admin**), `/api/vehicledoc`, `/api/uitlezen`, `/api/autoboek-retry`,
`/api/verkoop-bevestigen` + `/api/verkoop-terug` (**alleen admin**), `/api/binnengekomen`,
`/uploads/*` (auth).
Auth = HMAC-ondertekende cookie (stateless).

**Uitzondering: `/api/verkocht`** neemt twee soorten toegang aan: een **bearer-token** uit
`/var/pvp/verkoop.env` (`PVP_VERKOOP_TOKEN`, chmod 600, **niet committen**) voor een ander systeem
(straks Mobilox), óf een gewone sessie van `team`/`admin` — dat is de knop **Verkocht melden** in de
app. Bewust hetzelfde endpoint, zodat er maar één set regels is rond idempotentie en vastleggen. Zonder token ingesteld geeft het endpoint **503** — uit staan is nooit
hetzelfde als vrije toegang. Het zet een auto op `gemeld verkocht`; een beheerder bevestigt daarna in
de app, en pas dán verhuist de regel in het Autoboek. Elke melding, ook een mislukte, komt in de tabel
`verkoop_meldingen`.

## Lokaal testen (voordat je deployt)
Er staat een testdatabase `pvp_test` klaar (zelfde rol `pvp_app`; `pg_hba` staat beide toe). De backend
kan de frontend zelf serveren en luistert op de poort uit `PVP_PORT`, zodat de live service op 3000
ongestoord doordraait:
```
set -a; . /var/pvp/pg.env; set +a
export PVP_PG="${PVP_PG%/pvp}/pvp_test"            # let op: alleen de databasenaam achteraan vervangen
psql "$PVP_PG" -f /opt/pvp-api/schema.sql          # schema (idempotent)
node setpw.js testteam team "testpw" "Test team"   # testaccount in pvp_test
PVP_DATA=/tmp/pvptest PVP_FRONTEND=<pad> PVP_PORT=3001 node server.js
# dan: http://127.0.0.1:3001/
```
Hier stond eerder `${PVP_PG/\/pvp/\/pvp_test}`. Dat is fout: die vervangt de **eerste** `/pvp` in de
DSN, en dat is de `//pvp_app` van de gebruikersnaam — je krijgt dan `pvp_test_app` en een
`pg_hba`-foutmelding die niets met je wijziging te maken heeft.

Testdatabase leegmaken kan met `TRUNCATE vehicles, global_todos, activity_log, bpm_reports, bpm_notifs, meta;`.
Er staat **geen browser** op de droplet. Wat wél werkt (gebruikt bij Fase 2, 17-08-2026): `jsdom` in de
scratchpad installeren en de echte `index.html` daarin laden tegen de testserver. Twee valkuilen:
`fetch` en `scrollTo` moeten via `beforeParse` gezet worden — de scripts draaien al tijdens het opbouwen
van de DOM, dus zet je ze erna, dan valt `boot()` terug op de demo-modus en test je niets. En `const`/
`let` op het hoogste niveau staan niet op `window`; lees ze uit met `window.eval('V')`.
Zet in de testdatabase een catalogus die **afwijkt** van de terugvallijst in `index.html`, anders
bewijst een geslaagde test niets.
Controleer bij frontend-wijzigingen minimaal: geen JS-fouten in de console, en de rol-flows (team,
admin, foto, taxateur).

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

Pushen **vanaf de droplet** kan sinds 17-08-2026: `origin` staat op SSH
(`git@github.com:Vincecanisius1996/Prieva-Vehicle-Platform.git`) met de sleutel `~/.ssh/id_ed25519_pvp`,
geregistreerd als **deploy key met schrijfrechten** op alleen deze repo — niet op het GitHub-account, zodat
een gecompromitteerde droplet niet meteen bij alle repo's kan. Verbinding testen: `ssh -T git@github.com`
(verwacht: `Hi Vincecanisius1996/Prieva-Vehicle-Platform!`). De privésleutel staat alleen op de server en
hoort **niet** in de repo. Vervangen? Nieuwe sleutel maken, publieke helft in GitHub → Settings → Deploy
keys (mét "Allow write access"), oude verwijderen.

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
Wat er **niet** in zit: `/var/pvp/uploads` (zie hieronder) en `/var/pvp/secret`. Die twee gaan wél mee
in de kopie naar Backblaze, verderop.

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

**Dit is stap A** uit `PVP-uploads-backup-voorstel.md` en beschermt tegen per ongeluk verwijderen — niet
tegen het kwijtraken van de droplet, want deze momentopnamen staan op dezelfde schijf. Daarvoor is de
kopie naar buiten (hieronder).

## Kopie buiten de droplet (Backblaze B2, Amsterdam)
Stap B, klaar 17-08-2026. `pvp-offsite.timer` draait elke nacht om 03:00 UTC
`/usr/local/bin/pvp-offsite.sh`: `restic` stuurt twee momentopnamen naar de bucket
`Prieva-Vehicle-Platform` op `s3.eu-central-003.backblazeb2.com`.

- tag `db` — een verse `pg_dump` via stdin, als **onversleutelde SQL**. Bewust niet het gzip-bestand
  van `pvp-backup.sh`: platte SQL laat `restic` dedupliceren, terwijl een gzip elke nacht volledig
  verandert en dus elke nacht de volle omvang kost.
- tag `bestanden` — `/var/pvp/uploads`, plus `secret`, `pg.env`, `/opt/pvp-api`, de nginx-config en de
  PVP-scripts en -units. `restic.env` zit er bewust **niet** in: het wachtwoord waarmee je de kluis
  opent hoort niet in de kluis.

Bewaartermijn 14 dagelijks / 8 wekelijks / 12 maandelijks, per tag apart (`--group-by tags`), anders
duwen de twee reeksen elkaar uit de termijn. Elke nacht wordt **1/30 van de data echt teruggedownload
en nagerekend** (`check --read-data-subset`); over een maand is daarmee alles gecontroleerd, en het
dataverkeer blijft binnen de gratis marge van B2. Een back-up die je nooit uitleest is een aanname.

**`restic` versleutelt lokaal**, dus Backblaze ziet alleen blokken zonder betekenis — kentekenbewijzen
en vrijwaringen liggen niet leesbaar bij een externe partij. Regio EU Central i.v.m. de AVG, en bewust
een andere leverancier dan DigitalOcean: een back-up in hetzelfde account overleeft het verlies van dat
account niet.

Instellingen staan in **`/var/pvp/restic.env`** (chmod 600, `RESTIC_REPOSITORY`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `RESTIC_PASSWORD`), ingeladen via `EnvironmentFile=`. **Nooit committen.**
De Backblaze-sleutel is beperkt tot alleen deze bucket, niet de master key.

> **Zonder `RESTIC_PASSWORD` is er niets terug te zetten** — door niemand, ook niet door Backblaze.
> Een kopie hoort in een wachtwoordkluis buiten deze server. Ligt die er niet, dan beschermt deze
> back-up tegen niets.

Terugzetten (getest op 17-08-2026: 244 bestanden byte-voor-byte identiek, database met gelijke
rijaantallen én gelijke inhoud):
```
set -a; . /var/pvp/restic.env; . /var/pvp/pg.env; set +a
export RESTIC_CACHE_DIR=/var/cache/restic     # systemd geeft geen $HOME; met de hand dus zelf zetten
restic snapshots                                        # wat is er?
restic restore latest --tag bestanden --target /tmp/x    # eerst naar een tijdelijke map kijken
restic dump latest --tag db pvp.sql | psql "$PVP_PG"     # database
```
Het script **initialiseert nooit zelf een repository**: een timer die stilletjes een lege repository
aanlegt, verbergt een verkeerde bucket of sleutel achter een geslaagde back-up van niets. Bij een
nieuwe server dus eerst met de hand `restic init`, en de timer pas aan als `restic cat config` werkt.

**Nog open: onveranderlijkheid.** Verwijderen in de bucket werkt (getest), dus Object Lock is niet
actief. Goed voor het opruimen, maar het betekent dat wie root op de droplet krijgt óók de
Backblaze-sleutel heeft en de back-ups kan wissen. Zie `PVP-uploads-backup-voorstel.md` voor de
afweging; echte onveranderlijkheid vraagt een sleutel zonder verwijderrecht plus een tweede,
losstaande opruimtaak.

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

## HEIC-foto's (Mac en iPhone)
Sinds 19-08-2026 zet `server.js` HEIC bij binnenkomst om naar JPEG. Zonder dat bleef een foto die
vanaf een Mac werd geüpload een **leeg vak** in de app, en het uitlezen sloeg het bestand stil over.

Waarom het per computer verschilde, en dus lang op een spookfout leek:
- **Windows** levert jpeg — daar speelt het niet.
- **Safari** kan HEIC decoderen, dus `verkleinFoto()` in de browser maakte er al jpeg van.
- **Chrome en Firefox op de Mac** kunnen het niet. `verkleinFoto()` valt dan terug op het origineel
  (zo bedoeld: verkleinen mag nooit een upload kosten), en het HEIC-bestand belandde ongewijzigd op
  schijf. Chrome kan het vervolgens ook niet **tonen** — vandaar het lege vak. nginx maakte het erger:
  `.heic` staat niet in `mime.types`, dus het ging als `application/octet-stream` de deur uit.
- De Claude API kent alleen jpeg/png/gif/webp, dus `blok()` in `uitlezen/` gaf `null` en het stuk
  verdween in `overgeslagen` — precies een kentekenbewijs waar de gegevens op staan.

Hoe het nu werkt:
- Herkennen gebeurt op de **inhoud** (`ftyp`-merk in de eerste 12 bytes), niet op het opgegeven type:
  Firefox op de Mac geeft een `.heic` mee als `application/octet-stream` of zonder type.
- Omzetten met **`heif-convert`** (systeempakketten `libheif-examples` + `libheif-plugin-libde265`,
  geen npm). Zonder die plug-in geeft libheif "Unsupported codec" en gebeurt er niets.
- Drie plekken delen dezelfde omzetting: `saveDataUrl` (foto's), `saveFile` (documenten, BPM) en
  **`/api/uitlezen`** — dat laatste is nodig omdat de stukken daar rechtstreeks uit de browser komen
  en niet van schijf, dus de omzetting bij het opslaan helpt er niet.
- **Mislukt de omzetting, dan wordt het origineel bewaard** als `.heic`, met een regel in het logboek.
  Zelfde regel als bij het verkleinen: een upload mag er nooit door verloren gaan.
- Er wordt bewust **niet verkleind**: `heif-convert` kan dat niet, en libvips ervoor installeren sleept
  poppler en librsvg mee. Een omgezette foto is daardoor groter dan `FOTO_MAX` toestaat (~3 MB bij
  4032 px). Kwaliteit 90 is gekozen omdat het model er chassisnummers uit moet lezen.
- De twee HEIC-bestanden die er al lagen zijn omgezet en de URL's in `photos` bijgewerkt; de originelen
  blijven als wees liggen tot de nachtelijke opruimer ze naar de prullenbak verplaatst.

**Blijft staan:** in de bak "Meerdere foto's tegelijk" en bij de documentenlijst toont de browser het
bestand vóór het uploaden uit zijn eigen geheugen. Een HEIC is daar nog steeds een leeg miniatuurtje —
de server heeft het dan nog niet gezien. Na het uploaden klopt het beeld wel.

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
- **De catalogus komt uit de database** (sinds 17-08-2026, Fase 2): `loadVehicles()` in `index.html`
  haalt hem op uit `GET /api/vehicles` en vervangt `V` **in place** (`V` is `const` en wordt op ~39
  plekken bij naam gebruikt — nooit herwijzen). Auto's toevoegen of wijzigen doe je dus in de tabel
  `vehicles`, niet in `index.html`. De lijst `const V = [...]` staat er nog als **terugvallijst** voor
  als de API wegvalt of de app zonder backend draait; die is bevroren op 12-08-2026 en loopt dus achter.
- **`loadVehicles()` moet vóór `loadState()`/`loadTaxState()`/`loadStatusFoto()` draaien** — die
  mappen hun gegevens op bestaande rijen in `V`. Daarom staat `await loadVehicles()` bovenaan
  `startFor()`, boven de rolsplitsing.
- **De statussen zijn `komende`, `lopende`, `gemeld verkocht` en `verkocht`.** `putState()` schrijft de
  statuskolom **niet** zolang de database een van de laatste twee zegt. Zonder dat slot zet een tabblad
  dat nog openstond van vóór de melding de auto met de eerstvolgende klik terug op `lopende` — de
  frontend stuurt namelijk zijn hele geheugen op. `stateOk` helpt daar niet tegen: dat inlezen ging
  goed, de gegevens zijn alleen verouderd.
- **`stateOk` bewaakt het opslaan.** `scheduleSave()` schrijft pas als `loadState()` gelukt is. Zonder
  dat slot zou een mislukte `GET /api/state` (backend-herstart, nginx-hik) ertoe leiden dat de
  eerstvolgende klik de beginwaarden van `V` over de database heen zet: alle lopende auto's terug naar
  komende, keuringsfoto's en subtaken weg. Haal die controle er dus niet uit.
- **Een auto verwijderen raakt het Autoboek niet.** `/api/vehicle-del` haalt de auto uit PVP en geeft
  het rijnummer terug; die regel haal je met de hand weg. Bewust: verwijderen is een correctie op een
  vergissing, geen stap in het proces. Een auto die écht verkocht is loopt via de verkoopbevestiging,
  en dáár verplaatst PVP de regel wél zelf.
- **Merken in het Autoboek: één schrijfwijze per merk** (19-08-2026). Het boek was met de hand gevuld
  en telde **73 schrijfwijzen voor 31 merken** — `PEU` 48× naast `Peugeot` 12×, `CITR` 22× naast
  `Citroen` 15×, en zestien cellen met een spatie erachter (`"Peugeot "` is voor een draaitabel een
  ander merk dan `Peugeot`). In 307 cellen gelijkgetrokken naar de volledige merknaam; nu 31 vormen.
  De tabel staat in **`autoboek/merken.js`** en zit op het schrijfpad via `merkNotatie()`, dus alles
  wat PVP voortaan wegschrijft is meteen goed. Onbekend merk = met rust laten, niet raden.
  - **`Citroen` en `Skoda` blijven zonder trema en háček.** Die tekens zijn voor een tekstvergelijking
    een ánder teken en zouden precies het probleem terugbrengen; het boek schrijft ze al jaren zo.
    In PVP zelf staat wél `Citroën` — de omzetting zit alleen op het schrijfpad naar het boek.
  - Verschil in hóófdletters is voor Power BI onschuldig (tekstvergelijking is daar
    hoofdletterongevoelig), maar is meegenomen omdat half opruimen slechter leest.
  - **`Bandenlijst` blijft erbuiten:** daar is kolom G de profieldiepte en staat het bandenmerk in
    kolom A. `Blad5` doet wél mee — dat heeft dezelfde kolomindeling en 45 regels met merken.
  - Vooraf gecontroleerd dat geen enkele van de 16 formules in het werkboek op een merknaam als tekst
    matcht, en achteraf dat alleen kolom G veranderde. Script: `inhaalslag/merken-gelijktrekken.js`,
    kopie van vóór de wijziging in `/var/backups/pvp/autoboek/`.
- **Het Autoboek: kolomstructuur nooit wijzigen.** `Autoboek PRIEVA.xlsx` (Drive, map `Autoboek`,
  bestands-ID `1MnSN9PJjzJTEp4aLwhyjKeH-h4-wb3if`) voedt een Power BI-rapportage. Verandert er een
  kolom, een kop of de volgorde, dan loopt die vast. Het moet ook een **.xlsx blijven** — omzetten
  naar een Google Sheet is daarom uitgesloten. **Regels toevoegen én verwijderen mag** (18-08-2026,
  overlegd met de bouwer van de rapportage); alleen de kolommen zijn onaantastbaar. PVP schrijft nu op
  *Komende Autos* (nieuwe auto) en verplaatst regels in drie richtingen: **Komende → Lopende** (auto
  afgevinkt als binnen), **Lopende → Verkochte** (verkoop bevestigd) en **Verkochte → Lopende** (per
  ongeluk bevestigd). Alle drie via dezelfde functie met dezelfde controles; de kolomindeling per paar
  staat in `autoboek/index.js` bij `RICHTING`. De koppeling zit in `autoboek/` (draait mee in `/opt/pvp-api/autoboek/`);
  instellingen in `/var/pvp/autoboek.env` (chmod 600, **niet committen**), sleutel in
  `/var/pvp/autoboek-sleutel.json`. `AUTOBOEK_FILE_ID` leeg = koppeling uit. Staat sinds 19-08-2026 op
  het **echte boek**. Het ID van de kopie staat er nog als commentaarregel boven, zodat terugzetten
  naar de kopie een kwestie is van die twee regels omwisselen plus `systemctl restart pvp-api`.
  Zie `autoboek/LEESMIJ.md` en `PVP-autoboek-koppeling-voorstel.md`.
- **Geen npm-afhankelijkheden in de backend** toevoegen tenzij expliciet afgesproken. `pg` is de enige
  toegestane uitzondering (een DB-driver kan niet puur-Node).
- **Eén verbetering per keer**, en test rol-flows voordat je live zet.

## Stijl
PRIEVA-huisstijl: font Montserrat, blauwverloop `#0D9EBF → #056A7F`, zwart woordmerk, hexagon-logo,
géén oranje. Single-file, inline CSS/JS, Nederlandse teksten.

## Roadmap (kort)
- ~~Fase 1: JSON-opslag vervangen door een eigen PostgreSQL-database (los van CRP).~~ **Klaar 15-08-2026.**
- ~~Fase 2: `index.html` de lijst `V` uit `GET /api/vehicles` laten laden, met de hardcoded lijst als
  fallback.~~ **Klaar 17-08-2026.** De catalogus is nu alleen nog in de database te beheren.
- ~~Fase 3: automatische instroom van "Komende auto's" uit het Autoboek.~~ **Klaar 17-08-2026, maar
  andersom dan hier stond.** Bij het uitzoeken bleek de wens omgekeerd: PVP is het invoerpunt geworden
  en schrijft de regel weg naar het Autoboek, in plaats van hem eruit te lezen. Inclusief het
  automatisch uitlezen van de inkoopstukken (`uitlezen/`). Zie `PVP-autoboek-koppeling-voorstel.md`.
- ~~Back-up van `/var/pvp/uploads`.~~ **Klaar 15-08-2026** (stap A: nachtelijke momentopnamen).
- ~~Foto's verkleinen bij het uploaden.~~ **Klaar 16-08-2026.**
- ~~Een kopie van de back-ups buiten de droplet (stap B).~~ **Klaar 17-08-2026:** `restic` naar
  Backblaze B2, EU Central. Zie "Kopie buiten de droplet" hierboven.
- **Deels geregeld: het restic-wachtwoord buiten de server.** Stand 17-08-2026: er ligt een kopie in
  de persoonlijke notities van Vince, en een Bitwarden-kluis wordt aangemaakt. Nog te doen:
  1. **Controleren dat de kopie klopt.** Een tikfout is erger dan geen kopie: je denkt dat je gedekt
     bent. De vingerafdruk van het wachtwoord op de server is `45290ceac242` (eerste 12 tekens van de
     sha256) en het telt 44 tekens. Toetsen kan zonder het ergens te tonen:
     `printf '%s' '<kopie>' | shasum -a 256 | cut -c1-12`.
  2. **Een tweede persoon toegang geven** (Floris), via de Bitwarden-kluis. Nu kan alleen Vince erbij;
     bij vakantie, ziekte of verlies van zijn Apple-account kan niemand terugzetten.
  3. **Erbij zetten waar het bij hoort:** restic, Backblaze B2, bucket `Prieva-Vehicle-Platform`,
     `s3.eu-central-003.backblazeb2.com`, herstelinstructies in dit bestand. Een reeks tekens zonder
     context zegt over een jaar niets meer.

  Ter geruststelling: het restic-wachtwoord is het **enige onvervangbare**. De Backblaze-sleutel en de
  bucketnaam zijn opnieuw te maken vanuit het B2-account, en dit bestand staat in GitHub en overleeft
  de droplet dus sowieso.
- Open, afweging nodig: **onveranderlijkheid van de bucket.** Verwijderen werkt nu, dus wie root op de
  droplet krijgt kan met de Backblaze-sleutel ook de back-ups wissen.
- ~~nginx no-cache header voor `/` en `/index.html`.~~ **Klaar 17-08-2026** — een oude pagina uit de
  browsercache kostte een avond zoeken naar een fout die er niet was.
- **Vervolgstap, besloten uit te stellen op 17-08-2026:** wat er in het Autoboek moet gebeuren als een
  auto in PVP wordt afgevinkt als binnen. Hij hoort dan van *Komende Autos* naar *Lopende Autos*, maar
  dat betekent dat PVP regels zou moeten kunnen verwijderen — nu is de koppeling strikt
  alleen-toevoegen. Drie richtingen en de afweging staan in `PVP-autoboek-koppeling-voorstel.md`.
- ~~Inhaalslag: de auto's van *Lopende Autos* overnemen in PVP.~~ **Grotendeels klaar 19-08-2026** —
  32 van de 52 ontbrekende auto's zijn geïmporteerd; zie `inhaalslag/LEESMIJ.md`. Belangrijkste
  bevinding: **de zeven stapkolommen AW–BC in het Autoboek zijn leeg**, dus de fase is daar niet uit
  over te nemen. Alleen het kenteken is een hard signaal — dat bestaat niet vóór RDW-goedkeuring en
  BIN. **Nog te doen:** 15 auto's zonder kenteken en 5 regels van vóór april, met de hand.
- Bekend gat: **PVP schrijft alleen bij het aanmaken naar het Autoboek.** Latere wijzigingen aan een
  auto komen daar niet in terecht.
- **Zwaarder geworden op 17-08-2026: `/uploads/` staat open.** nginx serveert die map rechtstreeks met
  `alias`, dus de auth-controle in `serveUpload()` wordt overgeslagen. Nagemeten: een fotoURL geeft via
  nginx `200` zonder cookie, terwijl de backend op dezelfde URL `401` geeft. De bestandsnamen bevatten
  12 willekeurige tekens en zijn dus niet te raden, maar een gelekte URL (mail, appje,
  browsergeschiedenis) is genoeg. Sinds vandaag liggen daar ook **koopovereenkomsten met
  persoonsgegevens van particuliere verkopers**, en dat maakt dit van een schoonheidsfout een
  AVG-punt. Op te lossen met `auth_request` naar de backend, of door `/uploads/` via `serveUpload()`
  te laten lopen in plaats van via `alias`.
- **Geen enkele auto is in PVP te wijzigen.** Toevoegen kan, verwijderen kan, maar een verkeerd veld
  corrigeren niet — daarvoor moet je nu de database in. Dat wringt sinds PVP het invoerpunt is.
