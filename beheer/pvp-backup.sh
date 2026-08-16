#!/bin/bash
# Nachtelijke logische back-up van ALLEEN de PVP-database (`pvp`).
#
# Beschermt tegen een foute migratie, een per ongeluk uitgevoerde DROP/DELETE of corruptie.
# NIET tegen verlies van de hele droplet: dit is een lokale kopie. Een kopie buiten de server
# (object storage) is nog te regelen.
#
# LET OP — wat hier NIET in zit:
#   * /var/pvp/uploads  (foto's en BPM-rapporten, honderden MB's). De database bevat alleen de URL's;
#     na een herstel uit deze dump verwijzen die naar bestanden die er dan niet zijn.
#   * /var/pvp/secret   (HMAC-sleutel sessiecookie). Kwijtraken betekent alleen: iedereen opnieuw inloggen.
#
# Herstellen:
#   systemctl stop pvp-api
#   gunzip -c /var/backups/pvp/pvp-<stempel>.sql.gz | sudo -u postgres psql -d pvp
#   systemctl start pvp-api
#
# Raakt CRP niet aan: dumpt uitsluitend de database `pvp`, schrijft uitsluitend in /var/backups/pvp.
set -euo pipefail

DB=pvp
DEST=/var/backups/pvp
KEEP_DAYS=30
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$DEST/$DB-$STAMP.sql.gz"

umask 077
mkdir -p "$DEST"
chmod 700 "$DEST"

# Dumpen als systeemgebruiker postgres (peer-auth via de unix-socket; geen wachtwoord in dit script).
sudo -u postgres pg_dump --clean --if-exists "$DB" | gzip -9 > "$FILE"
chmod 600 "$FILE"

# Controles: is het gzip-bestand heel, en staat de belangrijkste tabel er echt in?
gzip -t "$FILE"
if ! gunzip -c "$FILE" | grep -q '^COPY public.vehicles '; then
  logger -t pvp-backup "FOUT: $FILE bevat geen voertuigen — back-up verwijderd"
  echo "FOUT: de dump bevat geen tabel vehicles met inhoud." >&2
  rm -f "$FILE"
  exit 1
fi

find "$DEST" -name "$DB-*.sql.gz" -mtime +$KEEP_DAYS -delete
logger -t pvp-backup "geschreven: $FILE ($(stat -c %s "$FILE") bytes)"
