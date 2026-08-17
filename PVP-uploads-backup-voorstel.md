# PVP — back-up van `/var/pvp/uploads` (voorstel)

Status: opgesteld 15-08-2026, na afronding van Fase 1 (Postgres).

> ## Stand van zaken
> - ✅ **Wezen-lek gedicht** (§7, tweede aanbeveling) — uitgevoerd 15-08-2026, zie hieronder.
> - ✅ **Stap A — lokale momentopnamen** — uitgevoerd 15-08-2026. Details en herstelprocedure staan in
>   `CLAUDE.md`; de eerste momentopname is gemaakt en het terugzetten is getest (foto weggehaald →
>   404 in de app → teruggezet → byte-identiek → weer 200).
> - ✅ **Foto's verkleinen bij het uploaden** (§7, eerste aanbeveling) — uitgevoerd 16-08-2026.
>   2560 px / kwaliteit 0,92, in de browser. Gemeten op de 132 bestaande advertentiefoto's:
>   560 MB → 119 MB (4,7x), 39,6 dB PSNR. Werkt vanaf de eerstvolgende upload; bestaande foto's zijn
>   bewust niet omgezet. Instellingen en valkuilen staan in `CLAUDE.md`.
>   *Correctie op §7: daar stond een geschatte factor 8; de gemeten factor is 4,7.*
> - ✅ **Stap B — versleutelde kopie buiten de droplet** — uitgevoerd 17-08-2026. `restic` naar
>   Backblaze B2, bucket `Prieva-Vehicle-Platform` op `s3.eu-central-003.backblazeb2.com` (Amsterdam),
>   elke nacht 03:00 UTC via `pvp-offsite.timer`. Twee momentopnamen per nacht (`db` = verse `pg_dump`
>   als platte SQL zodat deduplicatie werkt, `bestanden` = uploads + sleutels + config). Eerste upload
>   439 MB in 1 min 26; de tweede run duurde 15 s en voegde niets toe.
>   **Terugzetten is getest, niet alleen uploaden:** 244 bestanden byte-voor-byte identiek aan live
>   (661.773.924 bytes aan beide kanten), en de database teruggezet in een wegwerp-database met gelijke
>   rijaantallen én een gelijke `md5` over de inhoud van `vehicles` en `global_todos`. Details en de
>   herstelprocedure staan in `CLAUDE.md`.
> - ⬜ **Het restic-wachtwoord buiten de server** — nog te doen. Het staat alleen in
>   `/var/pvp/restic.env` op de droplet. Zonder kopie in een kluis elders is de bucket na verlies van de
>   server onleesbaar, en beschermt deze back-up dus tegen niets.
> - ⬜ **Onveranderlijkheid van de bucket** — afweging nog te maken, zie hieronder.
>
> **Object Lock blijkt niet aan te staan** (getest 17-08-2026: `restic forget --prune` verwijderde
> zonder bezwaar objecten). Dat is niet zomaar een vergeten vinkje, want de twee eisen bijten elkaar:
> `restic` moet kunnen verwijderen om verlopen momentopnamen op te ruimen, terwijl onveranderlijkheid
> juist betekent dat er niets verwijderd kan worden. Zet je Object Lock met een bewaartermijn aan, dan
> faalt het opruimen elke nacht en groeit de opslag door. Echte onveranderlijkheid vraagt daarom een
> tweede sleutel: de nachtelijke taak krijgt er één **zonder** verwijderrecht, en het opruimen gebeurt
> los daarvan, vanaf een andere machine met een sleutel die dat wél mag.
> Goedkoper alternatief dat de lat een stuk hoger legt zonder iets te breken: een **lifecycle-regel op
> de bucket die verwijderde versies nog 30 dagen bewaart**. Een verkeerd commando of een fout in het
> script is dan terug te draaien; een gerichte aanvaller met de sleutel niet. Bij het huidige volume
> (439 MB, ~9 GB groei per jaar) kost dat vrijwel niets.
> **Wat nu al wél beschermd is:** brand, een defecte schijf, een verwijderde of geschorste
> DigitalOcean-account, en een per ongeluk gewiste map.
>
> **Tweede afwijking van dit voorstel, bewust:** §3 en §5 gingen uit van **DigitalOcean Spaces in
> `ams3`**. Dat advies is herzien naar **Backblaze B2, regio EU Central (Amsterdam)**. Reden: de droplet
> staat bij DigitalOcean, dus een back-up in datzelfde account overleeft geen verloren, geschorst of
> gekaapt account — een reservesleutel in dezelfde auto. B2 is een andere leverancier, S3-compatibel
> (dus `restic` werkt identiek), houdt de data in de EU — relevant, er zitten kentekens en
> kentekenbewijzen tussen — en kost bij de nieuwe raming enkele dubbeltjes per maand in plaats van $5.
> Dat deel is uitgevoerd zoals hier beschreven. De aanbeveling om **Object Lock** aan te zetten bleek
> minder eenvoudig dan hier gesteld; zie het punt over onveranderlijkheid hierboven.
>
> **De kostenraming in §5 klopt niet meer.** Die ging uit van 60–70 GB groei per jaar; door het
> verkleinen wordt dat ongeveer 9 GB per jaar.
>
> **Afwijking van dit voorstel, bewust:** het wezen-lek is níét per endpoint gerepareerd, maar met een
> nachtelijke afstemming disk↔database plus een prullenbak. Reden: er bleken **twee** lekken te zijn in
> plaats van één — behalve `/api/adphotos-set` lekt ook `PUT /api/state`, want de `photos`-map wordt
> vervangen bij zowel verwijderen als **overschrijven** van een keuringsfoto (de wees `v_linksvoor.png`
> naast een levende `v_linksvoor.jpg` was daar het bewijs van). Doorslaggevend was bovendien dat de app
> een knop "Ongedaan maken" heeft na het verwijderen van een foto (`index.html` regel 688 en 707);
> direct wissen bij de aanroep zou die stilletjes stukmaken.
>
> Opgeruimd bij de eerste run: 16 bestanden / 48 MB (14 advertentiefoto's, 2 keuringsfoto's), alle 16
> vooraf exact geverifieerd als nergens meer naar verwezen. Schijf en database lopen sindsdien gelijk
> (148 = 148).

De database heeft sinds vandaag een nachtelijke back-up (`pvp-backup.timer`). De foto's en
BPM-rapporten in `/var/pvp/uploads` hebben die niet, en dat is inmiddels het grootste gat: de database
bevat alléén de URL's, dus een herstel uit de dump levert een app op waarin elke foto stuk is.

---

## 1. De feiten (gemeten op 15-08-2026)

| | |
|---|---|
| Omvang | 619 MB, 164 bestanden, 4 mappen (één per auto) |
| Soort | 163× JPEG, 1× PNG. Gemiddeld **3,8 MB** per foto, mediaan 4,0 MB, grootste 7,3 MB |
| Verdeling | 146 advertentiefoto's (`ad_*`), 15 keuringsfoto's (`v_*`, `d_*`), rest los |
| Aangroei | 13-08: 8 MB · 14-08: 414 MB · 15-08: 195 MB |
| Per auto | 50 en 82 advertentiefoto's voor de twee auto's die klaar zijn → **circa 250 MB per auto** |
| Schijf | 116 GB totaal, 108 GB vrij |
| Server | DigitalOcean, regio `ams3`. `rsync` en `tar` aanwezig; `rclone`/`restic` niet, wél in apt |
| CRP | heeft zelf ook géén kopie buiten de server (staat als openstaand punt in `crp-backup.sh`) |

**Groeiraming.** De eerste dagen zijn niet representatief (twee batches ineens ingeladen), dus reken per
auto in plaats van per dag: ±250 MB per geadverteerde auto. Bij 20 auto's per maand is dat **5–6 GB per
maand, 60–70 GB per jaar**. De schijf loopt dan over ongeveer anderhalf jaar vol. Dat is geen acuut
probleem, maar het bepaalt wel welke back-upvorm houdbaar is: een simpele "elke nacht een tar van alles"
is dat niet.

---

## 2. Vier bevindingen die het ontwerp sturen

**a. Bestanden zijn onveranderlijk.** `saveDataUrl()`/`saveFile()` in `server.js` geven elk bestand een
willekeurige naam (`crypto.randomBytes(6)`) en overschrijven nooit iets. Een bestand wordt geschreven en
daarna alleen nog gelezen of verwijderd. Dat maakt incrementele back-up triviaal: wat er gisteren stond,
staat er vandaag nog precies zo. Alleen het nieuwe hoeft mee.

**b. Er lekt schijfruimte — 8% na drie dagen.** Ik heb elke URL in de database vergeleken met wat er op
schijf staat:

- 148 bestanden waar de database naar verwijst
- 164 bestanden op schijf
- **16 wees-bestanden, samen 49 MB**, waar niets meer naar verwijst
- 0 ontbrekende bestanden (de database verwijst nergens naar iets dat weg is — dat is goed nieuws)

Oorzaak: `/api/bpmreport-del` verwijdert het bestand netjes van schijf, maar **`/api/adphotos-set` niet**.
Als de fotograaf een advertentiefoto weggooit, verdwijnt de URL uit de database en blijft het bestand van
4 MB voor altijd staan. Zonder ingrijpen back-uppen we die wezen ook, jaar in jaar uit. Dit is een aparte
kleine reparatie (zie §7), geen onderdeel van de back-up zelf — maar het scheelt straks structureel.

**c. Er zitten persoonsgegevens in.** Tussen de keuringsfoto's zitten scans van kentekenbewijzen
(`d_kb1v`, `d_kb2a`, …) en VIN-platen. Zodra die de server verlaten richting opslag van een derde partij,
is versleuteling geen luxe maar de nette invulling van de AVG. Dat sluit een simpele onversleutelde
`rclone sync` uit.

**d. De foto's zijn onnodig groot.** 3,8 MB gemiddeld is een onbewerkte telefoonfoto. Zie §7 — dit is de
enige maatregel die álle andere getallen in dit document tegelijk verkleint.

---

## 3. Voorstel: twee lagen, in twee stappen

Twee verschillende rampen vragen om twee verschillende oplossingen:

| Wat er misgaat | Hoe waarschijnlijk | Wat helpt |
|---|---|---|
| Iemand gooit per ongeluk foto's weg, of een fout in de app wist een map | **Groot** — dit is wat er in de praktijk gebeurt | Laag A: lokale snapshots (seconden om terug te zetten) |
| Schijf stuk, droplet weg, server gehackt of per ongeluk verwijderd | Klein, maar dan ben je álles kwijt | Laag B: kopie buiten de server |

### Stap A — lokale snapshots (kan vandaag, geen account nodig)

`rsync` met hardlinks naar `/var/backups/pvp/uploads/`: elke nacht een complete, direct bruikbare
momentopname, waarbij ongewijzigde bestanden geen nieuwe schijfruimte kosten maar naar hetzelfde
bestandsblok wijzen.

```
rsync -a --delete --link-dest=../laatste /var/pvp/uploads/ /var/backups/pvp/uploads/<stempel>/
```

- Eerste nacht: 619 MB. Elke nacht daarna: alleen de nieuwe foto's, dus enkele tientallen MB's.
- 14 momentopnamen bewaren kost daardoor geen 14 × 619 MB, maar ruwweg 619 MB + twee weken aangroei.
- Terugzetten van één foto is een `cp` uit de map van de dag ervoor.
- Beschermt **niet** tegen verlies van de server — dat is precies waarvoor stap B er is.

### Stap B — versleutelde kopie buiten de server (zodra jij Spaces-sleutels aanmaakt)

`restic` naar **DigitalOcean Spaces in `ams3`** (zelfde regio als de droplet, dus snel en zonder
datatransportkosten binnen DO).

Waarom `restic` en niet iets simpelers:

- **Versleuteld** vóór verzending — verplicht gezien bevinding (c). `rclone sync` doet dit standaard niet.
- **Dedupliceert en incrementeel**: alleen nieuwe blokken gaan over de lijn. Bij onveranderlijke
  bestanden (bevinding a) is dat na de eerste keer bijna niets.
- **Momentopnamen met bewaarbeleid** in plaats van een spiegel. Een spiegel is gevaarlijk: wist iemand
  hier iets, dan wist de volgende sync het ook daar. Momentopnamen niet.
- **Eén pakket uit apt**, geen npm, geen container, geen taal-runtime. Past bij hoe PVP in elkaar zit.
- Dezelfde `restic` neemt meteen ook `/var/backups/pvp/*.sql.gz` (de databasedumps) en
  `/var/pvp/secret` mee. Eén tool, één schema, één herstelprocedure.

Bewaarbeleid: `--keep-daily 14 --keep-weekly 8 --keep-monthly 12`. Door de deduplicatie kost een jaar
historie nauwelijks meer dan de laatste stand.

**Kritiek punt:** het wachtwoord van de restic-opslag komt in `/var/pvp/restic.env` (chmod 600, zoals
`pg.env`) — maar dat bestand staat op dezelfde droplet die de back-up moet overleven. **Dat wachtwoord
moet ook ergens buiten de server liggen** (wachtwoordmanager, kluis, papier in de la). Zonder dat
wachtwoord is de back-up wiskundig onherstelbaar. Dit is de enige stap die ik niet voor je kan doen.

---

## 4. Wat ik concreet zou bouwen

| Onderdeel | Inhoud |
|---|---|
| `/usr/local/bin/pvp-uploads-snapshot.sh` | Stap A: rsync-hardlink-snapshot, 14 dagen bewaren, `laatste`-symlink bijwerken |
| `/usr/local/bin/pvp-offsite.sh` | Stap B: `restic backup` van uploads + dumps + secret, daarna `forget --prune` en `check --read-data-subset=1/10` (steekproefsgewijs verifiëren dat de opslag niet stilletjes rot) |
| `pvp-uploads-snapshot.timer` | 02:30 UTC (na `pvp-backup` om 02:15, ruim na `crp-backup` om 01:30) |
| `pvp-offsite.timer` | 03:00 UTC |
| Bewaking | Beide scripts `set -euo pipefail` + `logger`; faalt er iets, dan valt de unit op in `systemctl --failed`. Ik stel voor daar een wekelijkse controle op te zetten die je een melding stuurt, want een stille back-up die al maanden faalt is erger dan geen back-up |
| Documentatie | Herstelprocedure in `CLAUDE.md`, net als bij de database |
| **Hersteltest** | Zoals bij de database-back-up: ik zet de back-up daadwerkelijk terug in een testmap en vergelijk bestand voor bestand tegen de bron. Een back-up die niet teruggezet is, is een aanname |

Alles strikt gescheiden van CRP: eigen scripts, eigen units, eigen map `/var/backups/pvp/`, eigen
Spaces-bucket. Ik raak `crp-backup.sh` en `/var/backups/crp` niet aan.

---

## 5. Kosten

DigitalOcean Spaces: **$5 per maand** voor 250 GB opslag en 1 TB verkeer. Bij de geraamde groei van
60–70 GB per jaar zit je daar drie tot vier jaar in. Verkeer binnen `ams3` telt niet mee.

Stap A kost niets (schijfruimte die er is).

---

## 6. Wat ik van jou nodig heb

1. **Akkoord op stap A** — die kan meteen, zonder account en zonder kosten.
2. Voor stap B: een **Spaces-bucket + toegangssleutel** in `ams3` (DO-paneel → Spaces Object Storage →
   bucket aanmaken, dan API → Spaces Keys). Geef me de bucketnaam en de twee sleutels; ik zet ze in
   `/var/pvp/restic.env` met rechten 600 en ze komen nooit in de repo.
3. **Een plek buiten de server voor het restic-wachtwoord.** Ik genereer het, jij bewaart het.

---

## 7. Twee losse aanbevelingen (niet in dit voorstel meegenomen)

**Foto's verkleinen bij het uploaden.** 3,8 MB per foto is een onbewerkte telefoonfoto. Terugbrengen naar
bijvoorbeeld 1920 px lange zijde levert doorgaans 300–500 KB op: **ongeveer acht keer minder**. Dat
verkleint niet alleen elke back-up en de schijfgroei, maar maakt de app ook merkbaar sneller voor het
team en voor de fotograaf op mobiel. En het kan zónder nieuwe afhankelijkheid: de browser kan de foto via
een `canvas` verkleinen vóór hij hem als data-URL naar de server stuurt — dat is puur een wijziging in
`index.html`. Dit is de maatregel met veruit de beste verhouding tussen moeite en effect, maar het is een
gedragswijziging in de app en hoort dus in een eigen stap.

**Wees-bestanden opruimen.** Twee dingen: `/api/adphotos-set` de verwijderde bestanden laten opruimen
(zoals `/api/bpmreport-del` al doet), en eenmalig de huidige 16 wezen (49 MB) weghalen. Let op de
volgorde: eerst het lek dichten en opruimen, dán de eerste off-site back-up maken — anders sleep je die
49 MB voor altijd mee in de historie. Opruimen kan veilig, want de vergelijking database↔schijf laat zien
dat er precies 0 bestanden ontbreken; het is dus geen gok welke bestanden overbodig zijn.
