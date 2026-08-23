// Eenmalig, 23-08-2026: twee dubbele regels weghalen die door mijn eigen import van de
// RDW-bedrijfsvoorraad zijn ontstaan.
//
//   * Lopende rij 51 en 53 zijn allebei de Audi A3 9-ZPF-87. Rij 53 (van de import) is vollediger —
//     die heeft 1e toelating, inkoopdatum en inkoopprijs. De leverancier van rij 51 ("inruil Delawi")
//     is met de hand ingevuld en informatiever, dus die wordt eerst overgezet; daarna gaat 51 weg.
//   * Lopende rij 55 is de Peugeot 107 93-XXX-1, die op rij 31 al stond mét chassisnummer.
//
// Oorzaak: de dubbelcontrole vergelijkt VIN én kenteken, maar een regel met alléén een VIN en een
// regel met alléén een kenteken overlappen nergens. Die zijn niet als dezelfde auto herkend.
//
// Vier wijzigingen in ÉÉN upload — nooit twee keer uploaden, want dan bestaat er een moment waarop
// het boek half bijgewerkt is:
//   1. Verkochte rij 305 (BMW J-699-DX): factuurnummer 183 -> 336, met datum en prijs van die factuur
//   2. Verkochte rij 303 (Renault Twingo KST-45-P): 181 -> 333, idem
//   3. Komende rij 15 (Peugeot 208 KTD-70-T) weg: die auto is verkocht en staat al op Verkochte 308
//   4. Verkochte rij 320 en 321 weg: dubbelen die op 23-08 door de verkoopbevestiging ontstonden.
//      De regels 311 en 312 stonden er al en zijn vollediger (chassisnummer, inkoopprijs, marge).
//
// Verwijderen gaat van achter naar voren, anders schuiven de rijnummers onder je handen weg.
const drive = require('../autoboek/drive.js');
const bouw = require('../autoboek/xlsx-append.js');
const xlsx = require('../autoboek/xlsx-lees.js');

const ID = process.env.AUTOBOEK_FILE_ID || '1MnSN9PJjzJTEp4aLwhyjKeH-h4-wb3if';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const ECHT = process.argv.includes('--echt');
const P = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const CELLEN = [
  { blad: 'Lopende Autos', rij: 53, kent: '9ZPF87', zet: { 9: 'inruil Delawi' } },
  
  
];
const WEG = [
  { blad: 'Lopende Autos', rij: 55, kent: '93XXX1' },
  { blad: 'Lopende Autos', rij: 51, kent: '9ZPF87' },
  
  
  
];

// Eén cel in een bestaande rij zetten. Bewust hier en niet in autoboek/: dit is eenmalig herstelwerk
// en hoort niet op het dagelijkse schrijfpad terecht te komen.
function zetCel(xml, rijNr, kolIndex, waarde) {
  const ref = bouw.kolLetter(kolIndex) + rijNr;
  const getal = typeof waarde === 'number';
  const inhoud = getal ? String(waarde) : String(bouw.serie(waarde) ?? waarde);
  const rijRe = new RegExp(`(<row r="${rijNr}"[^>]*>)([\\s\\S]*?)(</row>)`);
  const m = rijRe.exec(xml);
  if (!m) throw new Error('rij ' + rijNr + ' niet gevonden');
  let binnen = m[2];
  const celRe = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const bestaand = celRe.exec(binnen);
  if (!bestaand) throw new Error('cel ' + ref + ' bestaat niet — deze opschoning vult geen lege cellen');
  // Stijl behouden, type weghalen (we schrijven een getal), waarde vervangen.
  const attr = (bestaand[1] || '').replace(/\s*t="[^"]*"/, '');
  binnen = binnen.replace(celRe, `<c r="${ref}"${attr}><v>${inhoud}</v></c>`);
  return xml.replace(rijRe, (_, a, __, c) => a + binnen + c);
}

(async () => {
  const tok = await drive.token(SCOPE);
  const voor = await drive.meta(tok, ID);
  console.log('werkboek:', voor.name, '| revisie', voor.headRevisionId);
  const buf = await drive.download(tok, ID);
  const entries = bouw.leesZip(buf);
  const gedeeldE = entries.find(x => x.naam === 'xl/sharedStrings.xml');
  const gedeeld = gedeeldE ? xlsx.tekstUit(bouw.uitpakken(gedeeldE).toString('utf8')) : [];

  const controle = xlsx.lees(buf);
  // Vóór alles: klopt elke rij nog met de auto die we verwachten? Rijnummers schuiven; blind op een
  // nummer schrijven is precies hoe je de verkeerde auto raakt.
  for (const c of [...CELLEN, ...WEG]) {
    const rij = controle[c.blad][c.rij] || {};
    const gevonden = [P(rij[4]), P(rij[5])];
    if (!gevonden.includes(c.kent)) throw new Error(
      `${c.blad} rij ${c.rij} is niet ${c.kent} maar ${gevonden.filter(Boolean).join('/') || '(leeg)'} — gestopt, er is niets gewijzigd`);
    console.log(`  gecontroleerd: ${c.blad} rij ${c.rij} = ${c.kent}`);
  }

  const perBlad = {};
  const pak = blad => { const pad = bouw.bladPad(entries, blad);
    if (!perBlad[pad]) { const e = entries.find(x => x.naam === pad); perBlad[pad] = { e, xml: bouw.uitpakken(e).toString('utf8') }; }
    return perBlad[pad]; };

  for (const c of CELLEN) { const b = pak(c.blad);
    for (const [kol, w] of Object.entries(c.zet)) b.xml = zetCel(b.xml, c.rij, Number(kol), w);
    console.log(`  bijgewerkt: ${c.blad} rij ${c.rij} ->`, JSON.stringify(c.zet)); }
  for (const w of WEG) { const b = pak(w.blad); b.xml = bouw.verwijderRij(b.xml, w.rij);
    console.log(`  verwijderd: ${w.blad} rij ${w.rij} (${w.kent})`); }

  for (const b of Object.values(perBlad)) bouw.vervang(b.e, Buffer.from(b.xml, 'utf8'));
  const nieuw = bouw.schrijfZip(entries);

  // Nakijken vóór het uploaden. Faalt hier iets, dan gaat er niets naar Google.
  const na = xlsx.lees(nieuw);
  const gevuld = b => Object.keys(na[b]).filter(n => Number(n) > 1 && (String(na[b][n][4] || '').trim() || String(na[b][n][5] || '').trim())).length;
  const gevuldVoor = b => Object.keys(controle[b]).filter(n => Number(n) > 1 && (String(controle[b][n][4] || '').trim() || String(controle[b][n][5] || '').trim())).length;
  const verwacht = { 'Komende Autos': 0, 'Lopende Autos': -2, 'Verkochte Autos': 0 };
  let mis = 0;
  for (const blad of Object.keys(controle)) {
    const v = gevuldVoor(blad), n = gevuld(blad), d = n - v, w = verwacht[blad] ?? 0;
    console.log(`  ${blad.padEnd(18)} ${v} -> ${n}  (${d >= 0 ? '+' : ''}${d}, verwacht ${w})`);
    if (d !== w) { console.log('    !! klopt niet'); mis++; }
    if (JSON.stringify(controle[blad][1] || {}) !== JSON.stringify(na[blad][1] || {})) { console.log('    !! koprij gewijzigd'); mis++; }
  }
  if (mis) { console.log(`\n${mis} controle(s) mislukt — er is NIETS geüpload.`); process.exitCode = 1; return; }

  if (!ECHT) { console.log('\n>>> PROEFDRAAI — alles gecontroleerd, er is niets geüpload. Draai met --echt.'); return; }
  const nu = await drive.meta(tok, ID);
  if (nu.headRevisionId !== voor.headRevisionId) { console.log('\nhet werkboek is intussen gewijzigd — gestopt.'); process.exitCode = 1; return; }
  const uit = await drive.upload(tok, ID, nieuw);
  console.log('\ngeüpload, nieuwe revisie', uit.headRevisionId);
})();
