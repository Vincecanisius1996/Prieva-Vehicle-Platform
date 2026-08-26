# `rdw/` — het importdossier

Fase A van de RDW-import, 26-08-2026. **Alleen de PVP-kant**: er gaat nog niets richting de RDW.

Wat hier staat is één bestand, `velden.js`, met de lijst stukken die de RDW van een importauto wil
zien en het rekenwerk of ze er zijn. Geen netwerk, geen sleutel, geen database — puur een tabel en
een functie, dus los te toetsen met `node -e`.

De endpoints zelf staan in `server.js`: `GET /api/rdw-dossier` (lijst en detail) en
`POST /api/rdw-dossier-status`.

## De eisenlijst

`STUKKEN` is gelijk aan `PHOTO_GROUPS` in `index.html` ("conform Mobilox"), met twee toevoegingen:

- **`bron`** — niet elk stuk staat in `vehicles.photos`. Het BPM-taxatierapport staat in `bpm_reports`.
- **`req` mag een functie zijn** — het taxatierapport is alleen verplicht op route JA. Op route NEE
  loopt de BPM via de koerslijst en bestaat dat rapport niet; die auto's als onvolledig tellen maakt
  de check waardeloos.

> **De lijst staat op twee plekken**: hier en als `PHOTO_GROUPS` in `index.html`. Wijzig je een
> sleutel of een verplichting, wijzig het dan op allebei — net als `BPM_GELDIG_DAGEN`. Het endpoint
> stuurt de lijst mee in zijn antwoord (`eisen`), zodat de frontend hem later hiervandaan kan halen
> en de kopie kan verdwijnen.

## De statussen

`dossier` → `klaar` → `ingediend` → `keuring` → `ingeschreven`.

Een auto **zonder rij** in `rdw_dossier` staat op `dossier`. Zo hoefde er voor de bestaande
importauto's niets aangemaakt te worden.

- `klaar` en `ingediend` **worden geweigerd bij een onvolledig dossier** (409, met de lijst wat er
  mist). Bewust doorgaan kan met `toch:true`, en dán staat in `rdw_dossier_log` wát er ontbrak.
- Bij `keuring` en `ingeschreven` wordt niet meer gecontroleerd: op dat punt heeft de RDW het dossier
  al aangenomen en zou PVP een oordeel overdoen dat niet meer van hem is.
- `ingediend` eist een `dossiernr`, `keuring` een `keuringDatum` (bestáánde datum, niet alleen de
  goede vorm). Een status die iets belooft wat er niet is, is erger dan geen status.
- **Alles is omkeerbaar** en elke overgang komt in het log, dat nooit wordt opgeschoond.

## Mijlpaalmomenten

`ingediend_ts` en `ingeschreven_ts` horen bij het bereiken van een mijlpaal, niet bij de laatste klik:

- van `keuring` terug naar `ingediend` (een vergissing herstellen) **laat de indieningsdatum staan**;
- helemaal terug naar `klaar` en daarna opnieuw indienen is een échte nieuwe indiening en geeft een
  nieuwe datum;
- valt een auto terug vóór een mijlpaal, dan gaat dat moment eraf — een auto op `ingediend` met een
  inschrijfdatum eronder is een tegenstrijdigheid die niemand meer uitlegt. Wat vervalt komt in het
  log, niet stilletjes weg.

## Twee dingen die vaak vergeten worden

- **Een stuk telt alleen als het bestand er ook echt is.** Zowel de lijst als het dossier doen een
  `fs.stat` per aanwezig stuk. Een URL in de database waarvan het bestand naar de prullenbak is
  verhuisd zou anders "compleet" opleveren en de RDW straks een lege hand. Lijst en detail doen
  daarom dezelfde controle: een overzicht dat iets anders beweert dan de detailpagina gelooft
  niemand meer.
- **Het kenteken uit de RDW-mail wordt alléén in het dossier vastgelegd**
  (`rdw_dossier.ingeschreven_kenteken`). `vehicles.kenteken` blijft via de Mobilox-agent lopen; twee
  wegen naar hetzelfde veld lopen vroeg of laat uiteen.

## Toegang

`GET` mag met een sessie (team/admin) of met het **RDW-token** uit `/var/pvp/rdw.env`
(`PVP_RDW_TOKEN`, chmod 600, **niet committen**). Carport, fotograaf en taxateur krijgen 403: in dit
dossier zitten kentekenbewijzen en koopovereenkomsten met persoonsgegevens.

**De status zetten kan alleen met een sessie.** Er is nog geen tegenpartij die dat mag; schrijfrechten
geef je op het moment dat er iets aan de andere kant staat.

Token vervangen of intrekken: `/var/pvp/rdw.env` aanpassen (of leegmaken) en `systemctl restart
pvp-api`. Nieuw token maken met `openssl rand -hex 32`.
