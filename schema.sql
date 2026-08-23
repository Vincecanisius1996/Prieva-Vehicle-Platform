-- PVP — schema voor database `pvp` (Fase 1: JSON -> PostgreSQL).
-- Idempotent: mag zo vaak gedraaid worden als nodig.

-- Voertuigen: catalogus (nu nog de hardcoded V in index.html) + status in één rij.
CREATE TABLE IF NOT EXISTS vehicles (
  id            text PRIMARY KEY,
  -- catalogus
  vin           text,
  kenteken      text,
  merk          text,
  model         text,
  uitv          text,
  kleur         text,
  brandstof     text,
  transm        text,
  reg           text,
  km            bigint,
  inkoopdatum   text,
  lev           text,
  import_auto   boolean NOT NULL DEFAULT false,
  batch         text,
  note          text,
  sort_order    int,                                  -- volgorde zoals in V (weergavevolgorde)
  -- status
  status        text    NOT NULL DEFAULT 'komende',   -- komende | lopende
  klaar         int     NOT NULL DEFAULT 0,
  route         text,                                 -- NULL | JA | NEE
  owner         text,
  arrived_at    bigint,
  tax_at        bigint,
  photos        jsonb   NOT NULL DEFAULT '{}'::jsonb, -- { key: url }  RDW/papieren
  subtasks      jsonb   NOT NULL DEFAULT '[]'::jsonb, -- [ {id,text,owner,done,createdAt,doneAt,doneBy} ]
  ad_photos     jsonb   NOT NULL DEFAULT '[]'::jsonb, -- [ url, ... ]  advertentiefoto's
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Toegevoegd 17-08-2026 bij de plusknop ("Auto toevoegen"). Als ALTER en niet in de CREATE hierboven,
-- zodat dit bestand ook op een bestaande database gedraaid kan worden — het moet idempotent blijven.
-- factuurnr/inkoopprijs/verkoopdatum vullen de laatste drie kolommen van het Autoboek-tabblad
-- "Komende Autos" die PVP nog niet had. Zie PVP-autoboek-koppeling-voorstel.md.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS factuurnr    text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS inkoopprijs  numeric(12,2);   -- euro's, excl.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS verkoopdatum text;            -- als de andere datums: tekst dd-mm-jjjj
-- Documenten die bij het toevoegen zijn meegegeven: koopovereenkomst, proforma, screenshots.
-- [ {url,name,ts}, ... ]. De bestanden zelf staan in /var/pvp/uploads, net als de foto's.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS docs jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Wegschrijven naar het Autoboek. Bewust bijgehouden per auto: een mislukte schrijfactie mag niet
-- stilletjes verdwijnen, anders ontstaat precies het gat dat we aan het dichten zijn.
-- status: NULL = nog niet geprobeerd | 'ok' | 'fout'
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS autoboek_status text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS autoboek_rij    int;      -- rijnummer in "Komende Autos"
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS autoboek_ts     bigint;   -- wanneer voor het laatst geprobeerd
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS autoboek_fout   text;     -- waarom het misging

-- id komt van de frontend (gtUid), bewust géén serial.
CREATE TABLE IF NOT EXISTS global_todos (
  id          bigint PRIMARY KEY,
  text        text,
  owner       text,
  vehicle_id  text,
  done        boolean NOT NULL DEFAULT false,
  created_at  bigint,
  done_at     bigint,
  done_by     text
);

-- id alleen om de arrayvolgorde van activityLog te bewaren.
CREATE TABLE IF NOT EXISTS activity_log (
  id          bigserial PRIMARY KEY,
  ts          bigint,
  by_name     text,
  action      text,
  text        text,
  vehicle_id  text
);

CREATE TABLE IF NOT EXISTS bpm_reports (
  id          bigserial PRIMARY KEY,
  vehicle_id  text NOT NULL,
  url         text NOT NULL,
  name        text,
  ts          bigint,
  by_name     text
);

CREATE TABLE IF NOT EXISTS bpm_notifs (
  id          bigserial PRIMARY KEY,
  vehicle_id  text,
  name        text,
  ts          bigint,
  by_name     text,
  seen        boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS users (
  username  text PRIMARY KEY,
  role      text NOT NULL,
  salt      text NOT NULL,
  hash      text NOT NULL,
  name      text
);

CREATE TABLE IF NOT EXISTS meta (
  key    text PRIMARY KEY,
  value  bigint
);

CREATE INDEX IF NOT EXISTS bpm_reports_vehicle_idx ON bpm_reports (vehicle_id);
CREATE INDEX IF NOT EXISTS vehicles_sort_idx       ON vehicles (sort_order, id);

-- Verkoop (deel 1, 18-08-2026). De status krijgt er twee waarden bij: 'gemeld verkocht' (binnengekomen
-- via POST /api/verkocht) en 'verkocht' (door een beheerder bevestigd). Bewust GEEN check-constraint op
-- status: putState() zou dan bij een onverwachte waarde een 500 geven in plaats van de auto met rust te
-- laten. Bewaken gebeurt in de code.
--
-- Let op de naamgeving: `factuurnr` bestond al en is het pro-formanummer van de INKOOP. Deze kolommen
-- gaan over de verkoop en krijgen daarom het voorvoegsel `verkoop_`; zonder dat verschil verwisselt
-- iemand ze een keer.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS verkoop_factuurdatum    text;            -- dd-mm-jjjj
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS verkoopprijs            numeric(12,2);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS verkoop_factuurnr       text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS verkocht_gemeld_ts      bigint;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS verkocht_bevestigd_ts   bigint;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS verkocht_bevestigd_door text;

-- Spoor van elke melding, ook de mislukte. Bewust een eigen tabel en niet activity_log: putState() gooit
-- die tabel leeg en vult hem opnieuw uit wat de frontend stuurt, dus een regel van de server zou bij de
-- eerstvolgende klik verdwijnen. Een machinekoppeling heeft een spoor nodig dat blijft staan.
CREATE TABLE IF NOT EXISTS verkoop_meldingen (
  id           bigserial PRIMARY KEY,
  ts           bigint,
  vehicle_id   text,
  bron         text,           -- vrij veld: straks 'mobilox', nu 'handmatig'/'test'
  factuurnr    text,
  factuurdatum text,
  verkoopprijs numeric(12,2),
  uitkomst     text,           -- gemeld | ongewijzigd | conflict | onbekend voertuig | ongeldig
  payload      jsonb
);
CREATE INDEX IF NOT EXISTS verkoop_meldingen_vehicle_idx ON verkoop_meldingen (vehicle_id, ts);

-- Uit het taxatierapport gelezen bij het uploaden (zie bpmlezen/). opname_datum is de dag van de
-- fysieke opname; daar loopt de geldigheidstermijn van 29 dagen vanaf.
ALTER TABLE bpm_reports ADD COLUMN IF NOT EXISTS opname_datum text;
ALTER TABLE bpm_reports ADD COLUMN IF NOT EXISTS taxateur     text;

-- ===== Carport: werkbonnen en planning (20-08-2026) =====
-- Eén bon per auto die bij Carport staat. Niet elke lopende auto komt hier: Prieva zet een auto op
-- de planning met wat er moet gebeuren.
CREATE TABLE IF NOT EXISTS carport_bonnen (
  id               bigserial PRIMARY KEY,
  vehicle_id       text NOT NULL,
  -- Gewenste afleverdatum (dd-mm-jjjj). Komt uit de verkoopovereenkomst in Mobilox; zolang die
  -- koppeling er niet is, wordt hij met de hand ingevuld. De deadline is CARPORT_MARGE_DAGEN
  -- eerder, zodat de auto nog naar de poetser kan.
  afleverdatum     text,
  -- Eigen volgorde van Carport. Leeg = sorteren op deadline. Zodra er gesleept wordt krijgen alle
  -- open bonnen een nummer, zodat de volgorde daarna volledig van hen is.
  volgorde         integer,
  status           text NOT NULL DEFAULT 'open',       -- 'open' | 'klaar'
  klaar_ts         bigint,
  klaar_door       text,
  aangemaakt_ts    bigint,
  aangemaakt_door  text,
  -- Notities: [{ts, door, soort:'technisch'|'klant', tekst}]. Technisch is van Carport, klant is
  -- de vertaling van Prieva richting de koper. Bewust gescheiden: monteurstaal hoort niet
  -- ongefilterd bij een klant terecht te komen.
  notities         jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carport_bonnen_vehicle_idx ON carport_bonnen (vehicle_id);
CREATE INDEX IF NOT EXISTS carport_bonnen_status_idx  ON carport_bonnen (status);

-- De regels op een bon: reparatie, APK, beurt, onderdeel bestellen.
CREATE TABLE IF NOT EXISTS carport_taken (
  id             bigserial PRIMARY KEY,
  bon_id         bigint NOT NULL REFERENCES carport_bonnen(id) ON DELETE CASCADE,
  soort          text NOT NULL DEFAULT 'reparatie',    -- reparatie | apk | beurt | onderdeel
  tekst          text NOT NULL,
  -- Wie de regel toevoegde: 'prieva' of 'carport'. Carport vindt onderweg werk dat niet op de bon
  -- stond; dat moet je later terug kunnen zien zonder erover te hoeven discussiëren.
  door           text NOT NULL DEFAULT 'prieva',
  klaar          boolean NOT NULL DEFAULT false,
  klaar_ts       bigint,
  klaar_door     text,
  aangemaakt_ts  bigint
);
CREATE INDEX IF NOT EXISTS carport_taken_bon_idx ON carport_taken (bon_id);

-- ===== Garantiegevallen (20-08-2026) =====
-- Meldingen die per mail binnenkomen over een auto die al geleverd is. Ze horen op de pagina Vandaag,
-- want anders raken ze uit beeld. De auto staat vaak niet meer in `vehicles` (verkocht), dus
-- vehicle_id mag leeg zijn en het kenteken is het houvast.
CREATE TABLE IF NOT EXISTS garantie_gevallen (
  id                bigserial PRIMARY KEY,
  vehicle_id        text,
  kenteken          text,
  omschrijving      text NOT NULL,
  -- De melding zoals binnengekomen, ongewijzigd. Bij een discussie over wat er precies gemeld is,
  -- wil je de oorspronkelijke tekst kunnen teruglezen en niet iemands samenvatting.
  melding           text,
  status            text NOT NULL DEFAULT 'open',      -- 'open' | 'afgehandeld'
  owner             text,
  aangemaakt_ts     bigint,
  aangemaakt_door   text,
  afgehandeld_ts    bigint,
  afgehandeld_door  text,
  notities          jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS garantie_status_idx ON garantie_gevallen (status);

-- ===== Mobilox-agent (20-08-2026) =====
-- Wat de agent al gezien heeft, zodat hij niet elke ronde dezelfde verkoop opnieuw meldt.
CREATE TABLE IF NOT EXISTS mobilox_gezien (
  soort        text   NOT NULL,          -- 'overeenkomst' | 'factuur'
  extern_id    bigint NOT NULL,
  nummer       integer,
  vin          text,
  vehicle_id   text,
  uitkomst     text,                     -- gemeld | ongewijzigd | botsing | geen-auto | overgeslagen
  verwerkt_ts  bigint,
  PRIMARY KEY (soort, extern_id)
);

-- Inruilauto's uit een factuur. Bewust een VOORSTEL: de agent voegt nooit zelf een auto toe aan PVP,
-- want een verkeerde regel in de catalogus werkt door in het Autoboek en in de rapportage.
CREATE TABLE IF NOT EXISTS mobilox_inruil (
  id            bigserial PRIMARY KEY,
  extern_id     bigint,
  vin           text,
  kenteken      text,
  omschrijving  text,
  prijs         numeric(12,2),
  km            bigint,
  bpm           numeric(12,2),
  status        text NOT NULL DEFAULT 'voorstel',   -- voorstel | overgenomen | genegeerd
  gezien_ts     bigint
);
CREATE INDEX IF NOT EXISTS mobilox_inruil_status_idx ON mobilox_inruil (status);

-- ===== Agenda-koppeling (23-08-2026) =====
-- Het Google-agenda-item dat bij een werkbon hoort. Op de bon en niet in een aparte tabel: er is
-- precies één afspraak per bon, en zo verdwijnt hij vanzelf mee als de bon verdwijnt.
ALTER TABLE carport_bonnen ADD COLUMN IF NOT EXISTS agenda_event_id text;

-- ===== Draaiverslag van de achtergrondtaken (23-08-2026) =====
-- Eén regel per taak, telkens overschreven. Niet een logboek van alle rondes: bij vier rondes per uur
-- is dat binnen een week onleesbaar, en de enige vraag die ertoe doet is "draait hij nog, en ging de
-- laatste ronde goed". De laatste geslaagde ronde wordt apart bewaard, want dat is wat je wilt weten
-- als het nú misgaat: hoe oud is het beeld dat op het scherm staat.
CREATE TABLE IF NOT EXISTS agent_runs (
  naam         text PRIMARY KEY,         -- 'mobilox' | 'agenda'
  ts           bigint,                   -- einde van de laatste ronde
  ok           boolean,
  melding      text,
  duur_ms      integer,
  gelukt_ts    bigint                    -- einde van de laatste GESLAAGDE ronde
);

-- ===== Inruil is een feit, geen voorstel (23-08-2026) =====
-- Bij welke PVP-auto een inruil terechtgekomen is, en hoe dat afliep.
ALTER TABLE mobilox_inruil ADD COLUMN IF NOT EXISTS pvp_id text;
ALTER TABLE mobilox_inruil ADD COLUMN IF NOT EXISTS melding text;

-- ===== Afleveren (23-08-2026) =====
-- Afmelden en afleveren zijn twee dingen. Carport meldt af als het werk klaar is; Prieva vinkt af als
-- de auto bij de klant staat. Zonder dat onderscheid kan Carport een aflevering afsluiten die nog
-- niet heeft plaatsgevonden, en blijft een auto met een verstreken afleverdatum eeuwig in de lijst
-- staan omdat er geen knop is om hem eruit te halen.
ALTER TABLE carport_bonnen ADD COLUMN IF NOT EXISTS afgeleverd_ts     bigint;
ALTER TABLE carport_bonnen ADD COLUMN IF NOT EXISTS afgeleverd_door   text;
ALTER TABLE carport_bonnen ADD COLUMN IF NOT EXISTS afgeleverd_datum  text;   -- dd-mm-jjjj, de dag zelf

-- ===== Doorklikken naar de advertentie in Mobilox (23-08-2026) =====
-- Het product-id uit Mobilox, zodat PVP kan linken naar members.mobilox.nl/#vehicles/<id>. Prijs en
-- of hij online staat komen mee omdat dat precies de twee dingen zijn die je op de autopagina wilt
-- weten zonder over te schakelen.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS mobilox_id     bigint;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS mobilox_prijs  numeric(12,2);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS mobilox_online boolean;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS mobilox_ts     bigint;
