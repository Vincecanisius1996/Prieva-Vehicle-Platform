// Eenmalige opschoning van het Autoboek, 23-08-2026, na overleg met Prieva.
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
  { blad: 'Verkochte Autos', rij: 181, kent: 'J699DX',  zet: { 3: 336, 17: '21-08-2026', 20: 6250 } },
  { blad: 'Verkochte Autos', rij: 177, kent: 'KST45P',  zet: { 3: 333, 17: '21-08-2026', 20: 12300 } },
];
const WEG = [
  { blad: 'Verkochte Autos', rij: 321, kent: 'TB198D' },
  { blad: 'Verkochte Autos', rij: 320, kent: '1TRH86' },
  { blad: 'Komende Autos',   rij: 15,  kent: 'KTD70T' },
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
  const verwacht = { 'Komende Autos': -1, 'Lopende Autos': 0, 'Verkochte Autos': -2 };
  let mis = 0;
  for (const blad of Object.keys(controle)) {
    const v = gevuldVoor(blad), n = gevuld(blad), d = n - v, w = verwacht[blad] ?? 0;
    console.log(`  ${blad.padEnd(18)} ${v} -> ${n}  (${d >= 0 ? '+' : ''}${d}, verwacht ${w})`);
    if (d !== w) { console.log('    !! klopt niet'); mis++; }
    if (JSON.stringify(controle[blad][1] || {}) !== JSON.stringify(na[blad][1] || {})) { console.log('    !! koprij gewijzigd'); mis++; }
  }
  const bmw = Object.values(na['Verkochte Autos']).find(c => P(c[5]) === 'J699DX');
  const twingo = Object.values(na['Verkochte Autos']).find(c => P(c[5]) === 'KST45P');
  console.log('  BMW    -> factuur', bmw && bmw[3], '| datum', bmw && xlsx.datum(bmw[17]), '| prijs', bmw && bmw[20]);
  console.log('  Twingo -> factuur', twingo && twingo[3], '| datum', twingo && xlsx.datum(twingo[17]), '| prijs', twingo && twingo[20]);
  if (String(bmw[3]) !== '336' || String(twingo[3]) !== '333') { console.log('  !! factuurnummers niet goed gezet'); mis++; }
  for (const w of WEG) if (Object.values(na[w.blad]).some(c => P(c[5]) === w.kent && w.blad === 'Komende Autos')) { console.log('  !! ' + w.kent + ' staat nog op ' + w.blad); mis++; }
  if (mis) { console.log(`\n${mis} controle(s) mislukt — er is NIETS geüpload.`); process.exitCode = 1; return; }

  if (!ECHT) { console.log('\n>>> PROEFDRAAI — alles gecontroleerd, er is niets geüpload. Draai met --echt.'); return; }
  const nu = await drive.meta(tok, ID);
  if (nu.headRevisionId !== voor.headRevisionId) { console.log('\nhet werkboek is intussen gewijzigd — gestopt.'); process.exitCode = 1; return; }
  const uit = await drive.upload(tok, ID, nieuw);
  console.log('\ngeüpload, nieuwe revisie', uit.headRevisionId);
})();
