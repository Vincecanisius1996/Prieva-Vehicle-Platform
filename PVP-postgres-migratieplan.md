# PVP → PostgreSQL — migratieplan (Fase 1)

> ## ✅ UITGEVOERD op 15-08-2026 — dit document is nu archief
> De migratie is afgerond; de live app draait op database `pvp` (rol `pvp_app`). Downtime: 3 seconden.
> Wat er werkelijk is opgeleverd, staat in `CLAUDE.md`. De bouwbestanden staan in `/root/pvp/pg/`
> (`schema.sql`, `server.js`, `setpw.js`, `import-json.js`) en zijn gekopieerd naar `/opt/pvp-api/`.
>
> **Afwijkingen t.o.v. het plan hieronder — bewust:**
> - **`pg_hba.conf` had geen localhost-regel.** Er bestond alleen een expliciete regel per CRP-database,
>   dus `pvp_app` werd geweigerd. Toegevoegd: `host pvp,pvp_test pvp_app 127.0.0.1/32 scram-sha-256`,
>   daarna `systemctl reload postgresql`. CRP-regels ongewijzigd, CRP-verbindingen niet verbroken.
> - **`global_todos.id` is `bigint`, geen `serial`.** De frontend genereert de id's zelf (`gtUid`);
>   met een serial zouden bestaande to-do-id's veranderen.
> - **Kolom `sort_order` toegevoegd aan `vehicles`** — bewaart de weergavevolgorde van de lijst `V`,
>   die anders bij `GET /api/vehicles` verloren zou gaan.
> - **`PUT /api/state` wist geen voertuigen** die niet in de payload zitten (bij JSON verdwenen die).
>   Nodig voor Fase 3, waarin de Autoboek-sync rijen toevoegt die de frontend nog niet kent.
> - **`index.html` is niet gewijzigd.** `GET /api/vehicles` bestaat wel, maar de frontend gebruikt hem
>   nog niet — dat is een aparte, kleine stap (Fase 2 in de roadmap).
> - **`import-json.js` heeft een veiligheidsslot gekregen** (`--overschrijf`), omdat de JSON-bestanden
>   sinds de omschakeling bevroren zijn en een tweede import dataverlies zou betekenen.
>
> **Twee onzichtbare verschillen in de API-antwoorden, beide geverifieerd als onschadelijk:**
> 1. `GET /api/bpmreports` geeft geen sleutel meer terug voor een auto met nul rapporten (was `[]`).
>    `bpmList()` in de frontend filtert dat met `Array.isArray` sowieso weg.
> 2. `jsonb` bewaart de sleutelvolgorde binnen een object niet (`{id,text,owner,done}` komt terug als
>    `{id,done,text,owner}`). Alle waarden zijn identiek; JavaScript hecht geen betekenis aan sleutelvolgorde.
>
> **Rollback** (JSON-back-ups staan er nog):
> ```
> systemctl stop pvp-api
> cp /opt/pvp-api/server.js.json-20260815 /opt/pvp-api/server.js
> cp /opt/pvp-api/setpw.js.json-20260815  /opt/pvp-api/setpw.js
> for f in state adphotos reports users; do cp /var/pvp/$f.json.bak-20260815 /var/pvp/$f.json; done
> systemctl start pvp-api
> ```
> (De regel `EnvironmentFile=/var/pvp/pg.env` in de unit mag blijven staan; de JSON-versie negeert hem.)

Doel: de platte JSON-opslag (`/var/pvp/*.json`) vervangen door een eigen **PostgreSQL-database**, als
fundament voor de Autoboek-koppeling en de agents. **Voor de gebruiker verandert er niets** — de app
doet exact hetzelfde, maar op een stevige basis waar straks meerdere schrijvers (agents) veilig bij kunnen.

Bedoeld om **stap voor stap in Claude Code** uit te voeren. Elke stap is apart testbaar. Deploy pas
als een stap lokaal getest is.

## Uitgangspunten / spelregels
- **Gescheiden van CRP.** Gebruik de bestaande PostgreSQL 16, maar maak een **eigen database `pvp`
  met een eigen rol `pvp_app`**. Raak `crp_control`/`crp_prieva` en de CRP-rollen nooit aan.
- **Geen gedragswijziging** in de frontend in deze fase: de API-antwoorden houden exact dezelfde vorm,
  zodat `index.html` ongewijzigd blijft werken.
- **Eén nieuwe dependency toegestaan:** het `pg`-pakket (Postgres-driver voor Node). Dit is de
  gesanctioneerde uitzondering op "geen npm" — een DB-driver kan niet puur-Node. Voeg een `package.json`
  toe in `/opt/pvp-api/`.
- **Geheimen niet in de repo:** het DB-wachtwoord/DSN komt in `/var/pvp/pg.env` (chmod 600) en wordt
  via de systemd-unit ingeladen. Nooit committen.
- **JSON blijft als back-up staan** tot alles bewezen werkt (rollback-vangnet).

## Stap 0 — Database + rol aanmaken (eenmalig, op de server)
Als de `postgres`-systeemgebruiker (kies zelf een sterk wachtwoord, plak het NIET in de chat/repo):
```
sudo -u postgres psql <<'SQL'
CREATE ROLE pvp_app LOGIN PASSWORD 'KIES-EEN-STERK-WACHTWOORD';
CREATE DATABASE pvp OWNER pvp_app;
SQL
```
Zet de verbinding klaar in `/var/pvp/pg.env` (en `chmod 600 /var/pvp/pg.env`):
```
PVP_PG=postgresql://pvp_app:KIES-EEN-STERK-WACHTWOORD@127.0.0.1:5432/pvp
```
(SSL: lukt verbinden niet, probeer `...:5432/pvp?sslmode=disable` voor localhost, of `require` — pak
wat op deze server werkt; CRP gebruikt `require`.)
Laad dit in de systemd-unit van `pvp-api` via `EnvironmentFile=/var/pvp/pg.env` en herstart.

## Stap 1 — Schema (tabellen)
Verbind met de `pvp`-database en maak de tabellen. Ontwerp: één centrale `vehicles`-tabel met zowel de
**catalogus** (nu nog de hardcoded `V` in index.html) als de **status**. Zo kan straks de Autoboek-sync
gewoon rijen upserten en hoeft er niks over.
```sql
-- Voertuigen: catalogus + status in één rij (id = huidige frontend-id, bv. VIN of kenteken)
CREATE TABLE vehicles (
  id            text PRIMARY KEY,
  vin           text, kenteken text, merk text, model text, uitv text,
  kleur text, brandstof text, transm text, reg text, km bigint,
  inkoopdatum text, lev text, import_auto boolean DEFAULT false,
  batch text, note text,
  status        text DEFAULT 'komende',   -- komende | lopende
  klaar         int  DEFAULT 0,
  route         text,                      -- NULL | JA | NEE
  owner         text,
  arrived_at    bigint,
  tax_at        bigint,
  photos        jsonb DEFAULT '{}'::jsonb, -- { key: url }  (RDW/Papieren keuringfoto's)
  subtasks      jsonb DEFAULT '[]'::jsonb, -- [ {id,text,owner,done,createdAt,doneAt,doneBy} ]
  ad_photos     jsonb DEFAULT '[]'::jsonb  -- [ url, ... ]  (advertentiefoto's)
);

CREATE TABLE global_todos (
  id serial PRIMARY KEY, text text, owner text, vehicle_id text,
  done boolean DEFAULT false, created_at bigint, done_at bigint, done_by text
);

CREATE TABLE activity_log (
  id bigserial PRIMARY KEY, ts bigint, by_name text, action text, text text, vehicle_id text
);

CREATE TABLE bpm_reports (
  id bigserial PRIMARY KEY, vehicle_id text, url text, name text, ts bigint, by_name text
);

CREATE TABLE bpm_notifs (
  id bigserial PRIMARY KEY, vehicle_id text, name text, ts bigint, by_name text, seen boolean DEFAULT false
);

CREATE TABLE users (
  username text PRIMARY KEY, role text, salt text, hash text, name text
);

CREATE TABLE meta ( key text PRIMARY KEY, value bigint );  -- o.a. subtask-teller
```

## Stap 2 — DB-laag in de backend
- Voeg `pg` toe: in `/opt/pvp-api/` een `package.json` en `npm install pg`.
- Maak in `server.js` één connection-pool: `const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.PVP_PG });`
- Behoud de bestaande helpers als dunne wrappers, of vervang de `readJson/writeJson`-aanroepen per endpoint door queries (zie stap 4).

## Stap 3 — Eenmalige import (JSON → tabellen)
Schrijf een los scriptje `import-json.js` dat draait met dezelfde `PVP_PG` en `PVP_DATA`:
- `users.json` → tabel `users`.
- De hardcoded `V`-snapshot uit index.html → `vehicles` (catalogus-kolommen). Doe dit als `INSERT ...
  ON CONFLICT (id) DO NOTHING`, zodat je 'm veilig kunt herhalen.
- `state.json`: per voertuig → update `vehicles` (status, klaar, route, owner, arrived_at, tax_at,
  photos, subtasks); `globalTodos` → `global_todos`; `activityLog` → `activity_log`; `subUid` → `meta`.
- `adphotos.json`: per id → `vehicles.ad_photos`.
- `reports.json`: `vehicles`-map → `bpm_reports`; `notifs` → `bpm_notifs`.
Draai dit één keer; controleer de rijaantallen.

## Stap 4 — Endpoints omzetten (zelfde antwoordvorm!)
Vervang per endpoint de JSON-lees/schrijf door SQL, maar geef **exact dezelfde JSON terug** als nu:
- `GET /api/state` → bouw `{ vehicles:{...}, subUid, globalTodos, gtUid, activityLog }` op uit de tabellen.
- `PUT /api/state` → schrijf de deelstukken terug naar de tabellen (upsert per voertuig; todos/log vervangen).
- `GET /api/status`, `/api/taxstate` → selecteer de benodigde kolommen.
- `/api/photo`, `/api/adphoto(s)(-set)` → update `vehicles.photos` / `vehicles.ad_photos`.
- `/api/bpmreports`, `/api/bpmreport`, `/api/bpmnotif-seen`, `/api/bpmreport-del` → `bpm_reports`/`bpm_notifs`.
- `/api/login`, `/api/me`, `setpw.js` → tabel `users`.
- **Nieuw, klein maar belangrijk:** `GET /api/vehicles` dat de catalogus teruggeeft, en laat `index.html`
  de lijst `V` daaruit laden (met de hardcoded lijst als fallback als de fetch faalt). Dit is de haak
  waarmee Fase 3 (Autoboek-sync) later triviaal wordt: de sync upsert alleen nog `vehicles`.

## Stap 5 — Testen, deployen, back-up, rollback
- **Lokaal testen** met een test-database + `PVP_FRONTEND` (zie CLAUDE.md): login + alle rol-flows
  (team, admin, foto, taxateur), foto-upload, taxatie JA/NEE, BPM-rapport upload/verwijderen, logboek.
- **Deploy** pas daarna; bewaar de oude `*.json` als `*.json.bak`.
- **Rollback:** de vorige `server.js` (JSON-versie) staat in git — bij problemen terugzetten en
  herstarten; de JSON-back-ups staan er nog.

## Kickoff-prompt voor Claude Code
Plak dit als eerste opdracht (in default- of plan-modus):

> Lees CLAUDE.md en PVP-postgres-migratieplan.md. We doen Fase 1: opslag van JSON naar PostgreSQL,
> zonder gedrag te wijzigen, strikt gescheiden van CRP. Begin met een plan en het schema; voer nog
> niets uit tot ik akkoord geef. Werk daarna stap voor stap (0 t/m 5), test elke stap lokaal met de
> testopzet uit CLAUDE.md, en vraag bevestiging vóór je iets op de server deployt.

## Wat hierna komt (niet nu)
Fase 3 — Autoboek → PVP: nog te beslissen hóe PVP het Autoboek leest (Google Sheets/Drive-API met
service account zoals bij CRP, CSV-export, of de bestaande Autoboek-agent schrijft direct in `vehicles`).
Dankzij `GET /api/vehicles` + de `vehicles`-tabel is dat straks een kleine stap.
