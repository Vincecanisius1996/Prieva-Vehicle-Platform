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

## Er is tóch een API (20-08-2026)

Bij het meekijken met het netwerkverkeer bleek de webomgeving zelf te praten met
**`https://api.mobilox.nl/api/v2/`**. Mobilox biedt geen API aan voor administratie, maar hun eigen
portaal gebruikt er een — en die is met dezelfde sessie te bereiken:

```
GET https://api.mobilox.nl/api/v2/quotations?type=<n>&year=<jjjj>
```

| type | wat | aantal (2026) |
|---|---|---|
| 1 | offertes | 80 |
| 2 | verkoopovereenkomsten | 109 |
| 3 | facturen | 189 |

**Daarmee vervalt het uitlezen van schermen.** Geen selectors die breken bij een opmaakwijziging, geen
doorklikken per regel: één verzoek levert alles als JSON. De verkenners in deze map (`verken.js`,
`menu.js`, `klap.js`, `schermen.js`, `factuur.js`, `factuurdetail.js`, `knoppen.js`, `api.js`,
`product.js`) blijven staan als gereedschap om dit opnieuw uit te zoeken als Mobilox iets wijzigt.

### Wat één regel bevat
```
id, number                       overeenkomst-/factuurnummer
createdAt                        datum (dd-mm-jjjj)
deliveryDate                     GEWENSTE AFLEVERDATUM  <- waar Carport op wacht
price, amountToPay, bpm, taxType bedragen en Marge/BTW
product.id                       leidt naar #vehicles/{id}
product.attributeValues.VIN      chassisnummer, 17 tekens
product.attributeValues.LICEN    kenteken
product.attributeValues.REPORTING_CODE   meldcode
tradeVehicleText/Price/License/Vin/Milage/Bpm   de INRUIL, als losse velden
customer{...}                    persoonsgegevens van de koper
handledBy                        wie het opmaakte
```

### Regels voor de agent
- **Koppelen op `VIN`**, niet op de omschrijving. `product.title` is vrije tekst ("BMW 2-serie Active
  Tourer 218i Sport") en daar valt geen auto mee terug te vinden.
- **`customer` wordt niet bewaard.** Naam, adres, telefoon en e-mail van de koper horen niet in PVP —
  zelfde regel als in `uitlezen/`. Alleen datum, bedrag, VIN/kenteken en de inruilvelden.
- **`deliveryDate` vult de afleverdatum van de Carport-werkbon.** Die werd tot nu toe met de hand
  ingevuld; 158 van de 189 facturen hebben hem.
- **De agent bevestigt nooit zelf een verkoop**: melden via `POST /api/verkocht` (status
  `gemeld verkocht`), een beheerder bevestigt.
- De sessie komt uit de browserlogin en staat in `/var/pvp/mobilox-sessie.json`. Zodra die er is kan
  het ophalen met een gewone `fetch` vanuit Node; de browser is dan alleen nog nodig om opnieuw in te
  loggen als de sessie verloopt.

## agent.js

Haalt overeenkomsten en facturen op, legt ze naast PVP en meldt wat er verkocht is. Zonder `--echt`
wordt er niets geschreven.

```
set -a; . /var/pvp/pg.env; set +a
node agent.js            # proefdraai
cd /root/pvp/mobilox && node agent.js --echt
```

### Wat hij doet
1. **Koppelt op VIN.** Eerste echte ronde (20-08-2026): 298 regels, 15 gekoppeld op VIN, 0 op
   kenteken, 0 misgekoppeld. De 283 zonder auto zijn ouder dan de huidige voorraad — Mobilox houdt
   het hele jaar, PVP alleen wat er nu staat.
2. **Een factuur wint van een overeenkomst.** Staan ze allebei voor dezelfde auto, dan telt de
   factuur: die heeft het definitieve nummer, de datum en het bedrag. De verliezer wordt wél als
   gezien vastgelegd (`uitkomst = overgeslagen`) — anders blijft hij elke ronde "nieuw" en botst hij
   tegen het factuurnummer dat er al staat. Dat ging de eerste keer mis: drie botsingen per ronde.
3. **Meldt via `POST /api/verkocht`** met het token uit `/var/pvp/verkoop.env`. Status wordt
   `gemeld verkocht`; **een beheerder bevestigt**. De agent maakt nooit zelf een verkoop definitief.
4. **Zet de afleverdatum bij Carport**, maar alleen als die datum nog moet komen. Een aflevering uit
   april is geschiedenis, geen planning.
5. **Legt inruilauto's vast als voorstel** in `mobilox_inruil`. Nooit zelf toevoegen aan de
   catalogus: een verkeerde regel daar werkt door in het Autoboek en in de rapportage. Van de 125
   voorstellen heeft er **0 een VIN en 124 een kenteken** — koppelen gaat daar dus op kenteken.

### Geheugen
`mobilox_gezien` (soort + extern_id) zorgt dat een verkoop niet elke ronde opnieuw gemeld wordt.
Getoetst: tweede en derde ronde melden niets.

### Wat er niet wordt bewaard
Het blok `customer` uit de API — naam, adres, telefoonnummer, e-mailadres van de koper. Alleen datum,
bedrag, VIN/kenteken en de inruilvelden.
