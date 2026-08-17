// Eén auto als regel bijschrijven in het Autoboek (tabblad "Komende Autos").
//
// Instellingen komen uit de omgeving, via /var/pvp/autoboek.env in de systemd-unit:
//   AUTOBOEK_FILE_ID   het bestand in Drive
//   AUTOBOEK_SLEUTEL   pad naar de service-account-sleutel (standaard /var/pvp/autoboek-sleutel.json)
// Staat AUTOBOEK_FILE_ID niet ingevuld, dan doet dit onderdeel niets en zegt het dat ook. Zo kan de
// koppeling aan- en uitgezet worden met één regel, en wijst hij eerst naar de testkopie.
//
// Waarom het bestand niet omgezet wordt naar een Google Sheet: er draait een Power BI-rapportage op.
// De kolomstructuur mag daarom nooit veranderen. Zie LEESMIJ.md en PVP-autoboek-koppeling-voorstel.md.
const drive = require('./drive.js');
const { voegToe } = require('./xlsx-append.js');
const { lees } = require('./xlsx-lees.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCOPE = 'https://www.googleapis.com/auth/drive';
const BLAD = 'Komende Autos';

const aan = () => !!(process.env.AUTOBOEK_FILE_ID || '').trim();

// De auto zoals de database hem heeft -> de velden die xlsx-append verwacht.
// Kolom A (F), B (TO-DO), D (Fact. Nr.) en Q (Datum verkoop) blijven leeg: handwerk van kantoor.
// PVP gebruikt een kastlijntje als "onbekend". Dat is een schermteken, geen waarde: het hoort niet in
// het Autoboek, en bij een datumkolom zou het zelfs een onzinnige uitkomst geven. Hier eruit filteren.
const schoon = x => {
  const s = (x === null || x === undefined) ? '' : String(x).trim();
  return (s === '' || s === '—' || s === '-' || s === '?') ? '' : s;
};
const getal = x => {
  if (x === null || x === undefined || String(x).trim() === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

function uitVoertuig(v) {
  return {
    transport: schoon(v.batch),
    vin: schoon(v.vin),
    kenteken: schoon(v.kenteken),
    merk: schoon(v.merk),
    type: schoon(v.model),
    kleur: schoon(v.kleur),
    leverancier: schoon(v.lev),
    uitvoering: schoon(v.uitv),
    brandstof: schoon(v.brandstof),
    transmissie: schoon(v.transm),
    reg: schoon(v.reg),
    km: getal(v.km),
    inkoopdatum: schoon(v.inkoopdatum),
    inkoopprijs: getal(v.inkoopprijs),
  };
}

// Staat deze auto er al in? Voorkomt een dubbele regel na een halfgeslaagde poging of een tweede klik.
function staatErAl(boek, v) {
  const rijen = boek[BLAD]; if (!rijen) return false;
  const sleutels = [v.vin, v.kenteken].filter(x => x && x !== '—').map(x => String(x).toUpperCase().replace(/[^A-Z0-9]/g, ''));
  if (!sleutels.length) return false;
  for (const nr of Object.keys(rijen)) {
    if (Number(nr) < 2) continue;
    for (const kol of [4, 5]) {                       // E = VIN, F = Kenteken
      const w = String(rijen[nr][kol] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (w && sleutels.includes(w)) return { rij: Number(nr) };
    }
  }
  return false;
}

/**
 * Schrijft één auto bij. Gooit een Error met een leesbare tekst als het niet lukt; die tekst gaat
 * naar de database en naar het scherm, zodat een mislukking zichtbaar is in plaats van stil.
 * @returns {Promise<{rij:number, aloud?:boolean}>}
 */
async function schrijfAuto(v) {
  if (!aan()) throw new Error('koppeling staat uit (AUTOBOEK_FILE_ID ontbreekt)');
  const ID = process.env.AUTOBOEK_FILE_ID.trim();
  const tok = await drive.token(SCOPE);

  const voor = await drive.meta(tok, ID);
  if (!voor.capabilities || !voor.capabilities.canEdit) throw new Error('geen schrijfrecht op het Autoboek');
  const buf = await drive.download(tok, ID);

  const boek = lees(buf);
  if (!boek[BLAD]) throw new Error(`tabblad "${BLAD}" niet gevonden`);
  const al = staatErAl(boek, v);
  if (al) return { rij: al.rij, aloud: true };        // niets doen: staat er al

  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'pvp-autoboek-'));
  const inPad = path.join(map, 'in.xlsx'), uitPad = path.join(map, 'uit.xlsx');
  try {
    fs.writeFileSync(inPad, buf);
    const rij = voegToe(inPad, uitPad, uitVoertuig(v));
    const nieuw = fs.readFileSync(uitPad);

    // Vlak vóór het uploaden: heeft iemand anders intussen opgeslagen? Dan niet schrijven — anders
    // gooien we hun werk weg. Beter een auto die nog niet in het boek staat dan een verdwenen regel.
    const nu = await drive.meta(tok, ID);
    if (nu.headRevisionId !== voor.headRevisionId) {
      throw new Error('het Autoboek is intussen door iemand anders gewijzigd — niet geschreven, probeer het zo opnieuw');
    }
    await drive.upload(tok, ID, nieuw);

    // Nalezen: een schrijfactie die je niet nakijkt, is een aanname.
    const terug = await drive.download(tok, ID);
    const na = lees(terug);
    if (!staatErAl(na, v)) throw new Error('de regel is geüpload maar staat er bij het nalezen niet in');
    const kopVoor = boek[BLAD][1], kopNa = na[BLAD] && na[BLAD][1];
    if (JSON.stringify(kopVoor) !== JSON.stringify(kopNa)) throw new Error('de koprij van het Autoboek is veranderd — teruggedraaid nakijken!');
    return { rij };
  } finally {
    try { fs.rmSync(map, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = { schrijfAuto, aan, BLAD };
