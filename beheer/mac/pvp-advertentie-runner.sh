#!/bin/bash
# PVP -> Mobilox: maakt onbemand de advertenties die klaarstaan.
#
# WAAROM DIT OP DE MAC DRAAIT EN NIET OP DE DROPLET
#   Mobilox is een webapplicatie met een login; het invoeren gebeurt in een browser die al is
#   ingelogd. Op de droplet staat geen browser. Dit script draait daarom op de Mac van Prieva, waar
#   Chrome aan Claude gekoppeld is via de extensie.
#
# WAT HET DOET, ELKE RONDE
#   1. vraagt PVP om een opdracht (welke auto, en wat er moet gebeuren);
#   2. is er niets, dan meldt het dat en stopt;
#   3. is er wel iets: zet de auto op `bezig`, laat Claude de advertentie maken, en meldt terug;
#   4. meldt elke ronde hoe het ging, zodat een Mac die uit staat zichtbaar wordt op *Vandaag*.
#      Niets doen ziet er anders precies zo uit als "niets te doen".
#
# EENMALIG INSTELLEN
#   1. ~/.pvp-advertentie.env aanmaken (chmod 600), met daarin:
#        PVP_BASISURL=https://pvp.prieva.nl
#        PVP_ADVERTENTIE_TOKEN=<het token uit /var/pvp/advertentie.env op de server>
#   2. dit script in ~/bin/ zetten en uitvoerbaar maken (chmod +x)
#   3. nl.prieva.pvp-advertentie.plist in ~/Library/LaunchAgents/ zetten en laden:
#        launchctl load ~/Library/LaunchAgents/nl.prieva.pvp-advertentie.plist
#   4. Chrome open laten staan, ingelogd op members.mobilox.nl.
#
# EEN AUTO PER RONDE, met opzet: gaat er iets mis, dan gaat er een advertentie mis en niet tien.
set -uo pipefail

ENVBESTAND="$HOME/.pvp-advertentie.env"
REPO="${PVP_REPO:-$HOME/pvp}"          # de gekloonde repo, voor de skills in .claude/skills/
LOG="$HOME/Library/Logs/pvp-advertentie.log"
MAX_MINUTEN=25                          # daarna afbreken: een vastgelopen browser mag niet blijven hangen

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"; }
json() { python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'; }
lees() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }

[ -r "$ENVBESTAND" ] || { log "FOUT: $ENVBESTAND ontbreekt"; exit 1; }
set -a; . "$ENVBESTAND"; set +a
: "${PVP_BASISURL:=https://pvp.prieva.nl}"
[ -n "${PVP_ADVERTENTIE_TOKEN:-}" ] || { log "FOUT: geen token in $ENVBESTAND"; exit 1; }

KOP=(-H "Authorization: Bearer $PVP_ADVERTENTIE_TOKEN" -H "Content-Type: application/json")

# Het verslag mag de ronde zelf nooit laten mislukken - zelfde regel als bij de back-ups.
verslag() {
  curl -sS -m 20 "${KOP[@]}" -X POST "$PVP_BASISURL/api/advertentie-ronde" \
    -d "{\"ok\":$1,\"melding\":$(printf '%s' "$2" | json)}" >/dev/null 2>&1 || true
}
afloop() {
  code=$?
  [ "$code" -ne 0 ] && { log "afgebroken (exitcode $code)"; verslag false "runner afgebroken (exitcode $code)"; }
  return 0
}
trap afloop EXIT

OPDRACHT_JSON=$(curl -sS -m 30 "${KOP[@]}" "$PVP_BASISURL/api/advertentie-opdracht") || {
  log "PVP niet bereikbaar"; verslag false "PVP niet bereikbaar vanaf de Mac"; exit 1; }

if [ "$(printf '%s' "$OPDRACHT_JSON" | lees '.get("leeg")')" = "True" ]; then
  log "niets te doen"; verslag true "niets te doen"; exit 0
fi

AUTO=$(printf '%s' "$OPDRACHT_JSON" | lees '["auto"]["id"]')
NAAM=$(printf '%s' "$OPDRACHT_JSON" | lees '["auto"]["naam"]')
SOORT=$(printf '%s' "$OPDRACHT_JSON" | lees '["soortWerk"]')
OPDRACHT=$(printf '%s' "$OPDRACHT_JSON" | lees '["opdracht"]')

log "opdracht: $NAAM ($AUTO, $SOORT)"

# macOS heeft van huis uit geen `timeout` (dat is GNU-gereedschap). Met coreutils heet het
# `gtimeout`. Is geen van beide er, dan draaien we zonder harde tijdslimiet - liever een ronde die
# lang duurt dan een ronde die helemaal niet loopt. De launchd-unit start hem toch pas een half uur
# later opnieuw, en er is geen tweede tegelijk omdat de auto meteen op `bezig` gaat.
if command -v timeout >/dev/null 2>&1;      then KLOK=(timeout "${MAX_MINUTEN}m")
elif command -v gtimeout >/dev/null 2>&1;   then KLOK=(gtimeout "${MAX_MINUTEN}m")
else KLOK=(); log "let op: geen timeout/gtimeout gevonden - de ronde loopt zonder tijdslimiet"; fi

stand() {
  curl -sS -m 20 "${KOP[@]}" -X POST "$PVP_BASISURL/api/advertentie-stand" \
    -d "{\"id\":\"$AUTO\",\"stand\":\"$1\",\"melding\":$(printf '%s' "$2" | json)}" >/dev/null 2>&1 || true
}

# Meteen op `bezig`: gaat de ronde onderuit, dan zie je in PVP dat er iemand mee bezig was, en pakt
# de volgende ronde hem niet nog een keer op (de opdrachtlijst geeft alleen auto's met stand=open).
stand bezig "runner gestart $(date '+%d-%m-%Y %H:%M')"

command -v claude >/dev/null 2>&1 || { log "FOUT: claude staat niet in het PATH"; verslag false "claude niet gevonden op de Mac"; exit 1; }
[ -d "$REPO" ] || { log "FOUT: repo $REPO bestaat niet"; verslag false "repo niet gevonden: $REPO"; exit 1; }

UIT=$(cd "$REPO" && "${KLOK[@]}" claude -p "$OPDRACHT" 2>&1)
CODE=$?

if [ "$CODE" -eq 0 ]; then
  log "klaar: $NAAM"
  # De stand op `concept` zet Claude zelf via het endpoint; dat staat in de opdracht. Blijft hij op
  # `bezig` staan, dan is de advertentie niet af - en dat is dan de eerlijke stand.
  verslag true "advertentie voorbereid: $NAAM"
else
  log "MISLUKT ($CODE): $NAAM - $(printf '%s' "$UIT" | tail -3 | tr '\n' ' ')"
  stand bezig "runner liep vast $(date '+%d-%m-%Y %H:%M') - zie ~/Library/Logs/pvp-advertentie.log"
  verslag false "advertentie mislukt: $NAAM (exitcode $CODE)"
fi
