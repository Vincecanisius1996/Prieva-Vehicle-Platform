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
- `agenda/` — de koppeling met de Google-agenda van Prieva (draait mee in `/opt/pvp-api/agenda/`).
  Zie `agenda/LEESMIJ.md`.
- `mobilox/` — de agent die Mobilox uitleest (draait mee in `/opt/pvp-api/mobilox/`, mét een eigen
  `node_modules` voor playwright). Zie `mobilox/LEESMIJ.md`.
- `pg/` — archief van de Postgres-migratie, alleen nog `import-json.js` + `package*.json`. Zie
  `pg/LEESMIJ.md`. De kopieën van `server.js`/`setpw.js`/`schema.sql` die hier stonden zijn weg;
  twee exemplaren van hetzelfde bestand lopen uiteen en dan weet niemand meer welke geldt.
- In de repo staan historische `index_N.html`-kopieën en een bestand `server.js update`; die zijn
  van vóór deze opschoning en niet meer in gebruik. Bron van waarheid is `index.html`.
- **Niet in de repo, met opzet:** `/var/pvp/pg.env`, `/var/pvp/restic.env`, `/var/pvp/secret`,
  `/var/pvp/autoboek.env`, `/var/pvp/autoboek-sleutel.json`, `/var/pvp/verkoop.env`,
  `/var/pvp/mobilox.env`, `/var/pvp/mobilox-sessie.json`, `/var/pvp/agenda.env`, `/var/pvp/ai.env`,
  `/var/pvp/uploads`, de JSON-back-ups en alles wat `.gitignore` uitsluit.

## Rollen (server dwingt af)
- `team` — volledige app.
- `admin` — team + 📜 Logboek (activiteitenlog). Accounts: `vince`, `floris`.
- `foto` — alleen advertentiefoto's uploaden. Account: `fotograaf`.
- `carport` — eigen planningsomgeving (sinds 20-08-2026). Account: `carport`. Ziet **alleen de auto's
  op zijn eigen planning**: `/api/vehicles` is voor deze rol ingeperkt tot auto's met een werkbon, en
  `/api/state`, `/api/taxstate` en `/api/bpmreports` zijn dicht.
- `taxateur` — eigen S-TAX-portaal: alleen auto's op taxatie (route=JA) **zonder kenteken**,
  RDW/papieren-foto's bekijken/downloaden, BPM-taxatierapport uploaden/verwijderen. Account: `s-tax`.
  **Een auto met een kenteken kan niet meer getaxeerd worden** — dat kenteken bestaat pas na
  RDW-goedkeuring en BIN, en dan is de BPM afgehandeld. Sinds 20-08-2026 filtert **`/api/taxstate`
  die auto's er serverzijdig uit** voor de rol taxateur (team en admin krijgen nog alles). Alleen in
  beeld verbergen was niet genoeg: dan gingen de foto's nog steeds over de lijn. Op de dag van die
  wijziging scheelde dat 31 → 14 auto's; de 17 die eruit vielen stonden alle zeventien al op
  Verkoopklaar, zonder één taxatierapport.
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
`PUT /api/vehicle` (team+admin, auto corrigeren), `/api/inruil` (GET+POST, team+admin),
`/api/carport-afgeleverd` (**alleen team+admin**),
`/api/vehicle-del` (**alleen admin**), `/api/vehicledoc`, `/api/uitlezen`, `/api/autoboek-retry`,
`/api/verkoop-bevestigen` + `/api/verkoop-terug` (**alleen admin**), `/api/binnengekomen`,
`/uploads/*` (auth).
Auth = HMAC-ondertekende cookie (stateless).

**Uitzondering: `/api/verkocht` en `/api/vehicle`** nemen twee soorten toegang aan: een
**bearer-token** uit `/var/pvp/verkoop.env` (`PVP_VERKOOP_TOKEN`, chmod 600, **niet committen**) voor
de Mobilox-koppeling, óf een gewone sessie. Bewust hetzelfde endpoint als de app gebruikt, zodat er
maar één set regels is rond idempotentie, dubbelcontrole en het Autoboek. Zonder token ingesteld geeft
`/api/verkocht` **503** — uit staan is nooit hetzelfde als vrije toegang.

**De regel in één zin** (opgave Prieva, 25-08-2026): *een verkoopovereenkomst zegt dat de auto verkocht
is en wanneer hij afgeleverd wordt; de auto gaat pas op **verkocht** als er een **factuurnummer** voor
is aangemaakt.* Daar hangt alles aan vast — de afleverdatum en de taken komen uit de overeenkomst, de
verhuizing naar *Verkochte* in het Autoboek gebeurt op de factuur.

Wat `/api/verkocht` doet hangt af van het soort document (23-08-2026):
- **verkoopovereenkomst** → `gemeld verkocht`. Die kan nog wijzigen of vervallen; het Autoboek blijft
  ongemoeid.
- **factuur** (`definitief:true`) → meteen `verkocht`, én de regel verhuist in het Autoboek van
  *Lopende* naar *Verkochte*. Een factuur is een verkoop die rond is; wachten op een handmatige
  bevestiging betekende in de praktijk dat PVP en het boek achterliepen.
- Met `vervangt:true` mag een factuur het nummer uit de overeenkomst overschrijven, maar alleen zolang
  de verkoop nog niet bevestigd is.

**`/api/verkoop-bevestigen` weigert zonder factuurnummer** (25-08-2026): staat er geen nummer, of komt
het uit een overeenkomst (`verkoop_bron='overeenkomst'`), dan volgt **409** met `nummerNodig:true`. De
app vraagt er dan om. Zonder die grens kon een beheerder een auto met een overeenkomstnummer op
*verkocht* zetten — en dan verhuisde de regel te vroeg naar *Verkochte*, met een nummer dat botste
met een echte factuur. Zo stonden 176, 180 en 182 dubbel in het boek.

`definitief` mag alleen via het token of door een **admin**; een `team`-sessie krijgt **403**. Melden en
bevestigen blijven twee handelingen met twee verantwoordelijkheden. Terugdraaien kan met
`/api/verkoop-terug` (alleen admin), dat de regel ook in het boek terugzet. Elke melding, ook een
mislukte, komt in de tabel `verkoop_meldingen`.

**`soort` bepaalt of het nummer in het Autoboek mag** (25-08-2026). Mobilox telt verkoopovereenkomsten
en facturen **elk apart vanaf 1**: overeenkomst 182 en factuur 182 bestaan allebei en zijn
verschillende auto's. Daarom:
- `vehicles.verkoop_bron` legt vast waar het nummer vandaan komt (`overeenkomst` | `factuur`);
- bij het verplaatsen naar *Verkochte* wordt de kolom **Fact. Nr. alleen gevuld met een factuurnummer**.
  Een overeenkomstnummer staat wél in PVP, maar niet in het boek — daar zou het botsen;
- een **factuur mag een overeenkomstnummer altijd vervangen**, ook als de verkoop al bevestigd is; dan
  wordt alleen de cel Fact. Nr. bijgewerkt (`wijzigAuto`), want verplaatsen kan dan niet meer. Een
  factuurnummer over een ánder factuurnummer heen blijft **409**.

Dit is niet theoretisch: op 25-08-2026 stonden 176, 180 en 182 elk twee keer in het boek — één keer als
factuur uit maart, één keer als overeenkomstnummer dat PVP er in augustus bij schreef.

`/api/vehicle` zoekt bij het aanmaken op de **genormaliseerde** VIN en kenteken, niet alleen op het id:
Mobilox schrijft `kv115l` waar PVP `KV-115-L` heeft. Op het oog twee sleutels, dezelfde auto — en een
dubbele regel in de catalogus werkt door naar het Autoboek en naar Power BI.

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

## Uploads achter de sessie (X-Accel-Redirect)
Sinds 26-08-2026. nginx serveerde `/uploads/` rechtstreeks van schijf met een `alias`, waardoor de
controle in `serveUpload()` werd overgeslagen: **een BPM-rapport gaf `200` zonder cookie**, gemeten op
de live server. In dezelfde map liggen koopovereenkomsten met persoonsgegevens van particuliere
verkopers. De namen zijn 12 willekeurige tekens en dus niet te raden, maar een gelekte URL is genoeg —
en dat maakte het een AVG-punt.

Hoe het nu loopt:
- `location /uploads/` **proxyt naar de app**; `location /intern-uploads/` is `internal` en heeft de
  `alias` naar `/var/pvp/uploads/`. Van buiten geeft dat pad **404**.
- `serveUpload()` controleert de sessiecookie en antwoordt met een lege body plus
  **`X-Accel-Redirect: /intern-uploads/<pad>`**. nginx levert het bestand daarna zelf af.
- **Node stuurt dus geen bytes.** Alleen de cookiecontrole (stateless HMAC, geen database) raakt de
  app; een autopagina met vijftig foto's blijft snel. `Cache-Control: private, max-age=300` blijft.
- **`Content-Type` komt uit de `MIME`-tabel in `server.js`**, niet van nginx: `.heic` staat niet in
  `mime.types` en ging daardoor als `application/octet-stream` de deur uit. Nu `image/heic`.
- Twee sloten op het pad: de bestaande `..`-controle, plus `path.resolve()` met de eis dat het
  resultaat binnen `UPLOAD_DIR` valt. Getoetst met `../`, `%2e%2e%2f` en `%00` — allemaal 400/404.
- `HEAD` wordt naast `GET` afgehandeld.

**Elke geldige sessie is genoeg**; er wordt niet op rol of op auto gefilterd. Dat is een bewuste
tussenstap: het gat is dicht, en fijnmazige toegang (een taxateur alleen zijn eigen auto's) hangt aan
`vehicles`/`bpm_reports` en is een volgende stap.

Nagemeten bij de omzetting: alle **261** upload-URL's uit de database geven `200` mét sessie en
`401` zonder. De configuratie staat als kopie in `beheer/nginx-default.conf`; het CRP-blok is een
apart bestand en is byte-voor-byte ongewijzigd gebleven.

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

**Slepen werkte niet** (25-08-2026, opgave Prieva). Twee dingen los daarvan, allebei nu gerepareerd:
- **Een fotovakje deed niets met een bestand van buiten.** `slotDrop()` keerde meteen terug als er geen
  interne sleep uit de bak liep — terwijl het vakje wél "sleep hierheen" als tooltip had. Je sleepte,
  er gebeurde niets, en er kwam geen melding. Nu gaat een gesleept bestand door dezelfde weg als de
  knop (`fotoNaarVakje`), en sleep je er meer dan één, dan gaat de eerste in het vakje en de rest naar
  de bak in plaats van weggegooid te worden.
- **De bak "Meerdere foto's tegelijk" was helemaal geen sleepzone.** De tooltip beloofde het, er zat
  geen `ondrop` op. Nu wel, met een stippellijn zodra je erboven hangt.
- **`accept="image/*"` grijst .heic uit** in het keuzevenster van Chrome op de Mac. De extensies staan
  er nu expliciet bij (`FOTO_ACCEPT` / `DOC_ACCEPT`), dus kiezen kan ook.
- Een bestand dat geen foto is wordt overgeslagen **met een melding**, niet stilzwijgend.

**Blijft staan:** in de bak "Meerdere foto's tegelijk" en bij de documentenlijst toont de browser het
bestand vóór het uploaden uit zijn eigen geheugen. Een HEIC is daar nog steeds een leeg miniatuurtje —
de server heeft het dan nog niet gezien. Na het uploaden klopt het beeld wel.

## Taxatierapporten uitlezen (`bpmlezen/`)
Sinds 19-08-2026 leest PVP een BPM-taxatierapport bij binnenkomst uit. Twee dingen komen eruit:

- **het VIN uit veld 1a** op pagina 1 (staat daar in losse hokjes, dus als losse tekens met spaties);
- **de datum van de fysieke opname** door de taxateur, twee regels onder die kop.

Daarmee kan de taxateur al zijn rapporten in één sleepbak gooien: PVP zoekt zelf de auto erbij
(`POST /api/bpmreport-sorteer`, één pdf per verzoek — zes van 10 MB tegelijk loopt tegen de 30 MB van
nginx aan). Getest op de acht rapporten die er lagen: **8 van de 8**, VIN en datum, en elk VIN kwam
uit bij de auto waar het rapport al aan hing.

- **Bewust geen AI.** Beide velden staan op een vaste plek in een vast formulier van de
  Belastingdienst. `pdftotext` is deterministisch, gratis en direct; een model dat een chassisnummer
  moet overtypen maakt daar fouten in — zie de kilometerstand van 18-08.
- **De pdf's zijn versleuteld** met een leeg wachtwoord (alleen rechtenbeperking). Zelf de streams
  uitpakken lukt daardoor niet; `pdftotext` gaat er wel doorheen. Systeempakket **`poppler-utils`**,
  geen npm. Ontbreekt het, dan zegt de service dat bij het opstarten en werkt uploaden gewoon door —
  alleen sorteren en de teller vallen weg.
- **Geldigheid: 29 dagen na de opname** (opgave Prieva 19-08-2026; de verzenddagen zijn er al vanaf
  getrokken). Op het formulier zelf staat *"niet meer dan 1 maand voor de datum van goedkeuring door
  de RDW"* — 29 dagen is de strengere praktijkregel. `BPM_GELDIG_DAGEN` staat in `index.html` en in
  `bpmlezen/index.js`; wijzig je het, wijzig het dan op allebei.
- Het verloopmoment ligt aan het **begin** van de dag, 29 dagen na de opname. Bewust niet aan het
  eind: een teller die te veel tijd belooft is erger dan een die een halve dag tekortkomt.
- Lukt het lezen niet, dan wordt het rapport **gewoon opgeslagen** met een lege opnamedatum en toont
  de teller "opnamedatum onbekend" in plaats van een verzonnen termijn. Een rapport mag nooit
  verloren gaan omdat het uitlezen faalt.
- Een rapport wordt **niet geweigerd** als de auto inmiddels op route NEE staat: het hoort bij de auto
  waar het VIN naar wijst. Weigeren zou het rapport laten verdwijnen.

## Skills (`.claude/skills/`)
Sinds 23-08-2026. Twee stuks, bedoeld om `CLAUDE.md` niet verder te laten uitdijen:
- **`pvp-ui`** — huisstijl, de bestaande bouwstenen (`.card`, `.bon`, `.taak`, `.dl`, `.badge`), en de
  gedragsregels: elke handeling omkeerbaar of met bevestiging, alleen tonen wat er mis is, verbergen
  in beeld is nooit genoeg zonder controle in het endpoint.
- **`pvp-testen`** — het jsdom-recept zonder browser, de vallen die tijd hebben gekost, en wat je
  minimaal doorloopt vóór een deploy.

## Taken per auto en de voortgangsring
Sinds 25-08-2026. Een auto heeft twee soorten taken: de **extra taken** die Prieva zelf toevoegt
(`vehicles.subtasks`) en het **werk op de Carport-bon** (`carport_taken`). `takenVan(id)` telt ze bij
elkaar op — één teller, want twee percentages voor dezelfde auto zet mensen aan het rekenen.

`takenRing(af, totaal)` tekent dat als een ringetje met `3/5` en `60%`, groen bij 100%. Hij staat op
vier plekken: de statuskolom op *Lopende*, de afleverkaarten op *Vandaag*, de werkbonnen bij *Carport*
en de kaart **Taken** op de auto zelf.

- **Afvinken kan zonder de auto te openen.** Op Vandaag klap je een aflevering open en vink je daar af;
  op de Carport-pagina staan de bonnen nu **dicht**, met de voortgang op de kop, en klap je open wat je
  nodig hebt. Bij twaalf bonnen met elk vijf regels was die pagina anders een lijst om in te zoeken.
- Op de auto zelf staan onder **Taken** eerst de eigen taken en daaronder het werk van de werkbon,
  allebei afvinkbaar. Dat werk stond eerder alleen op de Carport-pagina.
- De kaart verschijnt ook bij status `gemeld verkocht`: die auto is verkocht maar er wordt nog aan
  gewerkt, en juist dan wil je zien wat er nog ligt.

## Carport: werkbonnen en planning
Sinds 20-08-2026. Twee tabellen: `carport_bonnen` (één per auto die bij Carport staat) en
`carport_taken` (de regels: reparatie, APK, beurt, onderdeel). Notities staan als jsonb op de bon.

- **De deadline is afgeleid, niet ingevoerd:** gewenste afleverdatum min `CARPORT_MARGE_DAGEN` (2),
  zodat de auto daarna nog naar de poetser kan. Die constante staat in `server.js`; de frontend krijgt
  hem mee in het antwoord van `/api/carport` en rekent niet zelf.
- **De afleverdatum komt uit Mobilox** — de gewenste afleverdatum uit de verkoopovereenkomst. Sinds
  20-08-2026 haalt de Mobilox-agent hem op; sinds 23-08 houdt hij hem ook **elke ronde bij**, zodat een
  verzette aflevering binnen een kwartier op de planning staat. Met de hand invullen kan nog steeds,
  maar Mobilox wint: die datum is met de koper afgesproken. Het Autoboek is géén bruikbare tweede bron
  — gemeten op 20-08-2026 stond op *Lopende* bij 1 van de 66 auto's een verkoopdatum, en die lag in
  het verleden.
- **Sorteren:** op deadline, tenzij Carport zelf sleept. Dan krijgen álle open bonnen een nummer
  (`volgorde`), zodat er geen gaten of dubbele nummers ontstaan als twee mensen tegelijk schuiven.
  Een lege lijst naar `/api/carport-volgorde` zet alles terug op deadlinevolgorde.
- **Wie mag wat:** Carport werkt de planning af, voegt zelf werk toe en meldt auto's af. Alleen Prieva
  zet een auto óp de planning of haalt hem eraf. **Carport kan geen werk van Prieva weghalen** —
  alleen wat ze zelf hebben toegevoegd; dat staat per regel vast in `door`.
- **Afmelden en afleveren zijn twee dingen** (23-08-2026). Carport *meldt af* als het werk klaar is;
  Prieva *levert af* als de auto bij de klant staat. Daartussen zit soms een week. Vandaar drie bakken
  in `/api/carport`: `planning` (Carport werkt eraan), `afgemeld` (werk klaar, auto staat er nog) en
  `afgeleverd` (weg). Alleen team en admin kunnen afleveren — Carport kan niet weten of de klant is
  geweest; `/api/carport-afgeleverd` geeft die rol **403**.
  - Daarvóór bestond alleen "afgemeld", onder de naam *Afgeleverd*. Gevolg: een auto met een
    verstreken afleverdatum bleef eeuwig in de lijst staan omdat er geen knop was om hem eruit te
    halen — op 23-08 stonden er vier, waarvan één zes dagen over tijd. En zodra Carport afmeldde,
    verdween de aflevering van *Vandaag* terwijl de auto nog de deur uit moest. Het paneel op Vandaag
    telt nu `planning` én `afgemeld`.
  - **Beide zijn omkeerbaar** en beide logboeken worden nooit opgeschoond: het is voor beide partijen
    de plek om terug te kijken wat er is gedaan.
- **Notities zijn gescheiden in `technisch` en `klant`.** Carport schrijft de techniek, Prieva de
  vertaling richting de koper. Bewust twee soorten: monteurstaal hoort niet ongefilterd bij een klant
  terecht te komen.

## Wat is poetswerk en wat is werk voor Carport
`mobilox/taken.js` leidt de soort af uit de tekst van de overeenkomst. **De volgorde in `SOORT` is het
hele verhaal**: veel regels bevatten woorden uit twee soorten en de eerste die past, wint. Van
specifiek naar algemeen:

1. **schade** — `uitgedeukt|inlak|lakschade|bijtippen|steenslag|kras|revisie|richten`. Móét vóór poetsen
   en beurt: *"linkerzijde uitgedeukt … na polijstbeurt"* is plaatwerk, geen poetsbeurt.
2. **poetsen** — `poets|polijst|wassen|zuigen|reinig|schoonmaak|schoongemaak|stofferen|detailing`, plus
   *interieur én exterieur* in één zin. Let op **`schoongemaak`**: het woord in de overeenkomsten is
   "schoongemaakt" en dat matcht níét op "schoonmaak" — precies daardoor stond de interieur- en
   exterieurbeurt van de Opel Astra bij Carport in plaats van bij de poetser (25-08-2026).
3. **apk** — ná schade, want *"APK en lakschade herstellen"* is werkplaatswerk.
4. **onderdeel**, dan **beurt** (`beurt` zit óók in polijstbeurt, poetsbeurt en afleverbeurt), dan
   **reparatie** als vangnet.

`INFO` vangt regels die iets vertéllen in plaats van iets opdragen — *"verkoop onder
handelsvoorwaarden"*, *"de auto zit nog in een importproces"*. Die worden een **notitie** op de bon:
als taak vragen ze om een vinkje dat nooit gezet kan worden.

**Verslepen tussen Carport en de poetser.** Op de afleverkaart van Vandaag zijn de twee kolommen
sleepdoelen. Een regel naar de poetser slepen zet hem op `poetsen`, terugslepen op `reparatie`; binnen
dezelfde kolom slepen verandert niets, zodat een APK een APK blijft. Elke handmatige verplaatsing zet
`soort_hand`, en dáár blijft de agent vanaf.

## De Mobilox-koppeling draait elk kwartier
Sinds 23-08-2026 draait `pvp-mobilox.timer` **maandag t/m zaterdag, 07:00–18:45 Nederlandse tijd, elk
kwartier**. Daarvoor moest de agent met de hand gestart worden. De reden voor die frequentie is niet
de techniek maar het werk: Carport, de poetser en de verkoop kijken allemaal naar hetzelfde scherm, en
een verkoopovereenkomst die pas de volgende ochtend binnenkomt is een dag te laat.

De tijdzone staat **in de kalenderregel** (`OnCalendar=Mon-Sat *-*-* 07..18:00/15 Europe/Amsterdam`).
De server staat op UTC; zonder die tijdzone zou de koppeling in de winter een uur verschuiven ten
opzichte van de zaak.

`/usr/local/bin/pvp-mobilox.sh` draait twee stappen achter elkaar en faalt pas aan het eind:
1. `mobilox/agent.js --echt` — verkopen melden, afleverdata bijwerken, afspraken naar Carport;
2. `agenda/sync.js --echt` — de geplande afleveringen in de Prieva-agenda zetten.

Bewust twee losse stappen: de agenda moet ook bijgewerkt worden als Mobilox onbereikbaar is (iemand
kan in PVP zelf een datum hebben verzet), en een agenda die weigert mag het melden van een verkoop
niet tegenhouden.

**Elke ronde legt vast hoe het ging** in de tabel `agent_runs` (één regel per taak, telkens
overschreven; `gelukt_ts` bewaart apart de laatste *geslaagde* ronde). `/api/state` stuurt dat mee en
`agentBanner()` op Vandaag toont het — maar alléén als er iets mis is, en alleen tijdens de uren dat
de taak hoort te lopen. Een groen vinkje dat het goed gaat leest niemand; een melding dat het beeld
uren oud is wel. Een waarschuwing op zondagavond is ruis.

- **Een inruil is een feit, geen voorstel** (23-08-2026). Staat er een inruilauto op een
  verkoopovereenkomst, dan komt die auto bij de aflevering binnen. De agent maakt hem aan bij
  **Komende** en schrijft hem naar *Komende Autos* in het Autoboek, met leverancier `Inruil`, de
  inruilprijs als inkoopprijs en een notitie bij welke verkoop hij hoort. Alleen voor een inruil die
  nog niet in `mobilox_inruil` staat: wat daar al ligt is geschiedenis (128 regels uit 2026), en die
  auto's zijn allang binnen of alweer weg.
  - Mobilox geeft geen VIN bij een inruil en schrijft het kenteken zonder streepjes in kleine letters.
    `mobilox/inruil.js` zet dat om naar de Nederlandse groepering (`kentekenOpmaak`) — getoetst tegen
    alle 45 bestaande kentekens in PVP, die er allemaal identiek uit komen.
  - Het merk wordt overgenomen in de schrijfwijze die PVP zélf al gebruikt (`Citroen` uit Mobilox
    wordt `Citroën`), zodat er geen tweede variant van een merk in de catalogus ontstaat.
  - Model en uitvoering worden **niet** gesplitst: waar het model ophoudt is niet af te leiden, en een
    verkeerde gok is lastiger te herstellen dan een lange modelnaam.
- **Een 404 van `/api/verkocht` is geen storing.** Mobilox verkoopt ook auto's die nooit in PVP hebben
  gestaan (doorverkochte inruilers). Die tellen als `geen-auto`, niet als `mislukt` — anders staat de
  koppeling elke ronde als kapot op het scherm en kijkt niemand meer naar de melding die er wél toe doet.
- **De agent meldt op het PVP-id, niet op het VIN uit Mobilox.** Er staan auto's in PVP met een
  streepje in het VIN-veld (oude inruilers); die koppelen op kenteken, en dan wees het VIN uit Mobilox
  naar niets. Kostte op 23-08 drie meldingen die als "onbekend voertuig" mislukten.
- **Een factuur mag een eerdere melding uit de overeenkomst vervangen** (`vervangt:true` in de body van
  `/api/verkocht`), maar alleen zolang de verkoop nog **niet bevestigd** is. Een bevestigde verkoop
  blijft een 409: die regel staat al in het Autoboek met dat nummer, en PVP en het boek uit elkaar
  laten lopen is erger dan een verouderd nummer. Nasleep hiervan: **vijf auto's dragen nog het
  overeenkomstnummer** (o.a. BMW J-699-DX 183 i.p.v. 336, Renault Twingo KST-45-P 181 i.p.v. 333) —
  die zijn bevestigd vóór deze wijziging en worden niet vanzelf bijgewerkt.
- **De afspraken uit de overeenkomst worden elke ronde bijgehouden** (`mobilox/afspraken.js`,
  25-08-2026). Een verkoopovereenkomst wordt na het opmaken nog gewijzigd; tot nu toe kwam er alleen
  bij, ging er nooit iets af, en liep de werkbon dus uit de pas met wat er met de koper is afgesproken.
  - **Erbij** wat erbij is gekomen, **eraf** wat eruit is gehaald. Een gewijzigde regel is die twee na
    elkaar: de oude tekst staat niet meer in de overeenkomst, de nieuwe wel.
  - **Nooit werk van Carport of Prieva** — alleen regels met `door='mobilox'`.
  - **Nooit een afgevinkte taak.** Dat werk ís gedaan; dat uit de administratie halen omdat de
    verkoper de tekst heeft aangepast, wist geschiedenis. Die blijft staan, mét een melding.
  - Wat vervalt, krijgt een **notitie op de bon** met de oude tekst erbij. Geen stille verdwijning.
  - **De soort wordt bijgesteld als het uitlezen slimmer wordt** — behalve bij een regel die iemand
    met de hand naar de poetser of naar Carport heeft gesleept (`carport_taken.soort_hand`). Dat is
    een oordeel van een mens en dat hoort een patroon in een reguliere expressie niet terug te draaien.
  - **Meer dan `MAX_WEG` (10) verwijderingen in één ronde wordt geweigerd** — dat is geen wijziging
    maar een fout, bijvoorbeeld een regressie in `taken.js` die ineens niets meer uitleest. Toevoegen
    gaat dan wél door; dat maakt niets stuk.
- **De afleverdatum wordt elke ronde bijgehouden** (`mobilox/planning.js`), niet alleen bij een regel
  die de agent voor het eerst ziet. Mobilox wint bewust van wat er in PVP staat: die datum is met de
  koper afgesproken. Een verzetting komt wél als notitie op de werkbon, zodat het geen stille
  wijziging is. **Een auto zonder open werkbon krijgt er geen** — anders verschijnt een auto die
  Carport heeft afgemeld elke ronde opnieuw op de planning.

## Geplande afleveringen in de Prieva-agenda
Sinds 23-08-2026. `agenda/` zet elke geplande aflevering als afspraak in de Google-agenda, met hetzelfde
service-account als het Autoboek — er komt geen tweede sleutel bij. Instellingen in
**`/var/pvp/agenda.env`** (chmod 600, `AGENDA_ID`, **niet committen**); leeg = koppeling uit.

De agenda is een **spiegel van PVP**, geen tweede administratie: PVP werkt hem elke ronde bij, en een
wijziging in de agenda zelf wordt overschreven. Verwijder je een afspraak met de hand, dan staat hij er
binnen een kwartier weer — de werkbon staat immers nog open.

- Afspraken van PVP dragen een merkteken (`extendedProperties.private.pvp=aflevering`) en Google
  filtert daar al op bij het ophalen. **Wat een collega in de agenda zet, komt niet eens over de lijn.**
- Een aflevering is een **hele dag** en staat op *vrij*: Mobilox geeft alleen een datum, en een
  verzonnen tijdstip van 10:00 zou betrouwbaarder lijken dan het is.
- **Afleveringen uit het verleden blijven staan** en er worden er geen gemaakt voor een datum die al
  geweest is.
- **Meer dan tien afspraken weghalen in één ronde wordt geweigerd** — dat is een fout, geen opruiming.
  Bewust doorgaan kan met `--forceer`.
- **Stand 25-08-2026:** de Calendar API staat aan, `AGENDA_ID` is gevuld (agenda *Prieva (Algemeen)*)
  en het service-account is gedeeld — maar met recht **`reader`**, en daarmee kan het niets schrijven.
  Twee wegen, allebei ondersteund in de code:
  1. het deelrecht ophogen naar *Wijzigingen aan afspraken aanbrengen*. Lukt dat niet, dan staat in de
     beheerconsole bij **Agenda → Opties voor extern delen** een beleid dat een account van buiten het
     domein geen wijzigingen laat maken;
  2. **domeinbrede delegatie**: client-ID `100724149126125369873` toelaten met de calendar-scope, en
     `AGENDA_ALS=<e-mailadres>` in `/var/pvp/agenda.env`. Het account handelt dan namens die collega en
     komt dus niet meer van buiten — ongevoelig voor het deelbeleid.
  `node agenda/sync.js --toets <agenda-id>` zegt welke weg actief is en wat er nog mist.

## Een auto wijzigen
Sinds 23-08-2026. `PUT /api/vehicle` (team en admin), en in de app de knop **Gegevens wijzigen**
onderaan de auto. Hetzelfde formulier als bij toevoegen, met alles vooringevuld — twee formulieren met
dezelfde velden lopen uiteen, en dan mist het ene een veld dat het andere wel heeft.

- **Het ID verandert nooit.** Dat is de sleutel waar werkbonnen, taxatierapporten, to-do's,
  garantiegevallen en verkoopmeldingen aan hangen. Het VIN en het kenteken zijn gewoon te corrigeren;
  de sleutel blijft wat hij was. Een auto die ooit op zijn kenteken is aangemaakt houdt dus dat
  kenteken als id, ook als er later een VIN bij komt.
- **Wat er níét mee kan:** status, fase (`klaar`), route, eigenaar, foto's, subtaken en de
  verkoopvelden. Dat zijn procesgegevens; die lopen via hun eigen weg.
- **Botsingscontrole op de genormaliseerde vorm**, tegen de ándere auto's: zet je een kenteken dat al
  bij een andere auto staat, dan volgt **409**. Datums worden gecontroleerd op of ze bestáán, niet
  alleen op hun vorm — `31-31-2026` heeft de goede vorm.
- **Alleen de velden die je werkelijk wijzigt gaan mee naar het Autoboek** (`autoboek.wijzigAuto`).
  Dat is bewust anders dan `vulAan()`, dat juist alleen lege cellen invult om handwerk van kantoor te
  beschermen: hier corrigeert iemand met opzet een veld, dus mag er overheen geschreven worden — maar
  uitsluitend over dat veld. Wat niemand aanraakte, blijft in het boek staan zoals het stond.
- De auto wordt in het boek gezocht op zijn **oude** VIN en kenteken, op alle drie de tabbladen.
  Verandert juist dat veld, dan is hij onder zijn nieuwe naam nog nergens te vinden.
- Kolom **E t/m P (4..15) staat op alle drie de tabbladen op dezelfde plek en betekent hetzelfde** —
  nagemeten op de inhoud, want de koppen verschillen (`VIN`/`Chassisnummer`, `Transmissie`/`29-X`;
  die laatste bevat op alle drie de bladen gewoon Aut/Hand). De inkoopprijs staat op *Komende* in R en
  op de andere twee in T, en staat daarom apart in de tabel.
- Voor het uploaden wordt nagekeken dat elk tabblad even veel regels houdt en dat de koprijen niet
  veranderen; daarna volgt de revisiecontrole. Mislukt het boek, dan blijft de correctie in PVP staan
  met `autoboek_status='fout'` — zichtbaar bij de auto, zelfde patroon als bij het aanmaken.

## Wat er op welk scherm staat (23-08-2026)
Na een rondgang langs alle vijf de rollen bleek het gat niet in de techniek te zitten maar in
handelingen die nergens bereikbaar waren. Vijf dingen erbij:

- ~~Vandaag: "Wacht op bevestiging."~~ **Er weer af gehaald op dezelfde dag** (opgave Prieva). Sinds
  de factuur de verkoop afrondt, is er niets meer te bevestigen: een verkoopovereenkomst betekent
  gewoon *verkocht, factuur volgt*. Een blok dat om werk vraagt dat niet bestaat, is ruis. Het label
  op Lopende heet daarom nu **"Verkocht — factuur volgt"** in plaats van "Gemeld verkocht —
  bevestigen", en de filterchip **"Wacht op factuur"**. De knop *Verkoop bevestigen* blijft wél op de
  auto zelf staan, voor een verkoop die buiten Mobilox om loopt — met de tekst erbij dat het meestal
  niet nodig is.
- **Vandaag: één regel onderaan** met wanneer de koppelingen voor het laatst rondkwamen. De banner
  bovenaan schreeuwt alleen bij een storing; dit is de stille variant.
- **Lopende: de afleverdatum** met dezelfde teller als op Vandaag, **in de statuskolom en niet als
  extra kolom**. De tabel telt vijftien kolommen en past nu net zonder horizontaal schuiven; een
  zestiende (~74 px) zou dat breken.
- **Carport: "Naar de auto →"** op elke werkbon (alleen Prieva; Carport heeft geen autopagina). Tot nu
  toe moest je het kenteken overtypen in de zoekbalk.
- **De autopagina begint met de specificaties** (23-08-2026, opgave Prieva). Daarmee stel je vast dát
  je de juiste auto voor je hebt; pas daarna kijk je waar hij in het traject staat. Stond eerst
  onderaan de linkerkolom, onder de foto's — dan moet je langs alles heen scrollen om te zien of het
  chassisnummer klopt. Nu een kaart over de volle breedte, met kolommen die zich vanzelf verdelen.
- **Lege velden worden aangevuld uit de advertentie** (`VULBAAR` in `mobilox/agent.js`). Mobilox weet
  van elke auto die te koop staat de kleur, de brandstof, de uitvoering en of het een automaat is;
  dat hoeft niemand over te typen. **Alleen wat in PVP leeg is** — wat er staat is met de hand gezet
  of uit de inkoopstukken gelezen, en dat overschrijven is geen aanvullen maar overrulen. Het gaat via
  `PUT /api/vehicle` (die neemt daarom óók het bearer-token aan), zodat de dubbelcontrole en de regel
  naar het Autoboek dezelfde zijn als bij handwerk.
  - Een **importauto heeft nog geen Nederlandse toelatingsdatum**, wél een buitenlandse. Zonder die
    terugval (`RDW_DATUM_EERSTE_TOELATING_INTERNATIONAAL`) blijft *1e reg.* leeg bij precies de auto's
    die het langst in het traject zitten.
  - Een kenteken dat al bij een ándere auto staat wordt nooit ingevuld: dan maak je een dubbele.
  - Stand 23-08-2026 na de eerste ronde: van de 51 lopende auto's misten er nog **drie** iets. De 24
    zonder kenteken zijn allemaal import — dat kenteken bestáát nog niet.
- **Doorklikken naar de advertentie in Mobilox.** `members.mobilox.nl/#vehicles/<product-id>`; het id
  komt van `GET /api/v2/products?category=VOERTUIGEN_AUTO&productStatus=all` en wordt door de agent
  elke ronde gekoppeld op VIN of kenteken (`vehicles.mobilox_id`). Vraagprijs en of hij online staat
  komen mee — dat zijn de twee dingen die je op de autopagina wilt zien zonder over te schakelen.
  Gemeten op 23-08-2026: 70 advertenties, waarvan **61 aan een auto in PVP gekoppeld** en 51 online.
- **Komende: "Inruilauto's uit Mobilox."** De agent legde elke inruil vast in `mobilox_inruil`, maar
  daar hoorde geen scherm bij — 128 regels waar niemand bij kon. Per regel *Overnemen als komend* of
  *Negeren*, en wat al in PVP staat wordt als zodanig herkend (op het genormaliseerde kenteken, ook als
  de regel zelf nooit is overgenomen). **Overnemen gaat langs hetzelfde `POST /api/vehicle`** als de
  knop *Auto* rechtsboven — dezelfde dubbelcontrole, dezelfde regel naar het Autoboek. Een tweede weg
  om een auto aan te maken zou daar vroeg of laat van afwijken.

## Controle: het Autoboek naast PVP
`beheer/autoboek-controle.js` (25-08-2026). Leest alleen. Meldt zes dingen: hetzelfde factuurnummer op
meer dan één regel, dezelfde auto op meer dan één regel, PVP en het boek oneens over het tabblad, een
auto die het boek kent en PVP niet, een verkoopdatum op *Komende* of een factuurnummer op *Lopende*, en
verkochte regels zonder factuurnummer. Met `--stil` legt hij de uitkomst vast in `agent_runs`.

Twee dingen die géén fout zijn en er daarom uit gefilterd worden:
- **een auto die vaker verkocht is** hoort meerdere regels te hebben, elk met een eigen factuurnummer;
- **een verkoopdatum en -prijs op *Lopende*** is normaal: dat is een auto die op een overeenkomst
  verkocht is en waar nog aan gewerkt wordt. Pas als er óók een factuurnummer staat, had hij moeten
  verhuizen.

De kolommen staan niet op alle bladen gelijk: op *Komende* is **Q** de verkoopdatum en **R** de
inkoopprijs, op *Lopende* en *Verkochte* is **R** de verkoopdatum en **U** de verkoopprijs. De eerste
versie haalde dat door elkaar en zag dertien inkoopprijzen aan voor verkoopdatums.

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
- **Naar boven springen hoort bij navigeren, niet bij tekenen** (25-08-2026). `openVeh()`,
  `renderLog()`, `renderTaxCar()` en `renderFotoCar()` riepen zélf `window.scrollTo(0,0)` aan. Omdat
  elke handeling de pagina opnieuw tekent, sprong je bij élk vinkje terug naar boven: vinkje, sprong,
  terugscrollen, volgend vinkje. Nu loopt alles door `scrollBewaard()`: die onthoudt de positie, en
  laat hem alleen los als `state.view` verandert. Vandaar het paar `rerender`/`rerenderNu` en
  `openVeh`/`openVehNu` — de eerste is de ingang met positiebewaking, de tweede tekent alleen.
  Roep je een teken-functie rechtstreeks aan, dan springt de pagina weer.
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
- **`loadVehicles()` bewaart de voortgang van auto's die het al kende** (sinds 20-08-2026). Daarvóór
  kreeg elke rij `initVeh()` en stond alles in het geheugen op leeg tot `loadState()` eroverheen kwam.
  Werd `loadVehicles()` ergens aangeroepen **zonder** `loadState()` erachter — dat gebeurde in
  `arrive()`, sinds 18-08 — dan schreef de eerstvolgende klik die lege waarden over de database.
  **Op 20-08-2026 om 12:32 kostte dat de fase, foto's, subtaken en eigenaren van 64 auto's**, hersteld
  uit de nachtelijke `pg_dump` met `inhaalslag/herstel-statusvelden.js` (alleen de statusvelden, niet
  de hele tabel — anders verlies je wat er ná de back-up echt gebeurd is).
  De regel blijft: roep ze aan als paar. Maar één vergeten aanroep mag geen administratie meer kosten.
- **`putState()` weigert een massale wissing** (`MAX_WISSEN`, sinds 20-08-2026). Komt een auto die in
  de database een traject heeft (`klaar>0` of een route) helemaal leeg terug, dan telt dat als gewist;
  bij meer dan drie tegelijk wordt er **niets** geschreven en geeft het endpoint **409**. De frontend
  zet dan `stateOk=false` en vraagt om te verversen. Dat is geen handeling die iemand met de hand doet,
  dus een terechte weigering kost niemand werk — en de server hoort niet afhankelijk te zijn van een
  frontend die het goed doet.
- **`stateOk` bewaakt het opslaan.** `scheduleSave()` schrijft pas als `loadState()` gelukt is. Zonder
  dat slot zou een mislukte `GET /api/state` (backend-herstart, nginx-hik) ertoe leiden dat de
  eerstvolgende klik de beginwaarden van `V` over de database heen zet: alle lopende auto's terug naar
  komende, keuringsfoto's en subtaken weg. Haal die controle er dus niet uit.
- **Een verkoop kan van twee kanten komen.** De agent bevestigt op een factuur; een beheerder kan het
  ook met de hand doen via *Verkoop bevestigen*. Beide lopen door dezelfde functie
  (`verkoopNaarAutoboek`), en die verplaatst nooit twee keer: staat de auto al op `verkocht`, dan staat
  zijn regel al op *Verkochte* en zou een tweede poging hem daar niet meer vinden — of erger, een
  tweede regel opleveren.
- **Een auto verwijderen raakt het Autoboek niet.** `/api/vehicle-del` haalt de auto uit PVP en geeft
  het rijnummer terug; die regel haal je met de hand weg. Bewust: verwijderen is een correctie op een
  vergissing, geen stap in het proces. Een auto die écht verkocht is loopt via de verkoopbevestiging,
  en dáár verplaatst PVP de regel wél zelf.
- **Een verplaatsing weigert nu als de auto al op het doelblad staat.** Stond een verkoop met de hand
  in het boek én bleef de regel op *Lopende* staan, dan zette de verplaatsing hem er een tweede keer
  op — met hetzelfde factuurnummer. Zo ontstonden op 23-08-2026 de dubbelen bij de Toyota Yaris en de
  Volkswagen Polo. Nu volgt een duidelijke fout bij de auto in plaats van een stille tweede regel.
- **De nieuwe regel komt ná álles wat inhoud heeft**, niet na de laatste regel met een gevulde
  kernkolom. Er staan regels waar alleen een kostenkolom is ingevuld; die zijn voor de kernkolommen
  "leeg" maar bevatten wel degelijk iets, en die werden overschreven. De eindcontrole ving dat op (het
  aantal regels groeide niet) met een melding waar niemand iets van begreep.
- **Een auto met alléén een VIN en een auto met alléén een kenteken zijn niet als dubbel te
  herkennen.** De controle bij `POST /api/vehicle` vergelijkt beide sleutels genormaliseerd, maar twee
  regels die elkaar op geen van beide overlappen, botsen nergens. Zo ontstonden op 23-08-2026 twee
  dubbelen bij het overnemen van de RDW-bedrijfsvoorraad (Peugeot 107 en Audi A3), opgeruimd met
  `inhaalslag/dubbelen-opruimen-20260823.js`. Wie een auto aanmaakt met alleen een kenteken terwijl
  PVP hem onder zijn VIN kent, krijgt daar dus geen waarschuwing over.
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
- ~~De Mobilox-agent op een timer.~~ **Klaar 23-08-2026:** elk kwartier, ma–za 07:00–18:45 NL, met een
  melding op Vandaag als hij stilstaat.
- **Bijna klaar: de agenda-koppeling.** De code staat er en is getoetst; er moet nog drie dingen
  gebeuren buiten de server: Calendar API aanzetten, de agenda delen met het service-account en
  `AGENDA_ID` invullen. Zie `agenda/LEESMIJ.md`.
- ~~De agent mag een verkoop zelf afronden en de inruil zelf overnemen.~~ **Klaar 23-08-2026.** Bij de
  overgang zijn zes auto's met een factuur alsnog bevestigd (vier verhuisd naar *Verkochte*, twee
  stonden daar al — rij 309 en 313 — en hun `autoboek_status` is van 'fout' naar 'ok' gezet), en de
  ene openstaande inruiler (Opel Zafira Tourer 99-ZVT-9, bij overeenkomst 185) is overgenomen.
- Open: **vijf auto's dragen het overeenkomstnummer in plaats van het factuurnummer**, omdat ze
  bevestigd zijn vóór de vervang-regel bestond. In het Autoboek staat dat nummer al. Corrigeren kan
  alleen met de hand, in PVP én in het boek.
- Bekend gat: **PVP schrijft alleen bij het aanmaken naar het Autoboek.** Latere wijzigingen aan een
  auto komen daar niet in terecht.
- ~~`/uploads/` staat open.~~ **Dicht sinds 26-08-2026** — zie "Uploads achter de sessie" hierboven.
- ~~Geen enkele auto is in PVP te wijzigen.~~ **Klaar 23-08-2026:** `PUT /api/vehicle` en de knop
  *Gegevens wijzigen* op de auto zelf. Zie hieronder.
