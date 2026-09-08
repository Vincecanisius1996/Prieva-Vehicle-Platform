#!/bin/bash
# Zet de PVP-advertentierunner op deze Mac klaar. Bedoeld om één keer te draaien:
#
#     cd ~/pvp && git pull && bash beheer/mac/installeer.sh
#
# Doet alles behalve het denkwerk: controleert wat er moet zijn, maakt een nieuw token en zet dat
# op de server, installeert het script, en start de eerste ronde MET jou erbij zodat je de
# toestemmingen voor de browsertools kunt goedkeuren. Pas daarna gaat de timer aan.
#
# Alles is herhaalbaar: nog een keer draaien maakt een nieuw token en overschrijft het script.
set -uo pipefail

SERVER="${PVP_SERVER:-206.189.6.153}"
BASISURL="${PVP_BASISURL:-https://pvp.prieva.nl}"
ENVBESTAND="$HOME/.pvp-advertentie.env"
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HIER/../.." && pwd)"

groen() { printf '\033[32m%s\033[0m\n' "$1"; }
rood()  { printf '\033[31m%s\033[0m\n' "$1"; }
kop()   { printf '\n\033[1m== %s\033[0m\n' "$1"; }
stop()  { rood "GESTOPT: $1"; exit 1; }
vraag() { printf '%s [j/N] ' "$1"; read -r a </dev/tty; [ "$a" = "j" ] || [ "$a" = "J" ]; }

kop "1. Controleren wat er moet zijn"
for p in curl python3 openssl ssh; do
  command -v "$p" >/dev/null 2>&1 || stop "$p ontbreekt"
done
command -v claude >/dev/null 2>&1 || stop "Claude Code (claude) staat niet in het PATH. Installeer dat eerst."
[ -d "$REPO/.claude/skills/prieva-advertentie-assistent" ] || stop "de skills staan niet in $REPO — is de repo bijgewerkt? (git pull)"
groen "in orde: claude $(claude --version 2>/dev/null | head -1), repo $REPO"

kop "2. Token maken en naar de server zetten"
echo "Er wordt een nieuw token gemaakt op DEZE Mac en naar $SERVER gestuurd."
echo "Een eventueel oud token werkt daarna niet meer."
if vraag "Doorgaan?"; then
  TOK=$(openssl rand -hex 32)
  printf 'PVP_BASISURL=%s\nPVP_ADVERTENTIE_TOKEN=%s\nPVP_REPO=%s\n' "$BASISURL" "$TOK" "$REPO" > "$ENVBESTAND"
  chmod 600 "$ENVBESTAND"
  groen "geschreven: $ENVBESTAND"
  echo "Nu naar de server (er kan om je ssh-wachtwoord of sleutel gevraagd worden)…"
  ssh "root@$SERVER" "umask 077; printf 'PVP_ADVERTENTIE_TOKEN=%s\n' '$TOK' > /var/pvp/advertentie.env && systemctl restart pvp-api" \
    || stop "kon het token niet op de server zetten"
  groen "token staat op de server, pvp-api herstart"
else
  [ -r "$ENVBESTAND" ] || stop "geen token, en $ENVBESTAND bestaat nog niet"
  echo "Overgeslagen; het bestaande $ENVBESTAND wordt gebruikt."
fi

kop "3. Controleren of het token werkt"
set -a; . "$ENVBESTAND"; set +a
sleep 2                       # de service is net herstart
ANTW=$(curl -s -m 20 -H "Authorization: Bearer $PVP_ADVERTENTIE_TOKEN" "$BASISURL/api/advertentie-opdracht")
case "$ANTW" in
  *'"error"'*) rood "$ANTW"; stop "het token wordt niet geaccepteerd" ;;
  '')          stop "geen antwoord van $BASISURL" ;;
esac
LEEG=$(printf '%s' "$ANTW" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("leeg"))')
if [ "$LEEG" = "True" ]; then
  groen "verbinding werkt — er staat op dit moment niets klaar"
  OPDRACHT=""
else
  NAAM=$(printf '%s' "$ANTW" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["auto"]["naam"])')
  SOORT=$(printf '%s' "$ANTW" | python3 -c 'import json,sys; print(json.load(sys.stdin)["soortWerk"])')
  OPDRACHT=$(printf '%s' "$ANTW" | python3 -c 'import json,sys; print(json.load(sys.stdin)["opdracht"])')
  groen "verbinding werkt — eerste opdracht: $NAAM ($SOORT)"
fi

kop "4. Het script installeren"
mkdir -p "$HOME/bin" "$HOME/Library/Logs"
cp "$HIER/pvp-advertentie-runner.sh" "$HOME/bin/" && chmod +x "$HOME/bin/pvp-advertentie-runner.sh"
groen "geïnstalleerd: ~/bin/pvp-advertentie-runner.sh"

kop "5. De eerste ronde, met jou erbij"
cat <<'UITLEG'
Claude gaat nu de advertentie in Mobilox maken. Hij vraagt onderweg toestemming
voor de browsertools; keur die goed en kies waar het kan de optie die het
ONTHOUDT. Dat is de hele reden dat deze eerste ronde met de hand gaat: een
onbemande ronde kan zo'n vraag niet beantwoorden.

Let op dat hij:
  * NOOIT op "Plaats advertentie" klikt, alleen op "Advertentie bewaren"
  * GEEN vraagprijs invult
UITLEG
if [ -z "$OPDRACHT" ]; then
  echo "Er staat nu geen auto klaar, dus deze stap wordt overgeslagen."
elif [ -t 0 ] && vraag "Chrome open en ingelogd op members.mobilox.nl? Beginnen?"; then
  ( cd "$REPO" && claude "$OPDRACHT" )
  groen "ronde afgerond — kijk in PVP bij de auto of de stand op 'concept klaar' staat"
else
  echo "Overgeslagen. Je kunt hem later starten met:"
  echo "    cd $REPO && ~/bin/pvp-advertentie-runner.sh"
fi

kop "6. De timer"
echo "Zet de timer pas aan als een ronde zonder jouw tussenkomst goed ging."
if vraag "Timer nu aanzetten (elk half uur, ma-za 08:07-17:37)?"; then
  cp "$HIER/nl.prieva.pvp-advertentie.plist" "$HOME/Library/LaunchAgents/"
  launchctl unload "$HOME/Library/LaunchAgents/nl.prieva.pvp-advertentie.plist" 2>/dev/null
  launchctl load "$HOME/Library/LaunchAgents/nl.prieva.pvp-advertentie.plist" \
    && groen "timer staat aan" || rood "laden van de timer mislukt"
else
  echo "Later aanzetten:"
  echo "    cp $HIER/nl.prieva.pvp-advertentie.plist ~/Library/LaunchAgents/"
  echo "    launchctl load ~/Library/LaunchAgents/nl.prieva.pvp-advertentie.plist"
fi

kop "Klaar"
cat <<KLAAR
Meekijken:
    tail -f ~/Library/Logs/pvp-advertentie.log
Een ronde met de hand:
    ~/bin/pvp-advertentie-runner.sh
Timer uitzetten:
    launchctl unload ~/Library/LaunchAgents/nl.prieva.pvp-advertentie.plist

In PVP zie je op *Vandaag* een melding als de runner tijdens werktijd langer dan
90 minuten stilstaat, en op de autopagina bij de kaart Advertentie de stand per auto.
KLAAR
