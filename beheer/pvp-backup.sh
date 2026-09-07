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


# ===== Verslag naar PVP =====
# Zodat een mislukte nacht op *Vandaag* verschijnt in plaats van alleen in journalctl. Een back-up
# die stil faalt is het gevaarlijkst: je denkt dat je gedekt bent. Precies dat gebeurde van 29-08 tot
# 07-09-2026 — dertien nachten, en niemand die het zag.
# Het melden mag de back-up zelf NOOIT laten mislukken: vandaar de subshell en `|| true`.
verslag() {
  [ -r /var/pvp/pg.env ] || return 0
  ( set +e; set -a; . /var/pvp/pg.env; set +a
    node /opt/pvp-api/agentrun.js backup "$1" "$2" ) >/dev/null 2>&1 || true
}
# Via EXIT en niet via ERR: zo wordt elke manier van stukgaan gemeld, ook een `exit 1` halverwege.
afloop() {
  code=$?
  [ "$code" -ne 0 ] && verslag 0 "mislukt (exitcode $code) — zie: journalctl -u pvp-backup"
  return 0
}
trap afloop EXIT

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

# Controles: is het gzip-bestand heel, en staat de belangrijkste tabel er echt in MET rijen?
gzip -t "$FILE"

# LET OP — hier zat een valstrik. Dit was eerst `gunzip -c "$FILE" | grep -q '^COPY public.vehicles '`.
# `grep -q` stopt bij de eerste treffer en sluit de pijp; gunzip krijgt dan SIGPIPE en eindigt met
# 141, en door `pipefail` telt de hele pijplijn als mislukt. De controle concludeerde dus dat
# `vehicles` ontbrak en gooide een pérfecte back-up weg.
# Zolang de dump klein was viel dat niet op: gunzip was dan al klaar met schrijven vóór grep stopte.
# Toen de dump groeide (foto's die als base64 in de database beland waren) sloeg het elke nacht toe —
# van 29-08 t/m 07-09-2026 dertien nachten geen lokale back-up, zonder dat iemand het zag.
# Daarom leest awk hieronder de stroom HELEMAAL uit: geen vroegtijdige exit, dus geen SIGPIPE.
# En het telt meteen de datarijen, want een COPY-regel zonder rijen eronder is ook geen back-up.
RIJEN=$(gunzip -c "$FILE" | awk '
  /^COPY public\.vehicles /{inh=1; next}
  inh && /^\\\.$/{inh=0; next}
  inh{n++}
  END{print n+0}')
if [ "${RIJEN:-0}" -lt 1 ]; then
  logger -t pvp-backup "FOUT: $FILE bevat geen voertuigrijen — back-up verwijderd"
  echo "FOUT: de dump bevat geen tabel vehicles met inhoud." >&2
  rm -f "$FILE"
  exit 1
fi

find "$DEST" -name "$DB-*.sql.gz" -mtime +$KEEP_DAYS -delete
logger -t pvp-backup "geschreven: $FILE ($(stat -c %s "$FILE") bytes)"
verslag 1 "database-back-up geschreven: $(stat -c %s "$FILE") bytes, $RIJEN voertuigen"
