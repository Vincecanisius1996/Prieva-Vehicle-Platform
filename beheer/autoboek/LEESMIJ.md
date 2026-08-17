# `beheer/autoboek/` — bouwstenen voor de koppeling met het Autoboek

Nog **geen** draaiende koppeling: dit zijn de bewezen onderdelen waarop die gebouwd wordt.
Achtergrond, afwegingen en de openstaande beslissingen staan in `PVP-autoboek-koppeling-voorstel.md`.

| Bestand | Wat het doet |
|---|---|
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
2. **De eerstvolgende lege regel**, niet de eerstvolgende ontbrekende. Een blad heeft honderden
   `<row>`-elementen die alleen opmaak dragen; dat is precies de regel waar een mens ook zou typen.
   Is die regel niet leeg, dan breekt het af in plaats van te overschrijven.
3. **Revisiecontrole:** vlak vóór het uploaden nagaan of `headRevisionId` nog dezelfde is als bij het
   downloaden. Zo niet, dan heeft iemand anders opgeslagen en wordt er niet geschreven. Aangetoond:
   bij een botsing bleef de ongewenste regel aantoonbaar buiten het bestand.
4. **Nalezen achteraf:** opnieuw ophalen en controleren dat alle zes tabbladen hun breedte en
   rijaantal houden, dat de koprij identiek is en dat geen bestaande rij is veranderd.

## Sleutel

`/var/pvp/autoboek-sleutel.json`, `chmod 600`, **nooit in de repo** (staat in `.gitignore`).
Het serviceaccount ziet alleen de bestanden die expliciet met hem gedeeld zijn — nu alleen de kopie.
Lezen kan met de scope `drive.readonly`; schrijven vraagt om `drive`.
