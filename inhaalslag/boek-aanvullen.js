// Lege cellen in het Autoboek aanvullen met wat PVP inmiddels weet. Alleen LEGE cellen: wat er staat
// is met de hand gezet, en dat overschrijven is geen aanvullen.
//
//   node inhaalslag/boek-aanvullen.js <id> [<id> …]          proefdraai
//   node inhaalslag/boek-aanvullen.js --echt <id> [<id> …]
const pg = require('/opt/pvp-api/node_modules/pg');
const drive = require('../autoboek/drive.js');
const xlsx = require('../autoboek/xlsx-lees.js');
const autoboek = require('../autoboek/index.js');

const ECHT = process.argv.includes('--echt');
const IDS = process.argv.slice(2).filter(a => a !== '--echt');
const ID = (process.env.AUTOBOEK_FILE_ID || '').trim();
const P = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const leeg = x => x === null || x === undefined || String(x).trim() === '' || String(x).trim() === '—';
// veld in PVP -> kolom in het boek (E t/m P staat op alle drie de bladen gelijk)
const KOL = { vin: 4, kenteken: 5, merk: 6, model: 7, kleur: 8, lev: 9, uitv: 10, brandstof: 11, transm: 12, reg: 13, km: 14, inkoopdatum: 15 };

(async () => {
  if (!IDS.length) { console.log('geef één of meer auto-ids mee'); process.exit(1); }
  const pool = new pg.Pool({ connectionString: process.env.PVP_PG });
  const tok = await drive.token('https://www.googleapis.com/auth/drive');
  const boek = xlsx.lees(await drive.download(tok, ID));
  const zoek = v => { for (const blad of ['Komende Autos', 'Lopende Autos', 'Verkochte Autos'])
      for (const n of Object.keys(boek[blad])) { const c = boek[blad][n];
        if ((P(v.vin) && P(c[4]) === P(v.vin)) || (P(v.kenteken) && P(c[5]) === P(v.kenteken))) return { blad, rij: Number(n), c }; }
    return null; };

  for (const id of IDS) {
    const { rows } = await pool.query('SELECT * FROM vehicles WHERE id=$1', [id]);
    if (!rows.length) { console.log(id, '-> niet in PVP'); continue; }
    const v = rows[0];
    const r = zoek(v);
    if (!r) { console.log(id, '-> niet in het Autoboek gevonden'); continue; }
    const vullen = {};
    for (const [veld, kol] of Object.entries(KOL))
      if (!leeg(v[veld]) && leeg(r.c[kol])) vullen[veld] = veld === 'km' ? Number(v[veld]) : v[veld];
    if (!Object.keys(vullen).length) { console.log(`${id} -> ${r.blad} rij ${r.rij}: niets leeg, niets te doen`); continue; }
    console.log(`${id} -> ${r.blad} rij ${r.rij}: ${Object.entries(vullen).map(([k, w]) => k + '=' + w).join(', ')}`);
    if (!ECHT) continue;
    try { const uit = await autoboek.wijzigAuto({ vin: v.vin, kenteken: v.kenteken }, vullen);
      console.log(`   geschreven: ${uit.blad} rij ${uit.rij}, kolommen ${uit.kolommen.join(', ')}`);
      await pool.query('UPDATE vehicles SET autoboek_status=$2, autoboek_rij=$3, autoboek_fout=NULL, autoboek_ts=$4 WHERE id=$1', [id, 'ok', uit.rij, Date.now()]);
    } catch (e) { console.log('   MISLUKT: ' + e.message); }
  }
  if (!ECHT) console.log('\n>>> PROEFDRAAI');
  await pool.end();
})();
