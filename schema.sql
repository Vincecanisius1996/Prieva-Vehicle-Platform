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
