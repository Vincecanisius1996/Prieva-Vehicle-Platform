# Opschoning 23-08-2026 — na het naast elkaar leggen van vier bronnen

PVP, de RDW-bedrijfsvoorraad (Mobilox), de verkopen in Mobilox en het Autoboek gaven op 26 auto's
een ander antwoord. Prieva heeft per auto verteld wat er klopt; dit is wat er daarna is gedaan.

| Script | Wat |
|---|---|
| `boek-opschonen-20260823.js` | Twee factuurnummers bijwerken en drie regels verwijderen — in **één** upload. |
| `bedrijfsvoorraad-overnemen.js` | De vijf auto's uit de RDW-voorraad die PVP niet kende alsnog aanmaken. |
| `binnen-melden-20260823.js` | Diezelfde vijf op *lopende* zetten, met de verhuizing Komende → Lopende in het boek. |

Alle drie draaien zonder `--echt` als proefdraai.

## Waarom rijnummers niet te vertrouwen zijn
`vehicles.autoboek_rij` stond voor de BMW op 305 en voor de Twingo op 303; ze bleken op 181 en 177 te
staan. Het opschoonscript controleert daarom **eerst of de rij de auto is die we verwachten** (op VIN
of kenteken) en stopt anders zonder iets te schrijven. Dat is precies wat er gebeurde bij de eerste
proefdraai, en het scheelde twee verkeerd overschreven regels.

## Wat er misging bij de verkoopbevestiging van diezelfde dag
De Toyota Yaris en de Volkswagen Polo stonden in het boek **tegelijk op Lopende en op Verkochte** —
met de hand ingevoerd op Verkochte, en nog niet weggehaald van Lopende. De bevestiging verplaatste de
Lopende-regel naar Verkochte en maakte er daarmee twee. De regels 320 en 321 (die van de bevestiging)
zijn weggehaald; 311 en 312 stonden er al en zijn vollediger — die hebben wél het chassisnummer, de
inkoopprijs en de marge.

Les: een verplaatsing zou moeten controleren of de auto al op het doelblad staat. Dat zit er nu niet
in.

## Uitvoering zonder Finnik
De uitvoering ("x-clusiv", "Sportback 8V 1.4 e-tron PHEV") staat al in de omschrijving op de
verkoopovereenkomst. Merk, kleur, brandstof en datum eerste toelating komen uit **RDW open data**
(`opendata.rdw.nl`, gratis, geen inlog). Finnik was daarmee voor deze vijf niet nodig.
