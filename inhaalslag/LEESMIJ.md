# Inhaalslag: Lopende Autos uit het Autoboek naar PVP

`lopende-uit-autoboek.js` — **eenmalig gedraaid op 19-08-2026.** Neemt auto's van het tabblad
*Lopende Autos* over in de tabel `vehicles`. Zonder `--echt` is het een proefdraai.

## Waarom niet via `/api/vehicle`
Dat endpoint schrijft élke nieuwe auto naar het Autoboek, en `staatErAl()` in `autoboek/index.js`
kijkt daarbij **alleen op *Komende Autos***. Deze auto's staan op *Lopende*, worden dus niet herkend,
en zouden er als 32 dubbele regels op *Komende* bij komen — die Power BI vervolgens meetelt. Daarom
rechtstreeks de database in, met de koppeling erbuiten.

## De verdeling (gemeten, 19-08-2026)
66 rijen op *Lopende*, waarvan 14 al in PVP stonden. Van de 52 overige:

| | | |
|---|---|---|
| **A** | 32 | mét kenteken, ingekocht vanaf april — **geïmporteerd** |
| **B** | 15 | zónder kenteken — fase niet vast te stellen |
| **C** | 5 | ingekocht vóór april (oudste: 11-06-2021) — voorraadvraag |

Groep B en C zijn later dezelfde dag alsnog geïmporteerd met
`rest-uit-autoboek.js`: Vince heeft per rij opgegeven waar de auto staat, en die twintig omschrijvingen
staan in dat script als tabel `FASE`. Vijf ervan bleken **Verkoopklaar** (rij 2, 3, 12, 35 en 44), dus
de voorraadvraag bij groep C is beantwoord met "ja, allemaal nog in traject".

Let op bij het lezen van zo'n omschrijving: die noemt óf de stap die nu **openstaat** ("RDW
importeren", "RDW goedkeuring afwachting") óf een stap die net **af** is ("papieren compleet", "BPM
rapport verstuurd"). Dat scheelt precies één in `klaar`, en `klaarUit()` maakt dat onderscheid
expliciet in plaats van het aan de lezer over te laten.

**De zeven stapkolommen AW–BC (*RDW Foto's* … *Mobilox Online*) zijn leeg** — 61 van de 66 rijen
hebben er niets in staan, en de vijf gevulde cellen bevatten losse aantekeningen ('Motorblok',
'Gerd', 'Carcollect'). Het Autoboek weet dus wél welke auto's er zijn, maar niet waar ze staan.
Dat is de reden dat de fase niet machinaal over te nemen was.

**Het enige harde signaal is het kenteken:** een Nederlands kenteken bestaat niet vóór
RDW-goedkeuring en BIN. Voor groep A staat daarmee vast dat alles t/m BIN gebeurd is —
`klaar` 10 bij route JA, 8 bij route NEE. **Fotograaf en Mobilox Online blijven open**: adverteren
volgt niet uit een kenteken. De kostenkolommen leken een tweede signaal maar zijn dat niet:
Foto-kosten staan bij 30 van de 42 mét kenteken én bij 13 van de 24 zónder.

`route` komt uit de Taxatie-kolom (AD): kosten gevuld = JA. Dat bepaalt alleen hoe de afgeronde
geschiedenis eruitziet, niet welk werk er open komt te staan.

## Wat het script onderweg rechtzet
Het Autoboek is met de hand gevuld en dat is te zien. Zonder deze correcties komen er waarden in
PVP die in geen enkel overzicht bij elkaar optellen:
- **merk, brandstof, transmissie, kleur** naar de schrijfwijze die PVP al gebruikt: `VW`→Volkswagen,
  `Citroen`/`CITR`→Citroën, `Benz`→Benzine, `Elec`→Elektrisch, `Aut`→Automaat, `Hand`→Handgeschakeld.
- **kentekens** naar hoofdletters mét streepjes. Vier stonden zonder (`8KLR98` → `8-KLR-98`).
  Dat ving meteen een dubbele: `1TRH86` bleek `1-TRH-86` en stond al in PVP.
- **`93-XXX-1` is een plaatshouder, geen kenteken** — die auto (rij 44, Peugeot 107) bewijst dus
  niets over RDW-goedkeuring en is naar groep B verplaatst.
- **rij 27 (Renault Twingo) had brandstof en transmissie verwisseld** (`Aut` als brandstof, `Elec`
  als transmissie). In PVP staat het goed; **het Autoboek zelf is niet aangeraakt.**
- **`208.0` → `208`**: Excel geeft een cel met alleen cijfers terug als getal.

## Terugdraaien
Veiligheidskopie van vóór de import: `/var/backups/pvp/vehicles-voor-inhaalslag-20260819-115758.sql`.
De 32 regels zijn te herkennen aan `note like 'Overgenomen uit het Autoboek%'`. Het Autoboek is bij
deze inhaalslag **niet gewijzigd**, dus daar hoeft niets terug.
