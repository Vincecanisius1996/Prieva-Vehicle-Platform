# `agenda/` — geplande afleveringen in de Prieva-agenda

PVP zet elke geplande aflevering als afspraak in de Google-agenda van Prieva, zodat een aflevering
ook zichtbaar is voor wie niet in PVP kijkt.

## De agenda is een spiegel, geen tweede administratie
PVP bepaalt wat erin staat en werkt het bij elke ronde bij (elk kwartier, zie `pvp-mobilox.timer`).
Wie een aflevering wil verzetten, doet dat in Mobilox of in PVP; een wijziging in de agenda zélf
wordt de eerstvolgende ronde overschreven. Dat staat ook in de afspraak, want anders is het een
verrassing. Verwijder je een afspraak met de hand, dan komt hij binnen een kwartier terug — de
werkbon staat immers nog open.

## Wat er in een afspraak staat
* Titel: `Aflevering — Peugeot 208 · KTD-70-T` (zonder kenteken: de laatste zes tekens van het VIN).
* Een **hele dag**, want Mobilox geeft alleen een datum. Een verzonnen tijdstip van 10:00 zou
  betrouwbaarder lijken dan het is.
* Op **vrij** gezet (`transparent`): een aflevering hoort niemands dag als bezet te tonen.
* In de omschrijving het openstaande werk, gesplitst in **Bij Carport** (uiterlijk twee dagen vóór
  de aflevering) en **Bij de poetser** (de afleverdag zelf), met per punt de soort.

## Wat er nooit gebeurt
* **Afspraken van collega's worden niet aangeraakt.** Elke afspraak van PVP krijgt een merkteken
  (`extendedProperties.private.pvp = aflevering`); bij het ophalen filtert Google daar al op, dus de
  rest van de agenda komt niet eens over de lijn.
* **Afleveringen uit het verleden blijven staan.** Er worden geen afspraken gemaakt voor een datum
  die al geweest is, en bestaande afspraken van vóór vandaag worden nooit weggehaald: de agenda is
  ook een logboek van wat er gebeurd is.
* **Meer dan `MAX_VERWIJDEREN` (10) afspraken in één ronde weghalen wordt geweigerd.** Dat is geen
  opruiming maar een fout — een lege database, een verkeerd agenda-ID. Bewust doorgaan kan met
  `--forceer`.

## Inrichten
1. **Google Calendar API aanzetten** in het Google-project `prieva-vehicle-platform`. Zonder dat
   geeft Google 403 met "has not been used in project … before or it is disabled".
2. **De agenda delen** met het service-account, recht *Wijzigingen aan afspraken aanbrengen*:
   `prieva-vehicle-platform-autobo@prieva-vehicle-platform.iam.gserviceaccount.com`
   Dit is hetzelfde account als bij het Autoboek; er komt geen tweede sleutel bij.
3. **Het agenda-ID** in `/var/pvp/agenda.env` (`AGENDA_ID=`, chmod 600, **niet committen**).
   Opzoeken: `node /opt/pvp-api/agenda/sync.js --agendas`, of in Google Agenda onder
   Instellingen van de agenda → Agenda-ID.

`AGENDA_ID` leeg = koppeling uit; er gaat dan niets naar Google. Zelfde patroon als
`AUTOBOEK_FILE_ID`.

## Als delen niet genoeg is
Blijft het recht op *bekijken* staan hoe vaak je het ook op "Wijzigingen aan afspraken aanbrengen"
zet, dan verbiedt het beheerbeleid het: een account van **buiten het domein** mag dan niets wijzigen.
In de beheerconsole staat dat bij **Apps → Google Workspace → Agenda → Opties voor extern delen**;
dat moet minstens *"Alle informatie delen en anderen kunnen agenda's beheren"* zijn.

Wil je dat beleid niet verruimen — begrijpelijk, want het geldt domeinbreed — dan is er een tweede
weg: **de koppeling namens een collega laten handelen**. Dan komt hij niet meer van buiten.

1. Beheerconsole → **Beveiliging → API-beheer → Domeinbrede delegatie** → client-ID
   `100724149126125369873` toelaten met scope `https://www.googleapis.com/auth/calendar`.
2. `AGENDA_ALS=<e-mailadres van die collega>` in `/var/pvp/agenda.env`.

`node agenda/sync.js --toets <agenda-id>` zegt welke weg actief is en wat er nog mist. De afspraken
komen dan op naam van die collega te staan; verder verandert er niets.

Er wordt bewust **geen genodigde** aan een afspraak toegevoegd. Een service-account mag zonder
domeinbrede delegatie geen uitnodigingen versturen, en dat willen we ook niet: dit is een planning,
geen vergadering.

## Draaien
```
node agenda/sync.js              # proefdraai: wat zou er gebeuren
node agenda/sync.js --echt       # doen
node agenda/sync.js --agendas    # welke agenda's ziet het service-account
```
Normaal draait hij mee in `/usr/local/bin/pvp-mobilox.sh`, elk kwartier tijdens kantooruren.

## Bestanden
| Bestand | Wat |
|---|---|
| `kalender.js` | Google Agenda via `fetch`, puur Node. Leent het inloggen van `autoboek/drive.js`. |
| `index.js` | De vergelijking: wat hoort erin, wat staat erin, wat moet er weg. |
| `sync.js` | Het scriptje eromheen: proefdraai, `--echt`, draaiverslag in `agent_runs`. |
