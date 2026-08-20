# Mobilox-agent

Mobilox biedt **geen API voor administratie** (bevestigd door Prieva, 20-08-2026). De Hexon
DV-koppeling waar Mobilox wél toegang toe geeft, gaat over voorraad en adverteren — daar zitten geen
verkoopovereenkomsten of facturen in. Daarom leest deze agent de webomgeving uit met een browser.

## Waarom dit los van de API staat
`server.js` blijft puur Node met alleen `pg`; die regel uit `CLAUDE.md` blijft overeind. Deze map
heeft een eigen `node_modules` (playwright, 19 MB) en een eigen browser (656 MB in
`/root/.cache/ms-playwright`). De agent draait straks op een timer, niet in het API-proces — een
browser die geheugen vraagt hoort niet in het pad van een gebruiker die op een knop drukt.

## Inloggegevens
In `/var/pvp/mobilox.env`, chmod 600, **niet in de repo en niet via de chat**:

```
MOBILOX_URL=https://...
MOBILOX_GEBRUIKER=...
MOBILOX_WACHTWOORD=...
```

De sessie wordt bewaard in `/var/pvp/mobilox-sessie.json` (chmod 600). Bij tweestapsverificatie log
je één keer met de hand in (`node verken.js --zichtbaar`) en hergebruikt de agent die sessie tot hij
verloopt.

## verken.js
Beschrijft de **structuur** van de pagina's: adressen, invoervelden, links, knoppen, tabelkoppen en
het aantal rijen. **Bewust geen celinhoud** — om selectors te schrijven is de vorm nodig, geen
klantgegevens. De uitvoer komt in `verkenning.txt`, die staat in `.gitignore`.

## Wat de agent straks doet
1. Nieuwe **verkoopovereenkomsten**: de auto op `gemeld verkocht` zetten via het bestaande
   `POST /api/verkocht`. Dat endpoint is idempotent, legt elke melding vast in `verkoop_meldingen`
   en zet een auto nooit zelf op verkocht — een beheerder bevestigt. Die scheiding blijft: een agent
   die uit een scherm leest, mag niet zelfstandig de administratie sluiten.
2. Nieuwe **facturen**: verkoopdatum en verkoopprijs in/in erbij, zodat bevestigen één klik is.
3. **Inruil** uit de factuur: die auto als nieuwe regel voorstellen voor Lopende.

## Wat er níét wordt bewaard
Alleen wat PVP nodig heeft: datum, bedrag, kenteken/VIN. **Geen naam, adres, telefoonnummer of
e-mailadres van de koper** — zelfde regel als in `uitlezen/`.

## Broosheid
Een agent die een scherm leest, breekt zodra Mobilox dat scherm wijzigt. Daarom: hij moet **luid
falen** (melding in het logboek en zichtbaar in PVP), nooit stil een lege uitkomst opleveren. Een
lege oogst is verdacht, geen resultaat.

## Verkenning (20-08-2026)

**Inloggen** gaat op `https://members.mobilox.nl/` — niet op `www.mobilox.nl/pro/`, dat is de
reclamesite. Velden: `#_username` (e-mail) en `#_password`. Geen tweestapsverificatie.

**Het is een SPA met hash-routes.** Een volledige paginalading met `#agreements` erachter valt terug
op het dashboard; navigeren moet dus via **klikken** in het menu. Het menu *Administratie* is
ingeklapt en levert zijn routes pas na een klik:

```
#customers  #quotations  #agreements  #invoices  #creditinvoices  #purchases
```

Na het klikken wordt het adres `#administration/agreements` respectievelijk `.../invoices`.

**Lijstweergave** (overeenkomsten én facturen), 15 regels per keer:

| Datum | Nummer | Naam | Voertuig | Totaal |
|---|---|---|---|---|
| dd-mm-jjjj | 999 | klantnaam | omschrijving, géén kenteken | € 9.999,99 |

Filters: `search`, `year`, en bij facturen ook `startDate`/`endDate` — bruikbaar om alleen nieuwe op
te halen.

**De sleutel zit in de doorklik.** De kolom *Voertuig* bevat alleen een omschrijving, waarmee een
auto niet terug te vinden is in PVP. Maar een regel aanklikken springt door naar `#vehicles/{id}`, en
op die pagina staan **Kenteken, Meldcode en VIN** — plus merk, model, tellerstand, inkoopprijs en
bruto BPM. Daarmee is de koppeling met PVP hard te maken op het chassisnummer.

**Nog uit te zoeken:** waar de inruil in de factuur staat, en of de verkoopprijs in/in op de
factuurdetailpagina te vinden is of alleen als *Totaal* in de lijst.
