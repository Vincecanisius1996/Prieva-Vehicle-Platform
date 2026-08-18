// Inkoopstukken uitlezen: pdf's en screenshots erin, ingevulde velden eruit.
//
// Puur Node (fetch + JSON) — geen npm-pakket, in lijn met de regel dat `pg` de enige uitzondering is.
// Instellingen via /var/pvp/ai.env in de systemd-unit:
//   ANTHROPIC_API_KEY   de sleutel (chmod 600, nooit in de repo)
//   UITLEZEN_MODEL      standaard claude-sonnet-5
//   UITLEZEN_MAX_MB     standaard 20 (totale omvang van de stukken per auto)
//
// Waarom dit nodig is: de backend is een kaal Node-proces en kan documenten niet begrijpen. Wat
// Claude Code in een sessie doet, moet de server tijdens het verzoek zelf kunnen.
//
// De velden die NOOIT uit de stukken komen (bewezen op tien echte auto's, 17-08-2026): kenteken bij
// import, transportdatum en factuurnummer. Die blijven leeg en dat hoort zichtbaar te zijn — een veld
// dat niet gevuld kan worden, is een gat in het dossier.

// Instelbaar zodat dit met een nepserver te testen is zonder echte aanroepen te doen.
const API = () => process.env.UITLEZEN_API || 'https://api.anthropic.com/v1/messages';

// Merknotatie niet aan het model overlaten: de ene keer komt er "Nissan" terug en de andere keer
// "NISSAN", precies zoals het in het document staat. Dezelfde functie als de Autoboek-koppeling
// gebruikt, zodat de twee niet uiteen kunnen lopen.
let merkNotatie = s => s;
try { merkNotatie = require('../autoboek/xlsx-append.js').merkNotatie || merkNotatie; }
catch (e) { console.error('merknotatie niet geladen:', e.message); }
const VERSIE = '2023-06-01';
const MODEL = () => process.env.UITLEZEN_MODEL || 'claude-sonnet-5';
const MAX_BYTES = () => (Number(process.env.UITLEZEN_MAX_MB) || 20) * 1024 * 1024;

const aan = () => !!(process.env.ANTHROPIC_API_KEY || '').trim();

// De vorm waarin we het antwoord willen. Afdwingen via een tool is betrouwbaarder dan vragen om JSON:
// het model kán dan niet iets anders teruggeven.
const SCHEMA = {
  type: 'object',
  properties: {
    vin:          { type: ['string','null'], description: 'Chassisnummer / VIN / FIN, 17 tekens' },
    kenteken:     { type: ['string','null'], description: 'Nederlands kenteken. Een buitenlands kenteken hier NIET invullen.' },
    merk:         { type: ['string','null'] },
    model:        { type: ['string','null'], description: 'Modelnaam, bijvoorbeeld C4, Golf, Formentor' },
    uitv:         { type: ['string','null'], description: 'Uitvoering/motorisering, bijvoorbeeld "1.2 PureTech Feel EAT8 130pk"' },
    kleur:        { type: ['string','null'], description: 'In het Nederlands: Zwart, Wit, Grijs, Blauw, Rood, Beige, Groen. Fabrieksnamen omzetten naar de gewone kleur.' },
    brandstof:    { type: ['string','null'], enum: ['Benzine','Diesel','Elektrisch','PHEV','Hybride','LPG', null] },
    transm:       { type: ['string','null'], enum: ['Handgeschakeld','Automaat', null] },
    reg:          { type: ['string','null'], description: 'Datum eerste toelating als dd-mm-jjjj' },
    km:           { type: ['integer','null'], description: 'Kilometerstand als geheel getal, zonder punten' },
    inkoopprijs:  { type: ['number','null'], description: 'Inkoopbedrag exclusief, in euro' },
    inkoopdatum:  { type: ['string','null'], description: 'Datum van de koopovereenkomst of factuur, dd-mm-jjjj' },
    factuurnr:    { type: ['string','null'], description: 'Factuur- of pro-formanummer' },
    importAuto:   { type: ['boolean','null'], description: 'true bij een buitenlandse aankoop' },
    note:         { type: ['string','null'], description: 'Korte bijzonderheden: schadeverleden, gebreken, staat. Nederlands, maximaal twee zinnen.' },
    bronnen:      { type: 'object', description: 'Per gevuld veld de bestandsnaam waar het uit komt', additionalProperties: { type: 'string' } },
    onzeker:      { type: 'array', items: { type: 'string' }, description: 'Velden waarvan je niet zeker bent' },
  },
  required: ['bronnen', 'onzeker'],
};

const OPDRACHT = `Je krijgt de inkoopstukken van één auto: koopovereenkomsten, pro-formafacturen, taxatie- of
conditierapporten en screenshots van veilingsites. Ze kunnen in het Nederlands, Duits, Deens of Engels zijn.

Haal er de gegevens uit die hieronder gevraagd worden, en gebruik het gereedschap "velden" om ze terug te geven.

Regels:
- Vul een veld ALLEEN als je het echt in de stukken ziet. Verzin niets en leid niets af uit algemene kennis
  over het model. Weet je het niet: null. Een leeg veld is bruikbaar, een verzonnen veld is schadelijk.
- Geef ELK veld terug, ook als het null is. Laat velden niet weg.
- CIJFERS OVERTIKKEN, NIET SCHATTEN. Lees een kilometerstand, prijs, VIN of datum cijfer voor cijfer over
  zoals hij er staat. "69.532 km" is 69532, niet 69533. Kun je een cijfer niet met zekerheid lezen, geef
  dan null voor dat veld. Eén cijfer ernaast ziet er goed uit en gaat zo de administratie in; dat is
  erger dan een leeg veld.
- Op een veilingpagina staan de gegevens meestal onder koppen als "Age and mileage" (Mileage, First
  registration), "Interior and type" (Color, Doors count, Body type), "Engine and performance"
  (Propellant, Transmission, Maximum power) en "Priser"/"Price". De uitvoering staat als regel onder het
  merk en model, bijvoorbeeld "1,2 PureTech Attraction m/Plus Pakke 83HK 5d". Loop die koppen langs.
- Verzin geen precisie die er niet staat. Staat er alleen een bouwjaar ("Bouwjaar 2016") en geen volledige
  datum, laat "reg" dan LEEG — maak er geen 01-01-2016 van. Een verkeerde datum eerste toelating werkt door
  in de BPM en in de advertentie.
- "inkoopdatum" is de datum die op de koopovereenkomst, aankoopspecificatie of factuur staat; bij een
  inkoopformulier van een particulier is dat de datum onderaan bij het kavelnummer.
- Staat hetzelfde gegeven in meerdere stukken en spreken die elkaar tegen, zet het veld dan in "onzeker".
- Datums altijd als dd-mm-jjjj. Kilometerstand als geheel getal zonder scheidingstekens.
- Kleuren naar gewoon Nederlands: "Black" en "Schwarz" worden "Zwart", een fabrieksnaam als "Magnetic Tech"
  wordt de gewone kleur die je op de foto's of in de tekst ziet.
- Brandstof en transmissie naar de toegestane waarden. "Benzin"/"Hybrid Benzin" met stekker is PHEV.
  "Automatik"/"Automatisk"/"Aut" is Automaat.
- Zet in "bronnen" per gevuld veld de bestandsnaam waar je het vandaan hebt.

BELANGRIJK — persoonsgegevens: in Nederlandse inkoopformulieren staan naam, adres, telefoonnummer en
e-mailadres van de particuliere verkoper. Neem die NOOIT over, ook niet in de notitie. Ze horen niet in dit
systeem. De leveranciersnaam van een bedrijf of veilinghuis mag wel.`;

const MIME_OK = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

// Van een data-URL naar een inhoudsblok voor de API.
function blok(doc) {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/.exec(doc.dataUrl || '');
  if (!m) return null;
  const mime = m[1].toLowerCase(), data = m[2];
  if (mime === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: mime, data } };
  if (Object.values(MIME_OK).includes(mime) && mime !== 'application/pdf') {
    return { type: 'image', source: { type: 'base64', media_type: mime, data } };
  }
  return null;   // onbekend type: overslaan in plaats van de hele aanroep laten mislukken
}

/**
 * @param {Array<{name:string,dataUrl:string}>} docs
 * @returns {Promise<{velden:object, bronnen:object, onzeker:string[], gebruikt:string[], overgeslagen:string[], verbruik:object}>}
 */
async function lees(docs) {
  if (!aan()) throw new Error('uitlezen staat uit (ANTHROPIC_API_KEY ontbreekt)');
  if (!Array.isArray(docs) || !docs.length) throw new Error('geen documenten meegegeven');

  // Volgorde en aantal: pdf's zijn documenten en gaan er altijd in. Bij afbeeldingen komen
  // screenshots eerst (png) en foto's daarna, en er gaan er hooguit MAX_BEELD mee. Bij de eerste
  // echte auto werden tien veilingfoto's van 1,2 MB meegestuurd naast één screenshot; die verdrongen
  // het enige stuk waar de gegevens op stonden, kostten 40.000 tokens en leverden niets op.
  const isPdf = d => /^data:application\/pdf;/.test(d.dataUrl || '');
  const isPng = d => /^data:image\/png;/.test(d.dataUrl || '');
  const omvangVan = d => (d.dataUrl || '').length;
  const gesorteerd = [
    ...docs.filter(isPdf),
    ...docs.filter(d => !isPdf(d) && isPng(d)).sort((a, b) => omvangVan(a) - omvangVan(b)),
    ...docs.filter(d => !isPdf(d) && !isPng(d)).sort((a, b) => omvangVan(a) - omvangVan(b)),
  ];
  const MAX_BEELD = Number(process.env.UITLEZEN_MAX_BEELD) || 3;

  const inhoud = [], gebruikt = [], overgeslagen = [];
  let bytes = 0, beelden = 0;
  for (const d of gesorteerd) {
    const b = blok(d);
    if (!b) { overgeslagen.push(d.name || 'naamloos'); continue; }
    if (b.type === 'image') {
      if (beelden >= MAX_BEELD) { overgeslagen.push((d.name || 'naamloos') + ' (meer dan ' + MAX_BEELD + ' afbeeldingen)'); continue; }
      beelden++;
    }
    const omvang = Math.ceil((b.source.data.length * 3) / 4);
    // Grens op de totale omvang: één keer per ongeluk een map vol foto's erin duwen mag niet meteen
    // een grote rekening opleveren.
    if (bytes + omvang > MAX_BYTES()) { overgeslagen.push((d.name || 'naamloos') + ' (te groot)'); continue; }
    bytes += omvang;
    inhoud.push({ type: 'text', text: `Bestand: ${d.name || 'naamloos'}` }, b);
    gebruikt.push(d.name || 'naamloos');
  }
  if (!gebruikt.length) throw new Error('geen bruikbare documenten (alleen pdf en afbeeldingen)');
  inhoud.push({ type: 'text', text: OPDRACHT });

  const r = await fetch(API(), {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY.trim(),
      'anthropic-version': VERSIE,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL(),
      max_tokens: 2000,
      // Geen `temperature`: die is op deze modelgeneratie verwijderd en geeft een 400. Sturen op
      // nauwkeurigheid gaat via `effort` (en het model zelf), niet via sampling.
      tools: [{ name: 'velden', description: 'De gegevens van de auto uit de stukken', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'velden' },
      messages: [{ role: 'user', content: inhoud }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(netteFout(r.status, j));

  const gereedschap = (j.content || []).find(c => c.type === 'tool_use');
  if (!gereedschap || !gereedschap.input) throw new Error('het model gaf geen bruikbaar antwoord terug');
  const uit = gereedschap.input;
  const { bronnen = {}, onzeker = [], ...velden } = uit;
  if (velden.merk) velden.merk = merkNotatie(velden.merk);

  return {
    velden, bronnen, onzeker: Array.isArray(onzeker) ? onzeker : [],
    gebruikt, overgeslagen,
    verbruik: { in: (j.usage || {}).input_tokens || 0, uit: (j.usage || {}).output_tokens || 0, model: j.model || MODEL() },
  };
}

// Fouten in gewone taal: dit belandt op het scherm van een collega.
function netteFout(status, body) {
  const detail = (body && body.error && body.error.message) || '';
  if (status === 401) return 'de API-sleutel wordt niet geaccepteerd — controleer /var/pvp/ai.env';
  if (status === 400 && /credit|balance/i.test(detail)) return 'geen tegoed meer op het API-account';
  if (status === 429) return 'te veel aanvragen tegelijk — probeer het zo opnieuw';
  if (status >= 500) return 'de dienst is nu niet bereikbaar — probeer het zo opnieuw';
  return 'uitlezen mislukt (' + status + ')' + (detail ? ': ' + detail : '');
}

module.exports = { lees, aan };
