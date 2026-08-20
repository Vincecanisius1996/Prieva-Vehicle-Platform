// Leest een BPM-taxatierapport (het aangifteformulier van de Belastingdienst met het taxatierapport
// als bijlage) en haalt er twee dingen uit: het VIN en de datum van de fysieke opname.
//
// Waarom geen AI: allebei staan op een vaste plek in een vast formulier. Tekstextractie is
// deterministisch, gratis en direct — en een model dat een chassisnummer moet overtypen maakt daar
// fouten in. Dat is deze week al een keer misgegaan met een kilometerstand.
//
// De pdf's zijn versleuteld met een leeg wachtwoord (alleen rechtenbeperking). pdftotext gaat daar
// gewoon doorheen; zelf de streams uitpakken lukt niet.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Een rapport is 29 dagen geldig na de fysieke opname (opgave Prieva, 19-08-2026: de verzenddagen
// zijn daar al vanaf getrokken). Op het formulier zelf staat "niet meer dan 1 maand voor de datum
// van goedkeuring door de RDW"; 29 dagen is de strengere praktijkregel die Prieva aanhoudt.
const GELDIG_DAGEN = 29;

function tekstUit(pad) {
  return new Promise(klaar => {
    // Alleen de eerste twintig pagina's: het VIN staat op pagina 1 en de opnamedatum in het
    // taxatieblok daarachter. De rest is bijlage en kost onnodig tijd bij een rapport van 38 pagina's.
    execFile('pdftotext', ['-layout', '-f', '1', '-l', '20', pad, '-'],
      { maxBuffer: 64 * 1024 * 1024, timeout: 30000 },
      (err, uit) => klaar(err ? null : String(uit)));
  });
}

function vinUit(tekst) {
  // Veld 1a: het VIN staat in losse hokjes, dus als losse tekens met spaties ertussen.
  const blok = /VIN\s*=\s*Chassis[^\n]*\n([\s\S]{0,300}?)\n\s*\n/i.exec(tekst);
  if (!blok) return null;
  const kandidaat = (blok[1].match(/(?:[0-9A-Z]\s+){10,}[0-9A-Z]/) || [])[0];
  if (!kandidaat) return null;
  const vin = kandidaat.replace(/\s+/g, '');
  return vin.length === 17 ? vin : null;      // een VIN is altijd 17 tekens
}

function opnameUit(tekst) {
  const m = /Datum fysieke opname van het motorrijtuig[^\n]*\n([^\n]*)/i.exec(tekst);
  if (!m) return null;
  const c = m[1].replace(/[^0-9]/g, '');
  if (c.length !== 8) return null;
  const d = Number(c.slice(0, 2)), mnd = Number(c.slice(2, 4)), j = Number(c.slice(4));
  if (d < 1 || d > 31 || mnd < 1 || mnd > 12 || j < 2000 || j > 2100) return null;
  return `${c.slice(0, 2)}-${c.slice(2, 4)}-${c.slice(4)}`;
}

/**
 * @param {Buffer} buf  het pdf-bestand
 * @returns {Promise<{vin:string|null, opname:string|null, taxateur:string|null, gelukt:boolean}>}
 */
async function lees(buf) {
  let map = null;
  try {
    map = fs.mkdtempSync(path.join(os.tmpdir(), 'pvp-bpm-'));
    const pad = path.join(map, 'in.pdf');
    fs.writeFileSync(pad, buf);
    const tekst = await tekstUit(pad);
    if (!tekst) return { vin: null, opname: null, taxateur: null, gelukt: false };
    const naam = (/Naam van degene die de taxatie heeft verricht\s+(.+?)\s*$/im.exec(tekst) || [])[1];
    return { vin: vinUit(tekst), opname: opnameUit(tekst),
             taxateur: naam ? naam.trim().slice(0, 80) : null, gelukt: true };
  } catch (e) {
    return { vin: null, opname: null, taxateur: null, gelukt: false };
  } finally {
    if (map) { try { fs.rmSync(map, { recursive: true, force: true }); } catch (e) {} }
  }
}

// Verloopmoment: begin van de dag, GELDIG_DAGEN na de opname. Bewust het begin en niet het einde —
// een teller die te veel tijd belooft is erger dan een die een halve dag tekortkomt, want een
// verlopen rapport betekent opnieuw taxeren.
function verlooptOp(opname) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(opname || ''));
  if (!m) return null;
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) + GELDIG_DAGEN * 86400000;
}

module.exports = { lees, verlooptOp, GELDIG_DAGEN };
