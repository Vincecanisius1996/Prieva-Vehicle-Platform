#!/bin/bash
# Stap B van het uploads-back-upplan: een versleutelde kopie van PVP BUITEN de droplet.
#
# WAAROM DIT NAAST DE ANDERE TWEE BESTAAT:
#   pvp-backup.sh        (02:15) -> pg_dump naar /var/backups/pvp        - op dezelfde schijf
#   pvp-uploads-snapshot (02:30) -> momentopname van de foto's           - op dezelfde schijf
#   dit script           (03:00) -> alles naar Backblaze B2, Amsterdam   - buiten de server
# De eerste twee beschermen tegen een fout in de app of een verkeerde druk op een knop. Alleen dit
# script beschermt tegen het kwijtraken van de droplet zelf: brand, een verwijderd account, ransomware.
#
# VERSLEUTELD VOOR HET VERTREKT: restic versleutelt lokaal, Backblaze ziet alleen blokken zonder
# betekenis. Kentekenbewijzen en vrijwaringen liggen dus niet leesbaar bij een externe partij.
#
# TWEE MOMENTOPNAMEN PER NACHT, elk met een eigen tag:
#   tag 'db'        - een verse pg_dump van de database pvp (via stdin, niet het gzip-bestand:
#                     onversleutelde SQL laat restic dedupliceren, een gzip verandert elke nacht volledig)
#   tag 'bestanden' - /var/pvp/uploads plus de sleutels en configuratie die nodig zijn om de server
#                     opnieuw op te bouwen
#
# TERUGZETTEN (het hele punt van dit script — zie ook de kop van CLAUDE.md):
#   set -a; . /var/pvp/restic.env; set +a
#   restic snapshots                                  # wat is er?
#   restic restore latest --tag bestanden --target /   # foto's en config terug op hun plek
#   restic dump latest --tag db pvp.sql | psql "$PVP_PG"
#
# ZONDER RESTIC_PASSWORD IS ER NIETS TERUG TE ZETTEN. Door niemand, ook niet door Backblaze. Dat
# wachtwoord staat in /var/pvp/restic.env op deze server; een kopie hoort in een wachtwoordkluis
# buiten de server te liggen. Anders beschermt deze back-up tegen niets.
set -euo pipefail

BRON_UPLOADS=/var/pvp/uploads
KEEP_DAILY=14
KEEP_WEEKLY=8
KEEP_MONTHLY=12
# Elke nacht een dertigste van de data echt terugdownloaden en narekenen. Over een maand is daarmee
# alles gecontroleerd, terwijl het dataverkeer binnen de gratis marge van B2 blijft (3x het opgeslagen
# volume per maand). Een back-up die je nooit uitleest, is een aanname, geen back-up.
LEES_DEEL=1/30

log() { logger -t pvp-offsite "$1"; echo "$1"; }
afbreken() { logger -t pvp-offsite "AFGEBROKEN: $1"; echo "AFGEBROKEN: $1" >&2; exit 1; }

DUMP=""
opruimen() { [ -n "$DUMP" ] && rm -f "$DUMP"; }
trap opruimen EXIT

# --- Controles vóóraf. Liever hier stoppen dan een halve momentopname wegschrijven. ---
command -v restic >/dev/null || afbreken "restic is niet geïnstalleerd"
[ -n "${RESTIC_REPOSITORY:-}" ] || afbreken "RESTIC_REPOSITORY ontbreekt (staat /var/pvp/restic.env in de unit?)"
[ -n "${RESTIC_PASSWORD:-}" ]   || afbreken "RESTIC_PASSWORD ontbreekt"
[ -n "${PVP_PG:-}" ]            || afbreken "PVP_PG ontbreekt (staat /var/pvp/pg.env in de unit?)"
case "$RESTIC_REPOSITORY$AWS_ACCESS_KEY_ID$AWS_SECRET_ACCESS_KEY" in
  *VUL-*) afbreken "/var/pvp/restic.env is nog niet ingevuld (er staat nog VUL-…-IN)" ;;
esac
[ -d "$BRON_UPLOADS" ] || afbreken "$BRON_UPLOADS bestaat niet"

# Is de repository al aangemaakt? Bewust niet automatisch initialiseren: een nachtelijke timer die
# uit zichzelf een lege repository aanlegt, verbergt precies de fout die je wilt zien (verkeerde
# bucket, verkeerde sleutel) achter een geslaagde back-up van niets.
if ! restic cat config >/dev/null 2>&1; then
  afbreken "repository bestaat niet of is onbereikbaar — eenmalig 'restic init' doen, of controleer bucket/sleutel"
fi

# --- 1. Database ---
# Naar een bestand en niet rechtstreeks de pijp in: dan kan ik controleren of de dump deugt vóórdat
# hij als geldige back-up in de repository belandt. Een lege dump die netjes uploadt is een valkuil.
umask 077
DUMP=$(mktemp /tmp/pvp-offsite-XXXXXX.sql)
pg_dump "$PVP_PG" > "$DUMP" || afbreken "pg_dump mislukt"
grep -q 'CREATE TABLE public.vehicles' "$DUMP" || afbreken "dump bevat de tabel vehicles niet — niet geüpload"
grep -q 'COPY public.vehicles'         "$DUMP" || afbreken "dump bevat geen rijen voor vehicles — niet geüpload"
DUMP_B=$(stat -c %s "$DUMP")

restic backup --tag db --stdin --stdin-filename pvp.sql --retry-lock 5m < "$DUMP" >/dev/null \
  || afbreken "upload van de database mislukt"

# --- 2. Bestanden ---
# uploads = de foto's en BPM-rapporten, het onvervangbare deel: die staan nergens anders.
# secret   = de HMAC-sleutel van de sessiecookie; zonder deze wordt iedereen uitgelogd na een herbouw.
# pg.env   = het databasewachtwoord.
# De rest is code en configuratie: staat ook in git, maar het scheelt uitzoekwerk op een slechte dag.
PADEN=("$BRON_UPLOADS")
for p in /var/pvp/secret /var/pvp/pg.env /opt/pvp-api /etc/nginx/sites-available/default; do
  [ -e "$p" ] && PADEN+=("$p")
done
for p in /usr/local/bin/pvp-*.sh /etc/systemd/system/pvp-*; do
  [ -e "$p" ] && PADEN+=("$p")
done
# restic.env zit er bewust NIET bij: het wachtwoord waarmee je de kluis opent, hoort niet in de kluis.

restic backup --tag bestanden --retry-lock 5m "${PADEN[@]}" >/dev/null \
  || afbreken "upload van de bestanden mislukt"

# --- 3. Oude momentopnamen opruimen ---
# Per tag apart bewaren (--group-by tags), anders duwen de twee reeksen elkaar uit de bewaartermijn.
restic forget --tag db --tag bestanden --group-by tags \
  --keep-daily $KEEP_DAILY --keep-weekly $KEEP_WEEKLY --keep-monthly $KEEP_MONTHLY \
  --prune --retry-lock 5m >/dev/null || log "WAARSCHUWING: opruimen mislukt (de back-up van vannacht staat er wél)"

# --- 4. Controleren ---
if ! restic check --read-data-subset=$LEES_DEEL --retry-lock 5m >/dev/null 2>&1; then
  afbreken "restic check meldt een probleem met de repository — de back-up van vannacht staat er, maar er is iets mis; onderzoek met 'restic check --read-data-subset=1/1'"
fi

UPL_N=$(find "$BRON_UPLOADS" -type f | wc -l)
OMVANG=$(restic stats --mode raw-data --json 2>/dev/null | grep -o '"total_size":[0-9]*' | cut -d: -f2)
OMVANG_H=$(awk "BEGIN{b=${OMVANG:-0}; printf (b<1073741824 ? \"%.0f MB\" : \"%.1f GB\"), (b<1073741824 ? b/1048576 : b/1073741824)}")
DUMP_H=$(awk "BEGIN{printf \"%.0f KB\", $DUMP_B/1024}")

log "buiten de droplet: database ($DUMP_H) + $UPL_N bestanden geüpload; repository nu $OMVANG_H, $LEES_DEEL nagerekend"
