// Eenmalig: de opnamedatum alsnog uit de al geüploade taxatierapporten lezen en vastleggen, zodat
// de geldigheidsteller ook voor bestaande rapporten klopt. Zonder --echt wordt er niets geschreven.
const pg = require('/opt/pvp-api/node_modules/pg');
const fs = require('fs');
const bpmlezen = require('/opt/pvp-api/bpmlezen');
const ECHT = process.argv.includes('--echt');

(async () => {
  const pool = new pg.Pool({ connectionString: process.env.PVP_PG });
  const { rows } = await pool.query('SELECT id, vehicle_id, url, name FROM bpm_reports WHERE opname_datum IS NULL ORDER BY id');
  console.log(rows.length, 'rapporten zonder opnamedatum\n');
  let goed = 0, mis = 0;
  for (const r of rows) {
    const pad = '/var/pvp/uploads/' + r.url.replace(/^\/uploads\//, '');
    if (!fs.existsSync(pad)) { console.log('  bestand weg:', r.url); mis++; continue; }
    const g = await bpmlezen.lees(fs.readFileSync(pad));
    const past = g.vin && g.vin.toUpperCase() === String(r.vehicle_id).toUpperCase();
    console.log('  ' + String(r.vehicle_id).padEnd(20) + 'opname=' + String(g.opname || '—').padEnd(12) +
      'VIN in rapport ' + (past ? 'klopt' : 'WIJKT AF (' + g.vin + ')') + (g.taxateur ? '  ' + g.taxateur : ''));
    if (!g.opname) { mis++; continue; }
    goed++;
    if (ECHT) await pool.query('UPDATE bpm_reports SET opname_datum=$2, taxateur=$3 WHERE id=$1', [r.id, g.opname, g.taxateur]);
  }
  console.log(`\n${goed} gelezen, ${mis} niet.` + (ECHT ? ' Database bijgewerkt.' : ' PROEFDRAAI — draai met --echt.'));
  await pool.end();
})().catch(e => { console.error('MISLUKT:', e.message); process.exit(1); });
