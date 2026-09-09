# Bouwopdracht — PVP in de nieuwe huisstijl

Voor Claude Code op de droplet (`ssh root@206.189.6.153` → `cd /root/pvp && claude --continue`).
Opgesteld 09-09-2026. Akkoord van Vince op de stijl; **livegang pas na zijn bevestiging per scherm**.

**Wat:** de typografie, kleur en indeling uit het goedgekeurde voorbeeld "Afleveringen met
klantgegevens" doorvoeren over **heel PVP** — alle schermen, inclusief de rij-/kaartopbouw en
spatiëring.

**Bestand:** `pvp-stijl.css` (bij deze opdracht geleverd) is de complete stijl. Die inhoud gaat
in de bestaande `<style>` van `index.html` — geen los CSS-bestand, geen bundler, conform CLAUDE.md.

---

## Werkwijze — niet in één keer

1. **Plan-modus** en **verse back-up** vóór de eerste wijziging.
2. **Eén scherm per deploy.** Volgorde: Vandaag → Komende → Lopende → Carport → Logistiek →
   Verkocht → login/foutmeldingen. Na elk scherm: health-check, rol-flows testen, Vince laten kijken.
3. Alleen `index.html` raken. **Geen wijziging in `server.js`, geen npm, CRP niet aanraken.**
4. Bij twijfel over een klasse: eerst voorleggen, niet gokken.

---

## Stap 0 — inventarisatie (vóór er één regel verandert)

Maak eerst een **mapping-tabel** en leg die voor:

```
grep -o 'class="[^"]*"' /var/www/html/index.html | sort | uniq -c | sort -rn
```

Zet per bestaande klasse in de tabel: *oude klasse → nieuwe klasse uit `pvp-stijl.css` → weg /
blijft*. Klassen die alleen kleur, rand, lettertype of spatiëring regelden, verdwijnen; de nieuwe
stijl doet dat via tokens. Klassen met eigen gedrag (JS-hooks, `querySelector`) blijven staan —
**controleer eerst of JS erop selecteert** voordat je een klasse hernoemt:

```
grep -n "querySelector\|getElementById\|classList" /var/www/html/index.html | head -80
```

---

## Stap 1 — fonts en stijlblok

In de `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
```

In de `<style>`: de inhoud van `pvp-stijl.css` **bovenaan**, vóór de schermspecifieke regels.
Verwijder daarna uit de oude CSS alles wat de nieuwe stijl overneemt: `font-family`, `font-size`,
`color`, `background`, `border`, `border-radius`, `box-shadow` en losse `margin`/`padding` op
generieke elementen. **Laat oud en nieuw niet naast elkaar staan** — dat is precies hoe
specificiteitsgevechten ontstaan (zie CLAUDE.md, "valkuilen").

Controle na deze stap: `grep -c "#[0-9a-fA-F]\{6\}" /var/www/html/index.html` — losse hexkleuren
mogen alleen nog in het token-blok voorkomen. Elke kleur elders wordt `var(--…)`.

---

## Stap 2 — de patronen waarmee je elk scherm bouwt

**Lijstrij met uitklap** (afleveringen, komende auto's, werkbonnen, taken):

```html
<div class="lijst">
  <div class="rij-item" open-state="0">
    <button class="rij-kop" aria-expanded="false" aria-controls="b-12" onclick="…">
      <span class="tijd">10:30</span>
      <span class="rij-titel">
        <span class="naam">Citroën C4 1.2 PureTech Shine</span>
        <span class="meta"><span class="kenteken">R-421-XT</span> Fact. 318</span>
      </span>
      <span class="rij-rechts">
        <span class="status st-gereed">Gereed</span>
        <svg class="chev" …></svg>
      </span>
    </button>
    <div class="rij-body" id="b-12">
      <div class="blok"><h3>Klantgegevens</h3> … </div>
      <div class="acties"> … <span class="melding"></span></div>
    </div>
  </div>
</div>
```

**Veld met label** (overal waar nu "label: waarde" staat):

```html
<div class="velden">
  <div class="veld"><span class="lbl">Kilometerstand</span><span class="val mono">84.210</span></div>
</div>
```

**Verder:** `.panel` + `.panel-head` om elk scherm-onderdeel · `.kaart` binnen een paneel ·
`.knop` / `.knop.primair` / `.knop.stil` / `.knop.gevaar` · `.status` met `st-gereed` / `st-wacht` /
`st-klaar` / `st-stop` · `.count` (+ `.warn`, `.stop`) voor tellers in een kop · `.note` voor de
storingsmelding · `table.pvp` in een `.tabelwrap` · `.ring` voor de voortgangsring.

**Drie vaste regels:**

- elk getal dat in een kolom uitlijnt krijgt `.mono` (tijd, km, bedrag, factuur-/VIN-nummer);
- elk kenteken krijgt `.kenteken`, overal in de app;
- status nooit met kleur alléén — altijd ook de tekst in de badge.

---

## Stap 3 — per scherm

- **Vandaag** — geplande afleveringen als `.lijst` (uitklap zoals het voorbeeld), to-do's als
  tweede paneel met dezelfde rij-opbouw, garantiegevallen als derde. Storingsmelding van een
  koppeling wordt `.note.stop` bovenaan.
- **Komende** — inruillijst uit Mobilox als `table.pvp` in een `.tabelwrap`, of als `.lijst`
  wanneer een rij uitklapbaar moet zijn. Kenteken- en datumkolommen mono.
- **Lopende** — per auto de `.ring` links, naam + kenteken in `.rij-titel`, afleverdatum mono
  rechts. Fase-namen als `.lbl` boven de voortgang.
- **Carport** — werkbonnen als `.lijst` met uitklap; de twee logboeken als `table.pvp`. Slepen
  Carport↔poetser blijft functioneel ongewijzigd; alleen de sleepvakken worden `.kaart`.
- **Logistiek** — de 2×2 partijvakken worden `.kaart` in een grid; zoekbalk in de `.panel-head`.
- **Verkocht** — `table.pvp`, bedragen rechts uitgelijnd (`td.num`).
- **Login en foutmeldingen** — één `.panel` gecentreerd; foutregel als `.note.stop`.

---

## Stap 4 — testen vóór livegang

- **Rollen:** team, admin, foto, taxateur — elk inloggen en elk scherm bekijken; knoppen die een rol
  niet mag zien, blijven verborgen.
- **Donker thema:** systeeminstelling op donker zetten. Geen enkele kleur mag alleen in een
  media-query bestaan; controleer of tekst overal leesbaar is op het vlak eronder.
- **Mobiel:** 375 px breed. De pagina mag niet zijwaarts schuiven; brede tabellen schuiven in hun
  eigen `.tabelwrap`.
- **Toetsenbord:** met Tab door een lijst; uitklappers openen met Enter/Spatie, focusrand zichtbaar.
- **Regressie:** afvinken/verzetten/terugzetten, verkoop bevestigen, werkbon openen, slepen in
  Carport en Logistiek.

## Stap 5 — deploy

`cp` naar `/var/www/html`, `systemctl restart pvp-api` (alleen nodig als er ook aan de API iets
verandert — bij puur `index.html` niet), health-check, en in de browser hard herladen (Ctrl+F5)
omdat de oude CSS in de cache zit. Rollback = de back-up terugzetten.

---

## Valkuilen

- **Specificiteit:** oude regels als `.section` die met nieuwe `.panel`-padding vechten. Oud weghalen,
  niet overschrijven.
- **`window.history`**, niet `history` — de lokale undo-stack overschaduwt de globale.
- **JS-hooks:** een klasse die in `querySelector` staat, niet hernoemen zonder de JS mee te nemen.
- **Fonts:** ze komen van Google Fonts. Valt dat weg, dan pakt de fallback-stack het op — dat is
  bewust zo ingesteld en mag niet leiden tot een lege pagina.
- **Tokens:** een nieuwe kleur voeg je toe aan `:root` én aan beide donkere blokken, nooit alleen
  in een component.

---

## Hoe je dit start (Vince)

1. Beide bestanden op de droplet zetten, vanaf je eigen machine:

   ```
   scp ~/Downloads/pvp-stijl.css ~/Downloads/pvp-stijl-bouwopdracht.md root@206.189.6.153:/root/pvp/
   ```

2. `ssh root@206.189.6.153` → `cd /root/pvp && claude --continue`

3. Deze opdracht plakken:

   > Lees `/root/pvp/pvp-stijl-bouwopdracht.md` en `/root/pvp/pvp-stijl.css`. We voeren de nieuwe
   > huisstijl in over heel PVP, maar **stap voor stap en alleen scherm Vandaag in deze ronde**.
   > Ga eerst in plan-modus: maak een verse back-up, doe stap 0 (inventarisatie van de bestaande
   > klassen in `/var/www/html/index.html`) en leg de mapping-tabel aan mij voor vóór je iets wijzigt.
   > Niets deployen zonder mijn akkoord.

4. Na akkoord en deploy: `https://pvp.prieva.nl` openen met **Ctrl+F5** (harde herlaad, anders zie je
   de oude CSS uit de cache). Rol-flows testen zoals in stap 4.

5. Pas als Vandaag goed staat: dezelfde opdracht opnieuw, met het volgende scherm.

**Rollback:** de back-up van vóór de wijziging terugzetten over `/var/www/html/index.html`. Bij een
wijziging aan alleen `index.html` hoeft `pvp-api` niet herstart te worden.
