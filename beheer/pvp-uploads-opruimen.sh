#!/bin/bash
# Ruimt wees-bestanden in /var/pvp/uploads op: bestanden waar de database nergens meer naar verwijst.
#
# WAAROM DIT NODIG IS
#   De app verwijdert URL's uit de database zonder het bestand van schijf te halen:
#     * /api/adphotos-set        — fotograaf gooit advertentiefoto's weg
#     * PUT /api/state           — keuringsfoto verwijderd óf overschreven (photos-map wordt vervangen)
#   Zonder opruimen groeit /var/pvp/uploads dus door met bestanden die niemand meer kan zien.
#
# WAAROM AFSTEMMEN EN NIET DIRECT WISSEN BIJ DE AANROEP
#   1. Eén plek dekt alle lekken, ook toekomstige. Het live request-pad blijft ongemoeid.
#   2. De app heeft een knop "Ongedaan maken" na het verwijderen van een foto. Direct wissen zou die
#      stukmaken; met een wachttijd van dagen is dat uitgesloten.
#   3. Een client met verouderde gegevens kan per ongeluk foto's van een ander uit de lijst duwen.
#      Nu zijn die nog terug te halen in plaats van meteen weg.
#
# NIETS WORDT GEWIST: bestanden gaan naar /var/pvp/prullenbak/<datum>/ en worden daar pas na
# PURGE_DAYS dagen echt verwijderd. Terughalen = het bestand terugkopiëren naar dezelfde plek in
# /var/pvp/uploads (het pad onder de datummap is identiek) en de URL weer in de database zetten.
#
# Gebruik:  pvp-uploads-opruimen.sh [--grace <dagen>] [--proefdraai] [--forceer]
#   --grace       wachttijd voordat een wees mag verhuizen (standaard 7 dagen)
#   --proefdraai  alleen rapporteren, niets verplaatsen
#   --forceer     ook doorgaan als de veiligheidsgrens wordt overschreden (handmatig, bewust)
set -euo pipefail

UPLOADS=/var/pvp/uploads
PRULLENBAK=/var/pvp/prullenbak
GRACE_DAYS=7          # zo lang blijft een wees gewoon staan
MIN_AGE_MIN=60        # harde ondergrens: nooit aan bestanden van het laatste uur komen.
                      # /api/photo schrijft het bestand en pas ~0,4 s later slaat de frontend de
                      # URL op; zonder deze grens zou een verse foto als wees kunnen worden gezien.
PURGE_DAYS=30         # zo lang blijft de prullenbak bewaard
MAX_DEEL=25           # veiligheidsgrens: meer dan dit percentage wezen = er klopt iets niet
MIN_VOOR_GRENS=50     # de grens geldt pas vanaf dit aantal wezen (kleine aantallen zijn normaal)

PROEF=0; FORCEER=0
while [ $# -gt 0 ]; do
  case "$1" in
    --grace) GRACE_DAYS="$2"; shift 2 ;;
    --proefdraai) PROEF=1; shift ;;
    --forceer) FORCEER=1; shift ;;
    *) echo "Onbekende optie: $1" >&2; exit 2 ;;
  esac
done

log() { logger -t pvp-uploads-opruimen "$1"; echo "$1"; }
afbreken() { logger -t pvp-uploads-opruimen "AFGEBROKEN: $1"; echo "AFGEBROKEN: $1" >&2; exit 1; }

# ===== Verslag naar PVP =====
# Dit script brak van 29-08 t/m 08-09-2026 elke nacht af op zijn eigen veiligheidsklep (32% wezen),
# en dat stond alleen in `systemctl --failed` — waar niemand naar kijkt. Nu verschijnt het op
# *Vandaag*, net als de back-ups. Het melden mag het opruimen zelf nooit laten mislukken.
verslag() {
  [ -r /var/pvp/pg.env ] || return 0
  ( set +e; set -a; . /var/pvp/pg.env; set +a
    node /opt/pvp-api/agentrun.js opruimen "$1" "$2" ) >/dev/null 2>&1 || true
}

[ -d "$UPLOADS" ] || afbreken "$UPLOADS bestaat niet"
[ -r /var/pvp/pg.env ] || afbreken "/var/pvp/pg.env niet leesbaar"
set -a; . /var/pvp/pg.env; set +a

WERK=$(mktemp -d)
# Eén EXIT-trap voor allebei: een tweede `trap ... EXIT` vervangt de eerste. Via EXIT en niet via ERR,
# zodat elke manier van stukgaan gemeld wordt — ook de `exit 1` uit afbreken().
afloop() {
  code=$?
  [ "$code" -ne 0 ] && verslag 0 "mislukt (exitcode $code) — zie: journalctl -u pvp-uploads-opruimen"
  rm -rf "$WERK"
  return 0
}
trap afloop EXIT

# Alles waar de database naar verwijst. Er zijn VIER plekken waar de app bestanden vastlegt, en
# ze moeten hier alle vier in staan:
#   vehicles.ad_photos   /api/adphoto      advertentiefoto's
#   vehicles.photos      /api/photo        keurings- en papierenfoto's
#   vehicles.docs        /api/vehicledoc   inkoopdocumenten (pdf, screenshots)
#   bpm_reports.url      /api/bpmreport    taxatierapporten
# `docs` ontbrak hier tot 08-09-2026, en daarmee telde ELK inkoopdocument als wees. Op de dag dat het
# opviel waren dat er 8 die nog gewoon bij een auto hoorden — waaronder het COS-statusrapport en het
# serviceboekje van de e-Berlingo, precies de stukken waar een advertentie op gebouwd wordt. Ze zijn
# nooit verplaatst omdat de veiligheidsklep hieronder eerder afbrak (31% wees). Die klep heeft dus
# gedaan waarvoor hij er is; zonder die klep waren ze weg geweest.
# Komt er een vijfde plek bij, zet hem hier ook neer.
if ! psql "$PVP_PG" -tAc "
  select url from (
    select jsonb_array_elements_text(ad_photos) as url from vehicles
    union all select value from vehicles, jsonb_each_text(photos)
    union all select d->>'url' from vehicles, jsonb_array_elements(docs) d
    union all select url from bpm_reports
  ) x where url like '/uploads/%'" 2>"$WERK/psql.err" | sed 's#^/uploads/##' | sort -u > "$WERK/indb.txt"; then
  afbreken "database niet te bevragen: $(head -1 "$WERK/psql.err")"
fi

IN_DB=$(wc -l < "$WERK/indb.txt")
# Veiligheidsklep: een lege uitkomst betekent een lege of kapotte database, niet "alles is wees".
[ "$IN_DB" -gt 0 ] || afbreken "de database verwijst naar 0 bestanden — dat klopt niet, er wordt niets verplaatst"

find "$UPLOADS" -type f -printf '%P\n' | sort > "$WERK/opschijf.txt"
OP_SCHIJF=$(wc -l < "$WERK/opschijf.txt")
[ "$OP_SCHIJF" -gt 0 ] || { log "geen bestanden in $UPLOADS — niets te doen"; exit 0; }

# Wezen = op schijf, niet in de database.
comm -13 "$WERK/indb.txt" "$WERK/opschijf.txt" > "$WERK/wezen-alle.txt"
ALLE=$(wc -l < "$WERK/wezen-alle.txt")

# Andersom: verwijst de database naar iets dat niet bestaat? Wordt niets aan gedaan, wel gemeld.
KWIJT=$(comm -23 "$WERK/indb.txt" "$WERK/opschijf.txt" | wc -l)
[ "$KWIJT" -eq 0 ] || log "LET OP: de database verwijst naar $KWIJT bestand(en) die niet op schijf staan"

# Veiligheidsklep, bewust vóór alle andere afwegingen: een onwaarschijnlijk groot aandeel wijst op een
# fout (verkeerde database, half gevulde tabel, mislukte migratie) en niet op echt afval. Dit moet ook
# alarm slaan als de wachttijd hieronder toevallig zou voorkomen dat er iets verplaatst wordt — anders
# leest een kapotte database als een geruststellend "niets te doen".
if [ "$ALLE" -ge "$MIN_VOOR_GRENS" ]; then
  DEEL=$(( ALLE * 100 / OP_SCHIJF ))
  if [ "$DEEL" -ge "$MAX_DEEL" ] && [ "$FORCEER" -eq 0 ]; then
    afbreken "$ALLE van $OP_SCHIJF bestanden ($DEEL%) lijken wees — dat is te veel om te vertrouwen. Controleer de database. Bewust doorgaan kan met --forceer."
  fi
fi

# Alleen wezen die lang genoeg stil hebben gelegen.
: > "$WERK/wezen.txt"
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  f="$UPLOADS/$rel"
  [ -f "$f" ] || continue
  [ -n "$(find "$f" -mmin +$MIN_AGE_MIN -print -quit)" ] || continue
  if [ "$GRACE_DAYS" -gt 0 ]; then
    [ -n "$(find "$f" -mtime +$((GRACE_DAYS-1)) -print -quit)" ] || continue
  fi
  printf '%s\n' "$rel" >> "$WERK/wezen.txt"
done < "$WERK/wezen-alle.txt"

AANTAL=$(wc -l < "$WERK/wezen.txt")
BYTES=0
if [ "$AANTAL" -gt 0 ]; then
  BYTES=$(while IFS= read -r rel; do stat -c %s "$UPLOADS/$rel"; done < "$WERK/wezen.txt" | awk '{s+=$1} END {print s+0}')
fi
MB=$(awk "BEGIN{printf \"%.0f\", $BYTES/1048576}")

log "in database: $IN_DB, op schijf: $OP_SCHIJF, wees: $ALLE (waarvan $AANTAL ouder dan ${GRACE_DAYS}d: ${MB} MB)"

if [ "$AANTAL" -eq 0 ]; then log "niets te verplaatsen"; verslag 1 "niets te verplaatsen ($ALLE wees, nog binnen de wachttijd)"; exit 0; fi

if [ "$PROEF" -eq 1 ]; then
  log "proefdraai: er zou $AANTAL bestand(en) (${MB} MB) naar de prullenbak gaan"
  sed 's/^/  /' "$WERK/wezen.txt"
  exit 0
fi

DOEL="$PRULLENBAK/$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$DOEL"
while IFS= read -r rel; do
  mkdir -p "$DOEL/$(dirname "$rel")"
  mv "$UPLOADS/$rel" "$DOEL/$rel"
done < "$WERK/wezen.txt"
cp "$WERK/wezen.txt" "$DOEL/_verplaatst.txt"
log "$AANTAL bestand(en) (${MB} MB) verplaatst naar $DOEL"
verslag 1 "$AANTAL bestand(en) (${MB} MB) naar de prullenbak"

# Lege automappen achter laten is rommelig; de map zelf blijft staan zolang er foto's in zitten.
find "$UPLOADS" -mindepth 1 -type d -empty -delete 2>/dev/null || true

# Prullenbak legen na PURGE_DAYS.
VERLOPEN=$(find "$PRULLENBAK" -mindepth 1 -maxdepth 1 -type d -mtime +$PURGE_DAYS 2>/dev/null | wc -l)
if [ "$VERLOPEN" -gt 0 ]; then
  find "$PRULLENBAK" -mindepth 1 -maxdepth 1 -type d -mtime +$PURGE_DAYS -exec rm -rf {} + 2>/dev/null || true
  log "$VERLOPEN oude map(pen) definitief uit de prullenbak verwijderd (ouder dan ${PURGE_DAYS}d)"
fi
