---
name: pvp-ui
description: Huisstijl, bouwstenen en gedragsregels voor schermen in PVP (index.html). Gebruik dit bij elke wijziging aan de frontend — een nieuw paneel, een knop, een tabel, een melding.
---

# Schermen bouwen in PVP

`index.html` is één bestand: HTML, CSS en JS door elkaar, geen build-stap, geen framework.
Nieuw scherm bouwen betekent: een functie die een string HTML teruggeeft, en die aanroepen vanuit
`rerender()` of `renderCarport()`. Niet slimmer maken dan dat.

## Huisstijl
Font **Montserrat**, verloop `#0D9EBF → #056A7F`, zwart woordmerk, hexagon-logo. **Géén oranje** als
accent — amber alleen als waarschuwingskleur. Alle teksten Nederlands, ook variabelenamen en
commentaar.

Kleuren komen uit de CSS-variabelen bovenin (`--accent`, `--muted`, `--green`, `--amber`, `--red`,
`--blue-soft`). Schrijf nooit een hex-kleur in nieuwe opmaak; als de kleur er niet is, voeg hem daar
toe.

## Bestaande bouwstenen — eerst hergebruiken
| Klasse | Waarvoor |
|---|---|
| `.card` + `<h3>` + `.card-body` | een blok op een pagina; `<span class="gcount">` voor het aantal |
| `.bon` / `.bon-kop` / `.bon-body` | een uitklapbare regel per auto (Carport, afleveringen) |
| `.taak` (+ `.af`) | een regel met een vinkje; `.af` is afgevinkt |
| `.dl` (+ `ruim`/`krap`/`nu`/`over`/`geen`) | een teller met kleur; maak hem met `tijdChip(tot, uitleg)` |
| `.badge` (+ `b-lopende`/`b-gemeld`/…) | een status |
| `.banner` | een melding bovenaan een pagina; alleen tonen als er iets aan de hand is |
| `.note` | grijze uitlegregel onder een kop |
| `.empty` + `.eb` | lege staat, met een icoon en één zin die zegt wat je nu kunt doen |
| `.tabelwrap` + `<table>` | een tabel; met `table-layout:fixed` en een `<colgroup>` past hij zonder horizontaal schuiven |
| `.btn` + `btn-primary` / `btn-ghost` / `btn-sm` | knoppen |
| `.inp`, `.assign` | invoerveld, keuzelijst |
| `ico(naam, maat)` | een icoon; staat er geen, voeg hem toe aan `ICONEN` |

## Regels die niet onderhandelbaar zijn
- **`esc()` om elke waarde uit de database.** Kenteken, notitie, naam — alles.
- **`window.history`, nooit `history`.** Er bestaat een lokale `const history = []` (de undo-stack)
  die de globale overschaduwt.
- **`V` nooit herwijzen.** De catalogus wordt *in place* vervangen; `V` wordt op tientallen plekken
  bij naam gebruikt.
- **Roep `loadVehicles()` en `loadState()` als paar aan.** Los aanroepen heeft op 20-08-2026 de
  voortgang van 64 auto's gewist.
- **Elke handeling die iets wijzigt gaat via de server en leest daarna opnieuw in** (`loadX()` →
  `rerenderCurrent()`). Lokaal bijhouden loopt uiteen zodra twee mensen tegelijk werken.
- **Knoppen binnen een klikbare rij** hebben `onclick="event.stopPropagation()"` op hun omhulsel,
  anders klapt de rij open bij elke druk.

## Gedrag: wat een scherm hoort te doen
- **Elke handeling is omkeerbaar of vraagt om bevestiging.** Afvinken krijgt een *Terugzetten*,
  verwijderen krijgt een tussenscherm. Iets dat niet terug te draaien is, hoort niet achter één klik.
- **Toon alleen wat er mis is.** Een banner die zegt dat alles goed gaat, leest niemand; hij maakt de
  echte melding onzichtbaar. Zie `agentBanner()`: alleen bij een storing, en alleen tijdens de uren
  dat de taak hoort te lopen.
- **Een lege lijst is een kans om iets uit te leggen.** `.empty` vertelt wat er nu moet gebeuren, niet
  dat er niets is.
- **Twee handelingen die verschillende dingen betekenen, blijven twee knoppen.** Carport *afmelden*
  (werk klaar) en Prieva *afleveren* (auto bij de klant) zijn niet hetzelfde; ze samenvoegen scheelt
  een klik en kost de waarheid.
- **Geen datum verzinnen.** Is een tijdstip onbekend, schrijf dan "opnamedatum onbekend" in plaats van
  een berekende termijn. Een teller die te veel tijd belooft is erger dan geen teller.
- **Getallen en tellers rekent de server uit**, niet het scherm. De marge van Carport komt mee in het
  antwoord van `/api/carport`; de frontend toont hem alleen.

## Rollen
`team` (alles), `admin` (+ logboek, verwijderen, verkoop bevestigen), `foto`, `taxateur`, `carport`.
De laatste drie zijn `restricted`: navigatie, zoekbalk en de knoppen *Auto*, *To-do* en *Ongedaan*
worden voor hen verborgen. **Verbergen in beeld is nooit genoeg** — de server dwingt af, en dat is de
plek waar het moet gebeuren. Bouw je een knop, bouw dan de controle in het endpoint erbij.

## Voordat je het live zet
Doorloop `pvp-testen`. Minimaal: geen JS-fouten in de console, en de vijf rol-flows laden.
