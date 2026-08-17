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
const serie = iso => { const [d, m, j] = iso.split('-').map(Number); return Math.round((Date.UTC(j, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };

// Opmaakverwijzingen overgenomen van de bestaande regels: tekst 48, datum 94, km 95, bedrag 99, leeg 43.
const STIJL = { leeg: 43, tekst: 48, datum: 94, km: 95, geld: 99 };
const KOL = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R'];

function maakRij(nr, waarden) {
  const cellen = KOL.map((letter, i) => {
    const w = waarden[i];
    if (w === undefined || w === null || w === '') return `<c r="${letter}${nr}" s="${STIJL.leeg}"/>`;
    if (typeof w === 'object') return `<c r="${letter}${nr}" s="${STIJL[w.soort]}"><v>${w.v}</v></c>`;
    return `<c r="${letter}${nr}" s="${STIJL.tekst}" t="inlineStr"><is><t>${esc(w)}</t></is></c>`;
  });
  return `<row r="${nr}">${cellen.join('')}</row>`;
}

function voegToe(pad, uitPad, auto) {
  const entries = leesZip(fs.readFileSync(pad));
  const blad = entries.find(e => e.naam === 'xl/worksheets/sheet1.xml');
  if (!blad) throw new Error('sheet1.xml niet gevonden');
  let xml = uitpakken(blad).toString('utf8');

  // Eerste vrije rijnummer bepalen: hoogste bestaande auto-rij + 1, en controleren dat die vrij is.
  const bestaande = new Set([...xml.matchAll(/<row r="(\d+)"/g)].map(m => Number(m[1])));
  let nr = 2; while (bestaande.has(nr)) nr++;
  if (nr > 16) throw new Error('geen vrije rij direct onder de gegevens (rij ' + nr + ') — met de hand kijken');

  const rij = maakRij(nr, [
    auto.f, auto.todo, auto.transport, auto.factuur, auto.vin, auto.kenteken, auto.merk, auto.type,
    auto.kleur, auto.leverancier, auto.uitvoering, auto.brandstof, auto.transmissie,
    auto.reg ? { soort: 'datum', v: serie(auto.reg) } : '',
    auto.km != null ? { soort: 'km', v: auto.km } : '',
    auto.inkoopdatum ? { soort: 'datum', v: serie(auto.inkoopdatum) } : '',
    auto.verkoopdatum ? { soort: 'datum', v: serie(auto.verkoopdatum) } : '',
    auto.inkoopprijs != null ? { soort: 'geld', v: auto.inkoopprijs } : '',
  ]);

  // Vóór de eerstvolgende hogere rij plaatsen, zodat de rijen op volgorde blijven staan.
  const volgende = xml.match(new RegExp(`<row r="(${[...bestaande].filter(r => r > nr).sort((a, b) => a - b)[0]})"`));
  if (!volgende) throw new Error('geen rij gevonden om vóór te plaatsen');
  const pos = xml.indexOf(volgende[0]);
  xml = xml.slice(0, pos) + rij + xml.slice(pos);

  vervang(blad, Buffer.from(xml, 'utf8'));
  fs.writeFileSync(uitPad, schrijfZip(entries));
  return nr;
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
module.exports = { voegToe, leesZip, uitpakken };
