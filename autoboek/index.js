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
const bouw = require('./xlsx-append.js');
const { voegToe, vulAan } = bouw;
const xlsx = require('./xlsx-lees.js');
const { lees } = xlsx;
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
 * Vult de lege cellen van een bestaande regel aan uit PVP. Zelfde voorzorgen als bij het toevoegen:
 * botsingscontrole vlak vóór het uploaden, en achteraf teruglezen. Verandert er niets, dan wordt er
 * ook niet geüpload — een lege wijziging kost alleen maar een revisie waar een ander over struikelt.
 * @returns {Promise<{rij:number, aloud:true, aangevuld:string[]}>}
 */
async function vulAanBestaande(tok, ID, voor, buf, rij, v) {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'pvp-autoboek-'));
  const inPad = path.join(map, 'in.xlsx'), uitPad = path.join(map, 'uit.xlsx');
  try {
    fs.writeFileSync(inPad, buf);
    const { kolommen } = vulAan(inPad, uitPad, BLAD, rij, uitVoertuig(v));
    if (!kolommen.length) return { rij, aloud: true, aangevuld: [] };

    const nu = await drive.meta(tok, ID);
    if (nu.headRevisionId !== voor.headRevisionId) {
      throw new Error('het Autoboek is intussen door iemand anders gewijzigd — niet geschreven, probeer het zo opnieuw');
    }
    await drive.upload(tok, ID, fs.readFileSync(uitPad));

    const na = lees(await drive.download(tok, ID));
    const kopVoor = lees(buf)[BLAD][1], kopNa = na[BLAD] && na[BLAD][1];
    if (JSON.stringify(kopVoor) !== JSON.stringify(kopNa)) throw new Error('de koprij van het Autoboek is veranderd — teruggedraaid nakijken!');
    return { rij, aloud: true, aangevuld: kolommen };
  } finally {
    try { fs.rmSync(map, { recursive: true, force: true }); } catch (_) {}
  }
}

/**
 * Schrijft één auto bij. Gooit een Error met een leesbare tekst als het niet lukt; die tekst gaat
 * naar de database en naar het scherm, zodat een mislukking zichtbaar is in plaats van stil.
 * @returns {Promise<{rij:number, aloud?:boolean}>}
 */
async function schrijfAuto(v) {
  if (!aan()) throw new Error('koppeling staat uit (AUTOBOEK_FILE_ID ontbreekt)');
  // Zonder VIN of kenteken is de regel in het Autoboek nergens aan te herkennen — en de controle op
  // dubbele regels werkt juist daarop, dus een tweede poging zou hem opnieuw toevoegen.
  if (!schoon(v.vin) && !schoon(v.kenteken)) {
    throw new Error('deze auto heeft geen VIN en geen kenteken — vul er één in, anders is de regel in het Autoboek niet terug te vinden');
  }
  const ID = process.env.AUTOBOEK_FILE_ID.trim();
  const tok = await drive.token(SCOPE);

  const voor = await drive.meta(tok, ID);
  if (!voor.capabilities || !voor.capabilities.canEdit) throw new Error('geen schrijfrecht op het Autoboek');
  const buf = await drive.download(tok, ID);

  const boek = lees(buf);
  if (!boek[BLAD]) throw new Error(`tabblad "${BLAD}" niet gevonden`);
  // Staat de regel er al, dan vullen we aan wat daar leeg is in plaats van niets te doen. Dat scheelde
  // gegevens: wie een auto in PVP weggooit en opnieuw aanmaakt — bijvoorbeeld omdat het uitlezen de
  // eerste keer weinig vond — hield de oude, magere regel, want PVP verwijdert niets uit het Autoboek.
  // Ingevulde cellen blijven staan; die kunnen handwerk van kantoor zijn.
  const al = staatErAl(boek, v);
  if (al) return await vulAanBestaande(tok, ID, voor, buf, al.rij, v);

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

/* ===== Verkoop: de regel verhuist van "Lopende Autos" naar "Verkochte Autos" =====
   Mag sinds 18-08-2026: regels verwijderen is besproken met de bouwer van de rapportage, kolommen
   blijven onaantastbaar.

   De twee bladen zijn positioneel uitgelijnd: 38 kolommen hebben letterlijk dezelfde kop en de rest
   verschilt alleen in naam op dezelfde plek (VIN/Chassisnummer, Garantie/Autotrust). Verplaatsen is
   dus kolom A t/m AV overnemen; de zeven stapkolommen die alleen Lopende heeft (AW-BC, RDW Foto's …
   Mobilox Online) vallen weg.  */
const VAN_BLAD = 'Lopende Autos';
const NAAR_BLAD = 'Verkochte Autos';
const KOL_TOT = 48;          // A t/m AV
const K_FACTUUR = 3;         // D  Fact. Nr.
const K_VERKOOPDATUM = 17;   // R  (kop is leeg op Verkochte; in Lopende heet die kolom Datum verkoop)
const K_VERKOOPPRIJS = 20;   // U  (sub)totaal
const K_VIN = 4, K_KENTEKEN = 5;

const plat = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Cellen van één rij mét hun soort. Waarden overnemen zonder het onderscheid tekst/getal zou datums en
// bedragen als tekst in het boek zetten; dan rekent er niets meer mee.
function celsUit(rijXml, gedeeld) {
  const uit = {};
  for (const c of rijXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const kol = xlsx.kolIndex(c[1]), attr = c[2] || '', inh = c[3] || '';
    const t = (/t="([^"]+)"/.exec(attr) || [])[1];
    if (t === 's') { const v = /<v>([\s\S]*?)<\/v>/.exec(inh); if (v) uit[kol] = { soort: 'tekst', w: gedeeld[Number(v[1])] }; }
    else if (t === 'inlineStr') { const w = [...inh.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => xlsx.ontsnap(m[1])).join(''); if (w) uit[kol] = { soort: 'tekst', w }; }
    else { const v = /<v>([\s\S]*?)<\/v>/.exec(inh); if (v) uit[kol] = { soort: 'getal', w: v[1] }; }
  }
  return uit;
}

/* Eén verplaatsing, drie richtingen. Zelfde code en dezelfde controles voor alle drie, want dit is
   het onderdeel dat regels uit het Autoboek weghaalt — daar wil je niet drie varianten van hebben.

   De kolomindeling verschilt per paar:
   - Lopende  -> Verkochte : positioneel A t/m AV (38 kolommen hebben dezelfde kop), de zeven
                             stapkolommen van Lopende (AW-BC) vallen weg.
   - Verkochte -> Lopende  : hetzelfde terug, met de verkoopvelden leeg.
   - Komende  -> Lopende   : D t/m P zijn gelijk; Komende R (Inkoop EX/EX) hoort in Lopende op T.
                             A/B/C betekenen op de twee bladen iets anders en gaan dus niet mee. */
const RICHTING = {
  verkocht:  { van: 'Lopende Autos',   naar: 'Verkochte Autos', tot: 48, paren: null },
  terug:     { van: 'Verkochte Autos', naar: 'Lopende Autos',   tot: 48, paren: null, wissen: [3, 17, 20] },
  binnen:    { van: 'Komende Autos',   naar: 'Lopende Autos',   tot: 56,
               paren: [[3,3],[4,4],[5,5],[6,6],[7,7],[8,8],[9,9],[10,10],[11,11],[12,12],[13,13],[14,14],[15,15],[17,19]] },
};

async function verplaats(v, welke, extra) {
  const R = RICHTING[welke];
  if (!R) throw new Error('onbekende richting: ' + welke);
  if (!aan()) throw new Error('koppeling staat uit (AUTOBOEK_FILE_ID ontbreekt)');
  if (!plat(v.vin) && !plat(v.kenteken)) throw new Error('deze auto heeft geen VIN en geen kenteken — niet terug te vinden in het Autoboek');
  const ID = process.env.AUTOBOEK_FILE_ID.trim();
  const tok = await drive.token(SCOPE);

  const voor = await drive.meta(tok, ID);
  if (!voor.capabilities || !voor.capabilities.canEdit) throw new Error('geen schrijfrecht op het Autoboek');
  const buf = await drive.download(tok, ID);

  const entries = bouw.leesZip(buf);
  const pakXml = pad => { const e = entries.find(x => x.naam === pad); if (!e) throw new Error(pad + ' ontbreekt'); return { e, xml: bouw.uitpakken(e).toString('utf8') }; };
  const gedeeldE = entries.find(x => x.naam === 'xl/sharedStrings.xml');
  const gedeeld = gedeeldE ? xlsx.tekstUit(bouw.uitpakken(gedeeldE).toString('utf8')) : [];

  const van = pakXml(bouw.bladPad(entries, R.van));
  const naar = pakXml(bouw.bladPad(entries, R.naar));

  // 1. De auto zoeken op het bronblad, op VIN of kenteken.
  const sleutels = [plat(v.vin), plat(v.kenteken)].filter(Boolean);
  const vanRijen = bouw.rijenUit(van.xml);
  let bron = null;
  for (const r of vanRijen) {
    if (r.nr < 2 || !r.gevuld) continue;
    const c = celsUit(r.binnen, gedeeld);
    for (const k of [K_VIN, K_KENTEKEN]) {
      const w = plat(c[k] && c[k].w);
      if (w && sleutels.includes(w)) { bron = { rij: r.nr, cellen: c }; break; }
    }
    if (bron) break;
  }
  if (!bron) throw new Error(`auto staat niet in "${R.van}" — niets verplaatst`);

  // 2. De nieuwe regel opbouwen.
  const waarden = new Array(R.tot).fill('');
  const zet = (i, c) => { if (c) waarden[i] = (c.soort === 'getal' ? { v: c.w } : c.w); };
  if (R.paren) for (const [a, b] of R.paren) zet(b, bron.cellen[a]);
  else for (let i = 0; i < R.tot; i++) zet(i, bron.cellen[i]);
  for (const i of (R.wissen || [])) waarden[i] = '';
  for (const [i, w] of Object.entries(extra || {})) waarden[Number(i)] = w;

  // 3. Toevoegen op de eerste vrije regel, met de opmaak van de regel erboven.
  const naarRijen = bouw.rijenUit(naar.xml);
  const gevuld = naarRijen.filter(r => r.gevuld).map(r => r.nr);
  if (!gevuld.length) throw new Error(`geen gevulde regels in "${R.naar}" — verkeerd blad?`);
  const laatste = Math.max(...gevuld);
  const doelNr = laatste + 1;
  const bestaand = naarRijen.find(r => r.nr === doelNr);
  if (bestaand && bestaand.gevuld) throw new Error(`rij ${doelNr} in "${R.naar}" is niet leeg`);
  const stijl = bouw.stijlenUit((naarRijen.find(r => r.nr === laatste) || {}).heel || '');
  if (Object.keys(stijl).length < 10) throw new Error(`kon de opmaak van rij ${laatste} niet aflezen`);
  const nieuweRij = bouw.maakRij(doelNr, waarden, stijl);

  let naarXml = naar.xml;
  if (bestaand) naarXml = naarXml.replace(bestaand.heel, nieuweRij);
  else {
    const hoger = naarRijen.map(r => r.nr).filter(n => n > doelNr).sort((a, b) => a - b)[0];
    if (hoger === undefined) naarXml = naarXml.replace('</sheetData>', nieuweRij + '</sheetData>');
    else { const pos = naarXml.indexOf(`<row r="${hoger}"`); naarXml = naarXml.slice(0, pos) + nieuweRij + naarXml.slice(pos); }
  }

  // 4. De regel van het bronblad weghalen, mét renummering.
  const vanXml = bouw.verwijderRij(van.xml, bron.rij);

  // 5. Eén bestand, één upload — anders bestaat er een moment waarop de auto op twee bladen staat.
  bouw.vervang(van.e, Buffer.from(vanXml, 'utf8'));
  bouw.vervang(naar.e, Buffer.from(naarXml, 'utf8'));
  const nieuw = bouw.schrijfZip(entries);

  // 6. Vóór het uploaden nakijken. Faalt hier iets, dan gaat er niets naar Drive.
  const boekVoor = lees(buf), boekNa = lees(nieuw);
  const telling = o => Object.keys(o).filter(n => Object.keys(o[n]).length).length;
  const breedte = o => Math.max(0, ...Object.values(o).map(r => Math.max(-1, ...Object.keys(r).map(Number)) + 1));
  for (const naam of Object.keys(boekVoor)) {
    const verwacht = naam === R.naar ? telling(boekVoor[naam]) + 1
                   : naam === R.van  ? telling(boekVoor[naam]) - 1
                   : telling(boekVoor[naam]);
    if (telling(boekNa[naam]) !== verwacht) throw new Error(`controle: "${naam}" heeft ${telling(boekNa[naam])} regels, verwacht ${verwacht} — niet geschreven`);
    if (breedte(boekVoor[naam]) !== breedte(boekNa[naam])) throw new Error(`controle: "${naam}" is van breedte veranderd — niet geschreven`);
    if (JSON.stringify(boekVoor[naam][1]) !== JSON.stringify(boekNa[naam][1])) throw new Error(`controle: de koprij van "${naam}" is veranderd — niet geschreven`);
  }
  const rijNrs = o => Object.keys(o).map(Number).filter(n => n > 1 && Object.keys(o[n]).length).sort((a, b) => a - b);
  const verwachtInhoud = rijNrs(boekVoor[R.van]).filter(n => n !== bron.rij).map(n => JSON.stringify(boekVoor[R.van][n]));
  const feitelijkInhoud = rijNrs(boekNa[R.van]).map(n => JSON.stringify(boekNa[R.van][n]));
  if (JSON.stringify(verwachtInhoud) !== JSON.stringify(feitelijkInhoud)) {
    throw new Error(`controle: de overgebleven regels in "${R.van}" zijn niet ongewijzigd — niet geschreven`);
  }

  // 7. Revisiecontrole vlak vóór het uploaden, en achteraf teruglezen.
  const nu = await drive.meta(tok, ID);
  if (nu.headRevisionId !== voor.headRevisionId) throw new Error('het Autoboek is intussen door iemand anders gewijzigd — niet geschreven, probeer het zo opnieuw');
  await drive.upload(tok, ID, nieuw);

  const terug = lees(await drive.download(tok, ID));
  const zoek = blad => Object.keys(terug[blad]).some(n => sleutels.includes(plat(terug[blad][n][K_VIN])) || sleutels.includes(plat(terug[blad][n][K_KENTEKEN])));
  if (zoek(R.van) || !zoek(R.naar)) throw new Error(`na het uploaden klopt het niet: de auto staat niet (alleen) bij "${R.naar}" — nakijken`);
  return { rij: doelNr, vanRij: bron.rij };
}

// Bevestigde verkoop: Lopende -> Verkochte, met factuurnummer, datum en prijs erbij.
async function verplaatsNaarVerkocht(v, verkoop) {
  const extra = {};
  if (verkoop.factuurnr) {
    const n = Number(String(verkoop.factuurnr).replace(/[^0-9.]/g, ''));
    extra[K_FACTUUR] = Number.isFinite(n) && String(verkoop.factuurnr).trim() !== '' ? { v: n } : String(verkoop.factuurnr);
  }
  const d = bouw.serie(verkoop.factuurdatum);
  if (d) extra[K_VERKOOPDATUM] = { v: d };
  if (verkoop.verkoopprijs !== null && verkoop.verkoopprijs !== undefined && Number.isFinite(Number(verkoop.verkoopprijs))) {
    extra[K_VERKOOPPRIJS] = { v: Number(verkoop.verkoopprijs) };
  }
  return verplaats(v, 'verkocht', extra);
}

// Per ongeluk bevestigd: Verkochte -> Lopende, met de verkoopvelden leeg.
async function verplaatsNaarLopend(v) { return verplaats(v, 'terug'); }

// Auto binnengekomen: Komende -> Lopende.
async function verplaatsBinnengekomen(v) { return verplaats(v, 'binnen'); }

module.exports = { schrijfAuto, verplaatsNaarVerkocht, verplaatsNaarLopend, verplaatsBinnengekomen, aan, BLAD };
