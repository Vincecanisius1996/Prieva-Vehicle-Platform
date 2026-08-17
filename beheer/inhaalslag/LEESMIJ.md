# Eenmalige inhaalslag — auto's uit Drive en het Autoboek naar PVP

`import-drive.js` maakt de tien auto's aan die op 17-08-2026 wel in het Autoboek en in Google Drive
stonden, maar niet in PVP. **Draait tegen de testomgeving** (`BASIS=http://127.0.0.1:3001`), met de
Autoboek-koppeling uit — die auto's staan daar immers al in.

Bron per auto is de **regel in het Autoboek**, niet het document in Drive. Reden: die regel is door
Prieva zelf gecureerd (kleur "Grijs" in plaats van de fabrieksnaam "Magnetic Tech", uitvoering in
Nederlandse notatie), terwijl de Drive-stukken Duits en rauw zijn. De mappen in Drive bevestigen dat
de auto bestaat en leveren de onderbouwing.

| Groep | Aantal | Status |
|---|---|---|
| Partij TX van 12-08 (Cupra, VW, Fiat) | 7 | stonden in *Komende Autos* |
| BMW X5, MINI Cooper, Nissan Leaf | 3 | stonden in *Lopende Autos* — al binnen |

De drie uit *Lopende Autos* worden aangemaakt als `komende`; hun werkelijke voortgang is **nergens
vastgelegd** (de kolommen RDW Foto's, RDW Gekeurd, BPM rapport, BIN, Fotograaf zijn bij alle drie
leeg). Die moet met de hand gezet worden.

Niet in te vullen uit welk document dan ook: **kenteken** bij imports, **transportdatum** en
**factuurnummer**. Dat is geen tekortkoming van het uitlezen maar een eigenschap van de stukken.
