# `uitlezen/` — inkoopstukken omzetten naar ingevulde velden

Draait mee met de backend in `/opt/pvp-api/uitlezen/`. `server.js` doet `require('./uitlezen')` en
gebruikt `lees(docs)` achter `POST /api/uitlezen`.

## Waarom dit nodig is

Claude Code kan in een sessie de stukken lezen — dat is bewezen op tien echte auto's. Maar als een
collega dinsdagochtend op **＋ Auto** drukt is er geen sessie: dan draait alleen `server.js`, een kaal
Node-proces dat een bestand kan opslaan en verder niets begrijpt. Deze module geeft de server tijdens
het verzoek zelf toegang tot een model.

## Instellingen

`/var/pvp/ai.env` (chmod 600, via `EnvironmentFile=` in `pvp-api.service`, **nooit in de repo**):

```
ANTHROPIC_API_KEY=            # leeg = uit
UITLEZEN_MODEL=claude-sonnet-5
UITLEZEN_MAX_MB=20            # totale omvang van de stukken per auto
```

Is de sleutel leeg, dan meldt `GET /api/me` `uitlezen:false` en verschijnt de knop niet. Een knop die
alleen "staat uit" kan zeggen is erger dan geen knop.

## Hoe het werkt

Pdf's gaan als `document`, afbeeldingen als `image`, elk voorafgegaan door de bestandsnaam zodat het
model kan zeggen wáár een waarde vandaan komt. Het antwoord wordt afgedwongen via een tool met een
JSON-schema; vragen om JSON is minder betrouwbaar, want dan kán er iets anders terugkomen.

Vier dingen zijn bewust zo:

1. **Er wordt niets aangemaakt.** Het is een voorstel; de gebruiker kijkt het na en drukt daarna pas
   op Opslaan. Eén verkeerd gelezen VIN levert anders een spookauto op in twee systemen.
2. **Leeg is een geldig antwoord.** De opdracht zegt uitdrukkelijk: niets verzinnen, niets afleiden uit
   algemene kennis over het model. Een leeg veld is bruikbaar, een verzonnen veld is schadelijk.
3. **Persoonsgegevens worden geweigerd.** Nederlandse inkoopformulieren bevatten naam, adres,
   telefoon en e-mail van de particuliere verkoper. Die horen niet in PVP en niet in het Autoboek.
4. **Er zit een grens op de omvang.** Eén keer per ongeluk een map vol foto's erin duwen mag geen
   grote rekening opleveren.

`kenteken` bij import, `leverancier` en `transportdatum` komen nóóit uit de stukken — bewezen op tien
echte auto's op 17-08-2026. Het scherm zet die dan ook onder "niet gevonden": een veld dat niet
gevuld kan worden is geen storing maar een gat in het dossier, en dat hoort zichtbaar te zijn.

## Gemeten op echte stukken (17-08-2026)

| Geval | Stukken | Verbruik | Uitkomst |
|---|---|---|---|
| Import, Citroën C4 | pro forma (pdf) + veilingscreenshot (png) | ~6.000 in / ~600 uit | **11 van de 11** bekende velden goed, plus uitvoering en inkoopdatum |
| NL-inkoop, Nissan Leaf | inkoopformulier particulier (pdf) | ~6.800 in / ~750 uit | **9 van de 10** goed; model kwam als `LEAF` |
| DEKRA-rapport, VW Tiguan | Zustandsbericht, 15 pagina's, 1,9 MB (pdf) | 33.880 in / 863 uit | **8 van de 8** goed |

Bij de Nissan kwam **geen enkel persoonsgegeven** terug: naam, adres, telefoonnummer en e-mailadres van
de verkoper stonden in het document en niet in het antwoord.

Twee dingen die de eerste proef aan het licht bracht en die zijn opgelost:

- `1e toelating` werd `01-01-2016` terwijl er alleen "Bouwjaar 2016" stond. Verzonnen precisie in een
  veld dat doorwerkt in de BPM en de advertentie. De opdracht zegt nu uitdrukkelijk dat zo'n veld
  leeg blijft.
- `merk` kwam de ene keer als `Nissan` en de andere keer als `NISSAN` terug. Dat is nu code, niet
  instructie: dezelfde `merkNotatie()` als de Autoboek-koppeling gebruikt.

`model` wordt bewust **niet** genormaliseerd. `LEAF` netjes maken zou `CLA`, `GTE`, `500e` en `e-Corsa`
juist stukmaken. Daar is het controlescherm voor.

## Testen zonder echte aanroepen

`UITLEZEN_API` wijst standaard naar de echte API, maar kan naar een nepserver wijzen. Zo is de vorm
van het verzoek en de verwerking van het antwoord te controleren zonder tegoed te verbruiken.
