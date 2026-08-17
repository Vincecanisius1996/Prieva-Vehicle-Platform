# `beheer/autoboek/` — bouwstenen voor de koppeling met het Autoboek

Deze map draait mee met de backend: hij hoort in `/opt/pvp-api/autoboek/`. `server.js` doet
`require('./autoboek')` en gebruikt `schrijfAuto()` nadat een auto is toegevoegd.
Achtergrond, afwegingen en de openstaande beslissingen staan in `PVP-autoboek-koppeling-voorstel.md`.

| Bestand | Wat het doet |
|---|---|
| `index.js` | `schrijfAuto(v)`: één auto als regel bijschrijven, met alle controles hieronder. |
| `drive.js` | Inloggen als serviceaccount (JWT, RS256 via de ingebouwde `crypto`) en Drive lezen/schrijven. |
| `xlsx-append.js` | Eén regel toevoegen aan een tabblad van een `.xlsx`. Zip met de hand, `zlib` uit Node. |
| `xlsx-lees.js` | Een `.xlsx` terugleiden naar rijen en cellen, om te controleren wat er geschreven is. |

**Geen npm-pakketten** — dat is de regel in dit project, en het bleek ook niet nodig.

## Waarom zo

Het Autoboek is een `.xlsx` in Drive waar een Power BI-rapportage op draait. **De kolomstructuur mag
nooit veranderen**, dus omzetten naar een Google Sheet kan niet. Daarom: het bestand blijft wat het is
en er wordt alleen een regel aan toegevoegd.

Vier kleppen, alle vier getest tegen de kopie van het Autoboek op 17-08-2026:

1. **Alleen toevoegen**, alleen op het tabblad *Komende Autos*. Bestaande cellen worden nooit geraakt.
   PVP vult niet alle kolommen: **A (F), B (TO-DO), D (Fact. Nr.) en Q (Datum verkoop) blijven leeg** —
   dat is handwerk van kantoor (afspraak 17-08-2026). Het merk wordt genormaliseerd naar eerste letter
   hoofdletter, rest klein, met een uitzonderingslijst voor afkortingsmerken (BMW, VW, MG, DS, BYD, SEAT).
2. **De eerstvolgende lege regel**, niet de eerstvolgende ontbrekende. Een blad heeft honderden
   `<row>`-elementen die alleen opmaak dragen; dat is precies de regel waar een mens ook zou typen.
   Is die regel niet leeg, dan breekt het af in plaats van te overschrijven.
3. **Opmaak overnemen van de regel erboven, nooit hardcoderen.** Excel hernummert bij elke keer
   opslaan zijn hele stijltabel. Vaste nummers wijzen daarna naar iets anders: op 17-08-2026 kwamen
   daardoor de kilometers als `€ 80.344,00` in het boek en de datums als kaal getal. Nu wordt per
   kolom het stijlnummer van de laatste gevulde regel gelezen, zodat de nieuwe regel er per definitie
   uitziet als de regel erboven — wat er ook met de tabel gebeurt.
4. **Revisiecontrole:** vlak vóór het uploaden nagaan of `headRevisionId` nog dezelfde is als bij het
   downloaden. Zo niet, dan heeft iemand anders opgeslagen en wordt er niet geschreven. Aangetoond:
   bij een botsing bleef de ongewenste regel aantoonbaar buiten het bestand.
5. **Nalezen achteraf:** opnieuw ophalen en controleren dat alle zes tabbladen hun breedte en
   rijaantal houden, dat de koprij identiek is en dat geen bestaande rij is veranderd.

## Instellingen

`/var/pvp/autoboek.env` (chmod 600, via `EnvironmentFile=` in `pvp-api.service`):

```
AUTOBOEK_FILE_ID=<bestands-ID in Drive>
AUTOBOEK_SLEUTEL=/var/pvp/autoboek-sleutel.json
```

Staat `AUTOBOEK_FILE_ID` leeg, dan doet de koppeling niets en zegt PVP dat ook — zo is hij met één
regel aan en uit te zetten, en wijst hij eerst naar de testkopie voordat het echte Autoboek erbij komt.

## Wat er gebeurt als het misgaat

Het toevoegen van een auto in PVP mislukt **nooit** omdat Google niet meewerkt: de auto komt gewoon in
de database. Wat er misging wordt per auto vastgelegd (`autoboek_status`, `autoboek_rij`,
`autoboek_ts`, `autoboek_fout`) en is zichtbaar op de detailpagina en als waarschuwing in de lijst,
met een knop **Opnieuw proberen**. Zo verdwijnt een mislukking niet stil — dat zou precies het gat
tussen PVP en het Autoboek terugbrengen dat deze koppeling dicht.

Staat de auto al in het boek (zelfde VIN of kenteken), dan wordt er niets toegevoegd. Een tweede klik
of een halfgeslaagde poging levert dus geen dubbele regel op.

## Sleutel

`/var/pvp/autoboek-sleutel.json`, `chmod 600`, **nooit in de repo** (staat in `.gitignore`).
Het serviceaccount ziet alleen de bestanden die expliciet met hem gedeeld zijn — nu alleen de kopie.
Lezen kan met de scope `drive.readonly`; schrijven vraagt om `drive`.
