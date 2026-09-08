# De advertentierunner op de Mac

Hier staan de twee bestanden die op de **Mac van Prieva** horen, niet op de droplet:

| Bestand | Waar het hoort |
|---|---|
| `pvp-advertentie-runner.sh` | `~/bin/` (chmod +x) |
| `nl.prieva.pvp-advertentie.plist` | `~/Library/LaunchAgents/` |

## Waarom niet op de server

Mobilox is een webapplicatie met een login. Het invoeren gebeurt in een browser die al is ingelogd,
en op de droplet staat geen browser. De verdeling is daarom:

- **PVP (droplet)** weet *welke* auto aan de beurt is en *wat* er moet gebeuren. Dat staat in
  `GET /api/advertentie-opdracht` — de complete instructie wordt daar samengesteld, zodat een
  wijziging in de werkwijze op één plek gebeurt en het script op de Mac niets hoeft te weten.
- **De Mac** voert het uit: Claude Code met de Chrome-extensie doet het werk in Mobilox en meldt de
  uitkomst terug.

## Eenmalig instellen

1. **Het token.** Op de server staat het in `/var/pvp/advertentie.env`. Zet op de Mac een
   `~/.pvp-advertentie.env` (chmod 600) met:
   ```
   PVP_BASISURL=https://pvp.prieva.nl
   PVP_ADVERTENTIE_TOKEN=<het token van de server>
   ```
   **Niet committen.** Intrekken = `/var/pvp/advertentie.env` leegmaken plus
   `systemctl restart pvp-api`; dat raakt de Mobilox-koppeling en het RDW-token niet.
2. **De repo.** Het script draait `claude -p` vanuit `~/pvp`, zodat de skills in `.claude/skills/`
   meekomen. Staat de kloon ergens anders, zet dan `PVP_REPO` in het env-bestand.
3. **Het script en de plist** neerzetten zoals in de tabel hierboven, dan:
   ```
   launchctl load ~/Library/LaunchAgents/nl.prieva.pvp-advertentie.plist
   launchctl start nl.prieva.pvp-advertentie      # meteen een keer proberen
   tail -f ~/Library/Logs/pvp-advertentie.log
   ```
4. **Chrome open laten staan**, ingelogd op `members.mobilox.nl`.

## Wat het token mag

Precies drie dingen: de werklijst lezen, één opdracht ophalen en de stand terugmelden. Geen toegang
tot `/uploads`, geen catalogus, en het kan niets aan een auto wijzigen. Bewust een eigen token en
niet `PVP_VERKOOP_TOKEN` of `PVP_RDW_TOKEN` hergebruikt: een andere partij, een ander doel, en apart
in te trekken.

## Hoe je ziet of hij loopt

Elke ronde meldt zich in `agent_runs` onder de naam `advertentie` — ook als er niets te doen was.
Staat de Mac uit of is Chrome dicht, dan verschijnt er na 90 minuten stilte een melding op *Vandaag*.
Dat is het hele punt: **niets doen ziet er anders precies zo uit als "niets te doen".**

## Wat er bewust níét in zit

- **Publiceren.** De runner slaat op als concept. Online zetten blijft een handeling van Prieva.
- **Een vraagprijs.** Die staat nergens in PVP en wordt niet verzonnen.
- **Meer dan één auto per ronde.** Gaat er iets mis, dan gaat er één advertentie mis en niet tien.
- **Draaien buiten werktijd.** Er moet iemand in de buurt zijn die kan ingrijpen als Mobilox iets
  onverwachts doet. Zelfde gedachte als bij de Mobilox-koppeling op de server.
