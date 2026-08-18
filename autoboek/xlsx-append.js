// Bewijs: kan puur Node één regel toevoegen aan het tabblad "Komende Autos" van een .xlsx,
// zonder de rest van het bestand aan te raken? Een xlsx is een zip met XML; zlib zit in Node,
// de zip-container doen we met de hand. Geen npm-pakket — dat is de regel in dit project.
const fs = require('fs');
const zlib = require('zlib');

/* ---------- zip lezen ---------- */
function leesZip(buf) {
  // Eind van de central directory zoeken (achteraan, evt. met commentaar erachter).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('geen zip (eocd niet gevonden)');
  const aantal = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < aantal; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('central directory kapot bij ' + n);
    const e = {
      versieMaker: buf.readUInt16LE(p + 4),
      versieNodig: buf.readUInt16LE(p + 6),
      vlaggen:     buf.readUInt16LE(p + 8),
      methode:     buf.readUInt16LE(p + 10),
      tijd:        buf.readUInt16LE(p + 12),
      datum:       buf.readUInt16LE(p + 14),
      crc:         buf.readUInt32LE(p + 16),
      gecomp:      buf.readUInt32LE(p + 20),
      ongecomp:    buf.readUInt32LE(p + 24),
      externAttr:  buf.readUInt32LE(p + 38),
      internAttr:  buf.readUInt16LE(p + 36),
    };
    const nLen = buf.readUInt16LE(p + 28), eLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    e.naam = buf.toString('utf8', p + 46, p + 46 + nLen);
    e.extra = buf.subarray(p + 46 + nLen, p + 46 + nLen + eLen);
    e.commentaar = buf.subarray(p + 46 + nLen + eLen, p + 46 + nLen + eLen + cLen);
    // ruwe (nog gecomprimeerde) data uit de local file header halen
    const lnLen = buf.readUInt16LE(offset + 26), leLen = buf.readUInt16LE(offset + 28);
    const start = offset + 30 + lnLen + leLen;
    e.ruw = buf.subarray(start, start + e.gecomp);
    entries.push(e);
    p += 46 + nLen + eLen + cLen;
  }
  return entries;
}

const uitpakken = e => e.methode === 0 ? e.ruw : zlib.inflateRawSync(e.ruw);

/* ---------- zip schrijven ---------- */
function schrijfZip(entries) {
  const delen = [], centraal = [];
  let offset = 0;
  for (const e of entries) {
    const naam = Buffer.from(e.naam, 'utf8');
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(e.versieNodig, 4); lfh.writeUInt16LE(e.vlaggen, 6);
    lfh.writeUInt16LE(e.methode, 8);     lfh.writeUInt16LE(e.tijd, 10);
    lfh.writeUInt16LE(e.datum, 12);      lfh.writeUInt32LE(e.crc, 14);
    lfh.writeUInt32LE(e.gecomp, 18);     lfh.writeUInt32LE(e.ongecomp, 22);
    lfh.writeUInt16LE(naam.length, 26);  lfh.writeUInt16LE(0, 28);   // extra weggelaten: mag
    delen.push(lfh, naam, e.ruw);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(e.versieMaker, 4);  cd.writeUInt16LE(e.versieNodig, 6);
    cd.writeUInt16LE(e.vlaggen, 8);      cd.writeUInt16LE(e.methode, 10);
    cd.writeUInt16LE(e.tijd, 12);        cd.writeUInt16LE(e.datum, 14);
    cd.writeUInt32LE(e.crc, 16);         cd.writeUInt32LE(e.gecomp, 20);
    cd.writeUInt32LE(e.ongecomp, 24);    cd.writeUInt16LE(naam.length, 28);
    cd.writeUInt16LE(0, 30);             cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);             cd.writeUInt16LE(e.internAttr, 36);
    cd.writeUInt32LE(e.externAttr, 38);  cd.writeUInt32LE(offset, 42);
    centraal.push(cd, naam);
    offset += 30 + naam.length + e.ruw.length;
  }
  const cdBuf = Buffer.concat(centraal);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...delen, cdBuf, eocd]);
}

function vervang(e, nieuweInhoud) {
  const ruw = zlib.deflateRawSync(nieuweInhoud, { level: 9 });
  e.ruw = ruw; e.methode = 8; e.gecomp = ruw.length; e.ongecomp = nieuweInhoud.length;
  e.crc = crc32(nieuweInhoud); e.vlaggen &= ~0x08;   // geen data descriptor
}

let TABEL = null;
function crc32(buf) {
  if (!TABEL) {
    TABEL = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TABEL[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABEL[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ---------- de eigenlijke bewerking ---------- */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Excel-serienummer; epoch 1899-12-30 vanwege de schrikkeljaarfout van 1900.
// Geeft null bij alles wat geen herkenbare datum is. Zonder die controle belandt er NaN in de cel —
// PVP gebruikt namelijk een kastlijntje voor "onbekend", en dat is geen datum.
const serie = iso => {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(String(iso || '').trim());
  if (!m) return null;
  const [d, mnd, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mnd < 1 || mnd > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(j, mnd - 1, d));
  // Terugrekenen: 31-02 zou anders stilletjes 2 maart worden. Liever geen datum dan een verkeerde.
  if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mnd - 1 || dt.getUTCFullYear() !== j) return null;
  const n = Math.round((dt - Date.UTC(1899, 11, 30)) / 86400000);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Merknotatie in het Autoboek: eerste letter hoofdletter, de rest klein (afspraak 17-08-2026).
// Per woord, zodat "land rover" -> "Land Rover" en niet "Land rover".
// De uitzonderingen zijn merken die als afkorting geschreven worden; zonder die lijst zou er "Bmw"
// en "Vw" in het boek komen te staan.
const MERK_AFKORTINGEN = ['BMW', 'VW', 'MG', 'DS', 'BYD', 'SEAT'];
function merkNotatie(s){
  s = String(s || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  // Ook na een koppelteken een hoofdletter, anders wordt het "Mercedes-benz".
  return s.split(' ').map(w => {
    const boven = w.toUpperCase();
    if (MERK_AFKORTINGEN.includes(boven)) return boven;
    return w.toLowerCase().replace(/(^|-)([a-zà-ÿ])/g, (_, v, l) => v + l.toUpperCase());
  }).join(' ');
}

// Kolomletter bij een index: 0=A … 25=Z, 26=AA. De Komende-tab gaat tot R, Verkochte tot AV.
function kolLetter(i){ let s='', n=i; while(n>=0){ s=String.fromCharCode(65+(n%26))+s; n=Math.floor(n/26)-1; } return s; }
const KOL = [...Array(18)].map((_,i)=>kolLetter(i));

// Van bladnaam naar het xml-bestand in de zip. Stond hard op sheet1.xml; dat werkt alleen voor
// "Komende Autos" en de verplaatsing raakt er nog twee.
function bladPad(entries, naam){
  const pak = n => { const e = entries.find(x => x.naam === n); return e ? uitpakken(e).toString('utf8') : null; };
  const wb = pak('xl/workbook.xml'), rels = pak('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('workbook.xml of de rels ontbreekt');
  const doelen = Object.fromEntries([...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]));
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g)) {
    if (m[1] !== naam) continue;
    let d = (doelen[m[2]] || '').replace(/^\//, '');
    if (!d.startsWith('xl/')) d = 'xl/' + d;
    return d;
  }
  throw new Error(`tabblad "${naam}" niet gevonden`);
}

// Rijen van een blad als {nr, heel, gevuld}. Een rij telt als gevuld zodra er een <v> of <is> in staat;
// een blad heeft honderden rijen die alleen opmaak dragen.
function rijenUit(xml){
  return [...xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>|<row r="(\d+)"[^>]*\/>/g)]
    .map(m => ({ nr: Number(m[1] || m[3]), heel: m[0], binnen: m[2] || '', gevuld: /<v>|<is>/.test(m[2] || '') }));
}

// De opmaak NIET hardcoderen. Excel hernummert bij elke keer opslaan zijn hele stijltabel; een vast
// nummer wijst daarna naar iets anders — datums worden kale getallen, kilometers krijgen een euroteken.
// Daarom lezen we per kolom het stijlnummer van de laatste gevulde regel en gebruiken we dat. De
// nieuwe regel ziet er dan per definitie uit als de regel erboven, wat er ook met de tabel gebeurt.
function stijlenUit(rijXml) {
  const uit = {};
  for (const c of rijXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)) {
    const s = /s="(\d+)"/.exec(c[2]);
    if (s) uit[c[1]] = s[1];
  }
  return uit;
}

function maakRij(nr, waarden, stijl) {
  const cellen = waarden.map((_, i) => {
    const letter = kolLetter(i);
    const w = waarden[i];
    const s = stijl[letter] !== undefined ? ` s="${stijl[letter]}"` : '';
    if (w === undefined || w === null || w === '') return `<c r="${letter}${nr}"${s}/>`;
    if (typeof w === 'object') return `<c r="${letter}${nr}"${s}><v>${w.v}</v></c>`;
    return `<c r="${letter}${nr}"${s} t="inlineStr"><is><t>${esc(w)}</t></is></c>`;
  });
  return `<row r="${nr}">${cellen.join('')}</row>`;
}

/* ---------- een rij verwijderen, mét renummering ----------
   Excel-gedrag: de rijen eronder schuiven één op. Dat betekent dat álles wat naar een rijnummer
   verwijst mee moet: de <row>-elementen zelf, de r= van elke cel daarin, en de bereiken buiten
   sheetData (samengevoegde cellen, voorwaardelijke opmaak, het autofilter). Wordt daar iets vergeten,
   dan staat de opmaak straks een regel verkeerd of weigert Excel het bestand.
   Alleen gebruiken op een blad waarvan je die verwijzingen hebt nagekeken. */
function verschuifBereik(ref, weg) {
  // "E39:F39", "C2:C10 C12", "$P$1:$P$723" — elk celadres apart bijstellen.
  return ref.replace(/(\$?[A-Z]+\$?)(\d+)/g, (heel, kol, nr) => {
    const n = Number(nr);
    return n > weg ? kol + (n - 1) : heel;
  });
}

function verwijderRij(xml, weg) {
  const i = xml.indexOf('<sheetData'), j = xml.indexOf('</sheetData>');
  if (i < 0 || j < 0) throw new Error('sheetData niet gevonden');
  const kop = xml.slice(0, i), data = xml.slice(i, j), staart = xml.slice(j);

  const rijen = rijenUit(data);
  const doel = rijen.find(r => r.nr === weg);
  if (!doel) throw new Error('rij ' + weg + ' bestaat niet');

  let nieuw = data.replace(doel.heel, '');
  // Rijen eronder één omhoog. Van hoog naar laag zou hier niet uitmaken (elk element wordt één keer
  // vervangen), maar we doen het per element om nooit een half aangepaste rij te krijgen.
  for (const r of rijen.filter(r => r.nr > weg).sort((a, b) => a.nr - b.nr)) {
    const op = r.heel
      .replace(/^<row r="\d+"/, `<row r="${r.nr - 1}"`)
      .replace(/<c r="([A-Z]+)\d+"/g, (_, kol) => `<c r="${kol}${r.nr - 1}"`);
    nieuw = nieuw.replace(r.heel, op);
  }

  // Buiten sheetData: bereiken die naar rijnummers wijzen.
  let staart2 = staart
    .replace(/<mergeCell ref="([^"]+)"\/>/g, (heel, ref) => {
      // Een samenvoeging die alléén de verwijderde rij besloeg, verdwijnt met die rij mee.
      const rijnrs = [...ref.matchAll(/[A-Z]+(\d+)/g)].map(m => Number(m[1]));
      if (rijnrs.every(n => n === weg)) return '';
      return `<mergeCell ref="${verschuifBereik(ref, weg)}"/>`;
    })
    .replace(/(<conditionalFormatting[^>]*sqref=")([^"]+)(")/g, (_, a, ref, b) => a + verschuifBereik(ref, weg) + b)
    .replace(/(<autoFilter[^>]*ref=")([^"]+)(")/g, (_, a, ref, b) => a + verschuifBereik(ref, weg) + b);

  // count van mergeCells bijwerken als er een verdween.
  const nu = (staart2.match(/<mergeCell /g) || []).length;
  staart2 = staart2.replace(/<mergeCells count="\d+">/, nu ? `<mergeCells count="${nu}">` : '<mergeCells count="0">');
  if (!nu) staart2 = staart2.replace(/<mergeCells count="0">\s*<\/mergeCells>/, '');

  return kop + nieuw + staart2;
}

function voegToe(pad, uitPad, auto) {
  const entries = leesZip(fs.readFileSync(pad));
  const pad2 = bladPad(entries, 'Komende Autos');
  const blad = entries.find(e => e.naam === pad2);
  if (!blad) throw new Error(pad2 + ' niet gevonden');
  let xml = uitpakken(blad).toString('utf8');

  // De eerstvolgende LEGE regel zoeken, niet de eerstvolgende ontbrekende. Een blad heeft meestal al
  // honderden <row>-elementen die alleen opmaak dragen en geen waarde; dat is precies de regel waar
  // een mens ook zou typen. Een rij telt als gevuld zodra er een <v> of een <is> in staat.
  const rijen = [...xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>|<row r="(\d+)"[^>]*\/>/g)]
    .map(m => ({ nr: Number(m[1] || m[3]), heel: m[0], gevuld: /<v>|<is>/.test(m[2] || '') }));
  const gevuld = rijen.filter(r => r.gevuld).map(r => r.nr);
  if (!gevuld.length) throw new Error('geen enkele gevulde rij gevonden — verkeerd blad?');
  const laatste = Math.max(...gevuld);
  const doelNr = laatste + 1;
  const bestaand = rijen.find(r => r.nr === doelNr);
  // Veiligheidsklep: er mag onder de laatste auto niets staan dat we zouden overschrijven.
  if (bestaand && bestaand.gevuld) throw new Error('rij ' + doelNr + ' is niet leeg — met de hand kijken');

  // Kolom A (F), B (TO-DO), D (Fact. Nr.) en Q (Datum verkoop) laat PVP bewust leeg — dat is handwerk
  // van kantoor (afspraak 17-08-2026). Ze bestaan wél in PVP, ze gaan alleen niet mee naar het boek.
  // Opmaak overnemen van de laatste gevulde regel — zie stijlenUit().
  const bron = rijen.find(r => r.nr === laatste);
  const stijl = stijlenUit(bron ? bron.heel : '');
  if (Object.keys(stijl).length < 10) throw new Error('kon de opmaak van rij ' + laatste + ' niet aflezen');

  const rij = maakRij(doelNr, [
    '', '', auto.transport, '', auto.vin, auto.kenteken, merkNotatie(auto.merk), auto.type,
    auto.kleur, auto.leverancier, auto.uitvoering, auto.brandstof, auto.transmissie,
    serie(auto.reg) ? { v: serie(auto.reg) } : '',
    auto.km != null ? { v: auto.km } : '',
    serie(auto.inkoopdatum) ? { v: serie(auto.inkoopdatum) } : '',
    serie(auto.verkoopdatum) ? { v: serie(auto.verkoopdatum) } : '',
    auto.inkoopprijs != null ? { v: auto.inkoopprijs } : '',
  ], stijl);

  if (bestaand) {
    // De lege regel bestaat al (met opmaak): die vervangen we, zodat de volgorde vanzelf klopt.
    xml = xml.replace(bestaand.heel, rij);
  } else {
    // Nog geen element voor deze regel: netjes vóór de eerstvolgende hogere rij invoegen.
    const hoger = rijen.map(r => r.nr).filter(n => n > doelNr).sort((a, b) => a - b)[0];
    if (hoger === undefined) xml = xml.replace('</sheetData>', rij + '</sheetData>');
    else { const pos = xml.indexOf(`<row r="${hoger}"`); xml = xml.slice(0, pos) + rij + xml.slice(pos); }
  }

  vervang(blad, Buffer.from(xml, 'utf8'));
  fs.writeFileSync(uitPad, schrijfZip(entries));
  return doelNr;
}

if (require.main === module) {
  const [bron, doel] = process.argv.slice(2);
  const nr = voegToe(bron, doel, {
    vin: 'TESTVIN00000PROEF', merk: 'Testmerk', type: 'Testmodel', kleur: 'Zwart',
    leverancier: 'TEST', uitvoering: '1.0 Proefuitvoering', brandstof: 'Benzine',
    transmissie: 'Handgeschakeld', reg: '20-05-2021', km: 80344,
    inkoopdatum: '17-08-2026', inkoopprijs: 7849, todo: 'PROEFREGEL — mag weg',
  });
  console.log('regel toegevoegd op rij', nr);
}
module.exports = { voegToe, verwijderRij, verschuifBereik, leesZip, uitpakken, schrijfZip, vervang, stijlenUit, maakRij, rijenUit, bladPad, kolLetter, serie, merkNotatie };
