# PVP ↔ Autoboek — voorstel voor de instroom van nieuw ingekochte auto's

Status: **verkenning afgerond, ontwerp nog niet gebouwd.** Opgesteld 17-08-2026.
Er is nog **niets** naar het Autoboek geschreven en er is nog geen regel code voor gemaakt.

## Waarom, en waarom de richting omdraait

In de roadmap stond Fase 3 als "automatische instroom van Komende auto's **uit** het Autoboek".
Bij het uitzoeken bleek de wens andersom: **PVP wordt het invoerpunt** en het Autoboek krijgt de regel
erbij. Reden: nieuwe auto's worden nu op twee plekken met de hand vastgelegd, en dat loopt aantoonbaar
mis (zie hieronder). Eén invoerpunt lost dat op; een spiegel van het Autoboek zou het probleem alleen
verplaatsen.

## Het bewijs dat de instroom lekt

Op 17-08-2026 naast elkaar gelegd (PVP-database tegenover het tabblad *Komende Autos*):

| | |
|---|---|
| Lopende auto's | **12 van de 12** in PVP staan ook in *Lopende Autos*. Daar is niets mis. |
| Komende auto's | Ze delen er **5**. |
| Alleen in het Autoboek | **10 auto's** die PVP niet kent — waaronder de hele partij van 12-08 van leverancier TX (2× Cupra Formentor, 3× Volkswagen, 2× Fiat 500e). De Drive-mappen van die auto's bestaan wél al. |
| Alleen in PVP | 3 auto's die het Autoboek niet heeft: `1-TRH-86`, `CLA-VUAK`, `V-99-PLV`. |

Het lek zit dus precies bij de instroom, en nergens anders. Dat maakt dit de juiste plek om in te
grijpen — en het maakt de oplossing meetbaar: na invoering hoort dit verschil nul te zijn.

## Hoe het nu gaat

Per ingekochte auto wordt in Google Drive (gedeelde drive → `Prieva Vehicle Platform`) een map
aangemaakt met de VIN of het kenteken als naam. Daarin komen de koopstukken en de foto's van de
veiling. Daarnaast typt iemand de auto in het Autoboek, tabblad *Komende Autos*.

Opgemerkt: er staan **dubbele mappen** in die map (`VXKUPHMHDM4035593`, `VXKUHZKXZP4045544` en
`VF7SXHMRVNT696950` bestaan elk twee keer, de tweede aangemaakt op 17-08-2026). Symptoom van handwerk
zonder controle.

## Het Autoboek

`Autoboek PRIEVA.xlsx`, in de gedeelde drive onder `Autoboek/`. Bestands-ID
`1MnSN9PJjzJTEp4aLwhyjKeH-h4-wb3if`. **Een Excel-bestand in Drive, geen Google Sheet.**
Zes tabbladen: *Komende Autos*, *Lopende Autos*, *Verkochte Autos*, *BTW reserves*, *Blad5*,
*Bandenlijst*.

**Belangrijk: er draait een Power BI-rapportage op dit bestand**, die het uit Google Drive leest.
Het bestand moet dus een .xlsx blijven, op dezelfde plek, met dezelfde naam en kolomindeling.
Omzetten naar een Google Sheet is daarmee van tafel.

### Tabblad *Komende Autos*

18 kolommen, op 17-08-2026 gevuld met 14 auto's (rijen 2 t/m 15; **rij 16 is leeg**, de volgende
gevulde rij is 17).

`F` · `TO-DO` · `Transport` · `Fact. Nr.` · `VIN` · `Kenteken` · `Merk` · `Type` · `Kleur` ·
`Leverancier` · `Uitvoering` · `Brandstof` · `Transmissie` · `1e Reg.` · `KM` · `Datum inkoop` ·
`Datum verkoop` · `Inkoop EX/EX`

Datums staan als Excel-serienummers (epoch 1899-12-30), bedragen als getal met een valuta-opmaak.
Leverancier is vrije tekst: codes (`RJ` 25×, `COS` 9×, `TX` 7×, `AB` 4×, `AP`, `B2B`, `OL`) door
elkaar met `inruil` en namen van particulieren (`Marcel Otten`, `inruil Kelly Thelen`).

## Vertaling Autoboek ↔ PVP

| Autoboek | PVP (`vehicles`) | |
|---|---|---|
| VIN | `vin` | ✅ |
| Kenteken | `kenteken` | ✅ |
| Merk | `merk` | ✅ |
| Type | `model` | ✅ |
| Kleur | `kleur` | ✅ |
| Leverancier | `lev` | ✅ |
| Uitvoering | `uitv` | ✅ |
| Brandstof | `brandstof` | ✅ |
| Transmissie | `transm` | ✅ |
| 1e Reg. | `reg` | ✅ |
| KM | `km` | ✅ |
| Datum inkoop | `inkoopdatum` | ✅ |
| Transport | `batch` | ✅ |
| TO-DO | `note` | ✅ |
| **Fact. Nr.** | — | ⬜ nieuw veld nodig |
| **Inkoop EX/EX** | — | ⬜ nieuw veld nodig (komt gratis uit de koopstukken) |
| **Datum verkoop** | — | ⬜ nieuw veld nodig |
| **F** | — | ⬜ onbekend wat deze kolom betekent — uitvragen |

De sleutel `id` in PVP is de VIN bij import en het kenteken bij Nederlandse auto's; dat past op de
twee eerste kolommen. Veertien van de achttien kolommen kan PVP dus vandaag al vullen.

Andersom kent het Autoboek geen equivalent voor `status`, `klaar`, `route`, `owner`, `photos` en
`subtasks` — dat is de voortgang, en die hoort ook niet in een spreadsheet.

## Wat er uit de koopstukken te halen valt

Twee proeven op bestaande mappen, met de gegevens in PVP als ijkpunt.

### Proef 1 — import: `VR7BAHNSBME016540` (pro forma + screenshot)

De **pro forma van Jyske Finans** levert: VIN, `1. Reg.date 2021-05-20`, `80344 Km`, buitenlands
kenteken `DZ73607`, bedrag `EUR 7.849,00`, factuurdatum 4 augustus 2026, leveranciersnaam.
De **screenshot van de veiling** levert de rest: merk, model, uitvoering, kleur, brandstof,
transmissie, bouwjaar, carrosserie, vermogen, gewichten.

| Veld | In PVP | Uit de stukken | |
|---|---|---|---|
| vin | VR7BAHNSBME016540 | in **beide** stukken → kruiscontroleerbaar | ✅ |
| merk / model | Citroën / C4 | Citroën / C4 | ✅ |
| uitvoering | 1.2 PureTech Feel EAT8 130pk 5d Aut. | 1,2 PureTech Feel EAT8 130HK 5d 8g Aut. | ⚠️ notatie |
| kleur | Zwart | Black | ⚠️ vertalen |
| brandstof | Benzine | Benzin | ⚠️ vertalen |
| transmissie | Automaat | Automatisk (Deens) | ⚠️ vertalen |
| 1e reg. | 20-05-2021 | 20.05.2021 én 2021-05-20 | ✅ |
| km | 80344 | 80.344 | ✅ |
| leverancier | RJ | Jyske Finans A/S | ❌ eigen code, niet af te leiden |
| inkoopdatum | 03-08-2026 | factuurdatum 04-08-2026 | ❌ staat er niet |
| transport | 13-08 | — | ❌ beslis je later |

### Proef 2 — Nederlandse inkoop: kavel 15509351, Nissan Leaf

Een heel ander document (inkoopformulier van een particulier), en bijna alles staat er al in het
Nederlands: merk/model, kenteken `JJ285K`, bouwjaar/tellerstand `2016 / 146.500 km`, uitvoering
`Accenta 30 kWh`, brandstof, kleur, transmissie, marge, aankoopbedrag `€ 2.100`, datum `12-08-2026`,
plus een complete conditie-checklist en de opmerking "lichte krasjes links achter".
Wat hier juist ontbreekt: de **VIN** en de exacte eerste toelating (alleen bouwjaar).

### Conclusie van de proeven

De informatie zit erin en is betrouwbaar te halen, maar:

- **er zijn twee documentfamilies** (buitenlandse import met proforma + veilingscreenshot, en
  Nederlandse inkoop met inkoopformulier) met verschillende velden en verschillende talen;
- **drie velden komen nooit uit de stukken**: leverancierscode, inkoopdatum en transportdatum;
- **vertalen is nodig** (kleur, brandstof, transmissie — Engels én Deens).

> **Let op: het uitlezen hierboven deed Claude in de sessie, niet de server.** De tekst uit de
> screenshot kwam via de OCR van Google Drive. Op de droplet bestaat dat niet; daar wordt het een
> AI-aanroep vanaf de backend. De proef bewijst dus dat de gegevens erin zitten — niet dat de server
> ze er vandaag uit krijgt.

## Persoonsgegevens (AVG)

Het Nederlandse inkoopformulier bevat **naam, adres, telefoonnummer en e-mailadres van de particuliere
verkoper**. Die komen dus mee met de upload. Voorstel: bij het uitlezen actief laten vallen, en niet
in de auto-notitie en al helemaal niet in het Autoboek zetten. Wil je ze bewaren, dan is dat een
bewuste keuze met gevolgen (grondslag, bewaartermijn, wie mag het zien) en geen bijvangst.

Het geüploade document zelf blijft wel staan in `/var/pvp/uploads` — daar staan nu ook al
kentekenbewijzen en vrijwaringen. Dat gaat mee in de nachtelijke momentopname en versleuteld naar
Backblaze.

## Voorgesteld ontwerp

1. **Plusknop in PVP** ("Auto toevoegen"), zichtbaar voor `team` en `admin`.
2. Je sleept er **zoveel mogelijk pdf's en screenshots** in. Ze worden opgeslagen bij de auto, zoals
   nu de keuringsfoto's.
3. PVP leest de bestanden uit en toont een **ingevuld voorstel**: per veld wat er gevonden is en uit
   welk bestand. Bewust géén stille aanmaak — één verkeerd gelezen VIN levert anders een spookauto op
   die je daarna in twee systemen moet opruimen, en het Autoboek heeft geen "ongedaan maken".
4. Je corrigeert wat niet klopt, vult de drie velden aan die nooit uit de stukken komen
   (leverancier, inkoopdatum, transport) en drukt op Opslaan.
5. De auto komt in PVP bij **Komend**.
6. Daarna schrijft PVP **één regel bij** in *Komende Autos* van het Autoboek.

### Schrijven naar het Autoboek

Omzetten naar een Google Sheet kan niet (Power BI). Wel kan de server het .xlsx zelf aanpassen: een
xlsx is een zip met XML, en `zlib` zit in Node. Gunstige omstandigheden op dat tabblad:

- **geen Excel-tabelobject** op *Komende Autos* (de dertien tabellen in het boek staan op andere
  bladen), dus er is geen bereik dat meegroeien moet;
- **nul formules** op dat blad;
- **rij 16 is leeg**, dus de eerstvolgende regel is een schone invoeging.

Veiligheidskleppen, in dezelfde geest als de back-upscripts:

- **Alleen toevoegen.** Nooit bestaande regels wijzigen of verwijderen. In het ergste geval staat er
  één regel te veel — nooit één te weinig.
- **Alleen het tabblad *Komende Autos*.** De andere vijf worden niet aangeraakt.
- **Controle op gelijktijdig bewerken:** vlak vóór het uploaden nagaan of de revisie in Drive nog
  dezelfde is als bij het downloaden. Zo niet: niet schrijven, later opnieuw proberen, en in PVP
  zichtbaar maken dat de regel nog niet in het Autoboek staat.
- **Nalezen na afloop:** het bestand opnieuw ophalen en bevestigen dat de regel er echt in staat.
  Een schrijfactie die je niet nakijkt, is een aanname.
- **PVP blijft de bron.** Mislukt het wegschrijven, dan is er niets kwijt: de auto staat in de
  database en de regel kan opnieuw weg.

Power BI leest het bestand uit Google Drive, dus een nieuwe revisie is gewoon de volgende
vernieuwing — mits naam, locatie en kolomindeling gelijk blijven. Dat blijven ze.

### Toegang die hiervoor geregeld moet worden

Een **service account** in Google Cloud, met schrijfrecht op alleen dit bestand (of op de map
`Autoboek`). De sleutel komt in `/var/pvp/` met `chmod 600` en gaat via `EnvironmentFile=` de
systemd-unit in — dezelfde aanpak als `pg.env` en `restic.env`, en **niet in de repo**.
Ondertekenen van het JWT kan met de ingebouwde `crypto`-module; er is dus **geen npm-pakket** nodig,
in lijn met de regel dat `pg` de enige uitzondering is.

## Nog te beslissen

- ⬜ **Wat betekent kolom `F`** in *Komende Autos*?
- ⬜ **Nieuwe velden in PVP**: `factuurnummer`, `inkoopprijs`, `verkoopdatum`. Schemawijziging plus
  een plek in het scherm.
- ⬜ **Het uitlezen op de server**: een Anthropic API-sleutel, wat het per auto kost, en waar die
  sleutel komt te staan. Zonder dit blijft de plusknop een handmatig formulier — op zichzelf al winst,
  want dan is er tenminste één invoerpunt.
- ⬜ **De 10 auto's die nu alleen in het Autoboek staan**: eenmalig overzetten naar PVP, zodat de twee
  gelijk beginnen. Anders begint de nieuwe koppeling met een bekend gat.
- ⬜ **Wat er gebeurt als een auto van Komend naar Lopend gaat.** In het Autoboek verhuist hij dan naar
  een ander tabblad met 55 kolommen. Verplaatst PVP hem mee, of blijft dat handwerk? Buiten deze stap
  gehouden, maar het komt eraan.

## Wat hier niet in zit

- De Drive-map per auto blijft handwerk; PVP maakt of vult die niet (bewust, jouw keuze).
- Het tabblad *Lopende Autos* wordt niet aangeraakt.
- Er wordt niets uit het Autoboek terug naar PVP gelezen. De richting is één kant op: PVP → Autoboek.
