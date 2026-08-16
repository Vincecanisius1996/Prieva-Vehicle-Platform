#!/bin/bash
# Stap A van het uploads-back-upplan: lokale momentopnamen van /var/pvp/uploads.
#
# Elke nacht een complete, direct bruikbare kopie. Bestanden die niet veranderd zijn, krijgen géén
# nieuwe schijfruimte maar een harde koppeling (hardlink) naar het blok van de vorige nacht. Omdat de
# app bestanden nooit overschrijft — elke upload krijgt een eigen willekeurige naam — verandert er in
# de praktijk niets, en kost een reeks momentopnamen dus nauwelijks meer dan één kopie.
#
# WAARTEGEN DIT BESCHERMT: per ongeluk verwijderde foto's, een fout in de app, een verkeerde opruiming.
# WAARTEGEN NIET: verlies van de droplet zelf. Dat is stap B (kopie buiten de server) uit
# PVP-uploads-backup-voorstel.md en staat nog open.
#
# Terugzetten van één foto:
#   cp /var/backups/pvp/uploads/laatste/<auto>/<bestand> /var/pvp/uploads/<auto>/
# Alles terugzetten:
#   rsync -a /var/backups/pvp/uploads/<stempel>/ /var/pvp/uploads/
# (De URL's in de database wijzen naar hetzelfde pad, dus verder is er niets aan te passen.)
set -euo pipefail

BRON=/var/pvp/uploads
DEST=/var/backups/pvp/uploads
KEEP_DAYS=14
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
NIEUW="$DEST/$STAMP"
LAATSTE="$DEST/laatste"

log() { logger -t pvp-uploads-snapshot "$1"; echo "$1"; }
afbreken() { logger -t pvp-uploads-snapshot "AFGEBROKEN: $1"; echo "AFGEBROKEN: $1" >&2; exit 1; }

[ -d "$BRON" ] || afbreken "$BRON bestaat niet"

umask 077
mkdir -p "$DEST"
chmod 700 /var/backups/pvp "$DEST"

# Koppelen aan de vorige momentopname, als die er is.
KOPPEL=()
if [ -d "$LAATSTE" ]; then KOPPEL=(--link-dest="$(readlink -f "$LAATSTE")"); fi

rsync -a "${KOPPEL[@]}" "$BRON/" "$NIEUW/"

# Verificatie: evenveel bestanden en evenveel bytes als de bron. Een momentopname die stilletjes
# half is, is erger dan geen momentopname.
BRON_N=$(find "$BRON" -type f | wc -l)
SNAP_N=$(find "$NIEUW" -type f | wc -l)
BRON_B=$(find "$BRON" -type f -printf '%s\n' | awk '{s+=$1} END {print s+0}')
SNAP_B=$(find "$NIEUW" -type f -printf '%s\n' | awk '{s+=$1} END {print s+0}')
if [ "$BRON_N" != "$SNAP_N" ] || [ "$BRON_B" != "$SNAP_B" ]; then
  rm -rf "$NIEUW"
  afbreken "momentopname wijkt af van de bron (bron $BRON_N bestanden/$BRON_B bytes, kopie $SNAP_N/$SNAP_B) — kopie weggegooid"
fi

ln -sfn "$NIEUW" "$LAATSTE"

# Hoeveel schijfruimte deze momentopname écht kost. `du` op de map alleen deugt hier niet: die telt
# elk bestand mee, ook als het een hardlink naar de vorige nacht is, en meldt dus de volle 571 MB
# terwijl er niets bij kwam. Bestanden die rsync echt heeft gekopieerd hebben één link; alles wat
# ongewijzigd was is gekoppeld aan de vorige momentopname en heeft er twee of meer.
NIEUWE_N=$(find "$NIEUW" -type f -links 1 | wc -l)
NIEUWE_B=$(find "$NIEUW" -type f -links 1 -printf '%s\n' | awk '{s+=$1} END {print s+0}')
ECHT=$(awk "BEGIN{b=$NIEUWE_B; printf (b<1048576 ? \"%.0f KB\" : \"%.0f MB\"), (b<1048576 ? b/1024 : b/1048576)}")
TOTAAL=$(du -sh --exclude=laatste "$DEST" 2>/dev/null | cut -f1)
AANTAL=$(find "$DEST" -mindepth 1 -maxdepth 1 -type d | wc -l)

# Oude momentopnamen opruimen (de symlink 'laatste' blijft buiten schot).
VERLOPEN=$(find "$DEST" -mindepth 1 -maxdepth 1 -type d -mtime +$KEEP_DAYS | wc -l)
if [ "$VERLOPEN" -gt 0 ]; then
  find "$DEST" -mindepth 1 -maxdepth 1 -type d -mtime +$KEEP_DAYS -exec rm -rf {} + 2>/dev/null || true
  AANTAL=$(find "$DEST" -mindepth 1 -maxdepth 1 -type d | wc -l)
fi

OPGERUIMD=""
[ "$VERLOPEN" -gt 0 ] && OPGERUIMD=", $VERLOPEN verlopen verwijderd"
log "momentopname $STAMP: $SNAP_N bestanden, waarvan $NIEUWE_N nieuw ($ECHT); de rest gedeeld met de vorige nacht. $AANTAL momentopnamen samen $TOTAAL$OPGERUIMD"
