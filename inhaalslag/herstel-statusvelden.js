// Eenmalig herstel na de overschrijving van 20-08-2026 12:32. Zet per auto alleen de statusvelden
// terug uit een pg_dump: klaar, route, owner, photos, subtasks, arrived_at, tax_at.
//
// Bewust GEEN volledige terugzetting van de tabel: dan verlies je wat er na de back-up echt is
// gebeurd (een auto binnengemeld, een auto verwijderd, losse to-do's toegevoegd). De catalogus,
// de status en de verkoopvelden blijven dus zoals ze nu zijn.
// Zonder --echt wordt er niets geschreven.
const fs = require('fs');
const pg = require('/opt/pvp-api/node_modules/pg');

const ECHT = process.argv.includes('--echt');
const DUMP = process.argv[2];
const VELDEN = ['klaar', 'route', 'owner', 'photos', 'subtasks', 'arrived_at', 'tax_at'];

// COPY-tekstformaat: \N is NULL, en \\ \t \n \r zijn ontsnapt.
function ontsnap(w) {
  if (w === '\\N') return null;
  return w.replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v' }[c] || c));
}

function uitDump(pad) {
  const s = fs.readFileSync(pad, 'utf8');
  const m = /COPY public\.vehicles \(([^)]*)\) FROM stdin;\n([\s\S]*?)\n\\\.\n/.exec(s);
  if (!m) throw new Error('geen vehicles-blok in de dump gevonden');
  const kol = m[1].split(',').map(k => k.trim());
  return m[2].split('\n').filter(Boolean).map(regel => {
    const w = regel.split('\t').map(ontsnap);
    return Object.fromEntries(kol.map((k, i) => [k, w[i]]));
  });
}

(async () => {
  if (!DUMP) throw new Error('gebruik: node herstel-statusvelden.js <dump.sql> [--echt]');
  const back = uitDump(DUMP);
  console.log(back.length, 'auto\'s in de back-up\n');
  const pool = new pg.Pool({ connectionString: process.env.PVP_PG });
  const { rows: nu } = await pool.query(
    'SELECT id, merk, model, status, klaar, route, owner, photos::text AS photos, subtasks::text AS subtasks, arrived_at, tax_at FROM vehicles');
  const perId = Object.fromEntries(nu.map(r => [r.id, r]));

  const wijzig = [], catalogusVerschil = [], nietMeer = [];
  for (const b of back) {
    const n = perId[b.id];
    if (!n) { nietMeer.push(b.id + '  ' + b.merk + ' ' + b.model); continue; }
    if (String(n.merk) !== String(b.merk) || String(n.model) !== String(b.model)) catalogusVerschil.push(b.id);
    const anders = VELDEN.filter(v => {
      const oud = b[v] === null ? null : String(b[v]);
      const huidig = n[v] === null || n[v] === undefined ? null : String(n[v]);
      return oud !== huidig;
    });
    if (anders.length) wijzig.push({ b, n, anders });
  }

  console.log('auto\'s met af te wijken statusvelden:', wijzig.length);
  console.log('auto\'s uit de back-up die nu niet meer bestaan:', nietMeer.length, nietMeer.length ? '→ ' + nietMeer.join(', ') : '');
  console.log('auto\'s waarvan merk/model verschilt (moet 0 zijn):', catalogusVerschil.length);
  if (catalogusVerschil.length) { console.error('AFGEBROKEN: de back-up hoort niet bij deze database'); process.exit(1); }

  const tel = {};
  for (const w of wijzig) for (const v of w.anders) tel[v] = (tel[v] || 0) + 1;
  console.log('\nper veld te herstellen:');
  for (const [v, n] of Object.entries(tel).sort((a, b) => b[1] - a[1])) console.log('   ' + v.padEnd(12) + n);
  console.log('\nvoorbeeld (eerste vijf):');
  for (const w of wijzig.slice(0, 5))
    console.log('   ' + (w.b.merk + ' ' + w.b.model).padEnd(24) +
      'klaar ' + w.n.klaar + '→' + w.b.klaar + '   route ' + w.n.route + '→' + w.b.route);

  if (!ECHT) { console.log('\n>>> PROEFDRAAI — er is niets geschreven. Draai met --echt.'); await pool.end(); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const w of wijzig) {
      await client.query(
        `UPDATE vehicles SET klaar=$2, route=$3, owner=$4, photos=$5::jsonb, subtasks=$6::jsonb,
                             arrived_at=$7, tax_at=$8, updated_at=now() WHERE id=$1`,
        [w.b.id, Number(w.b.klaar || 0), w.b.route, w.b.owner, w.b.photos || '{}', w.b.subtasks || '[]',
         w.b.arrived_at === null ? null : Number(w.b.arrived_at),
         w.b.tax_at === null ? null : Number(w.b.tax_at)]);
    }
    await client.query('COMMIT');
    console.log('\n' + wijzig.length + ' auto\'s hersteld.');
  } catch (e) { await client.query('ROLLBACK'); console.error('TERUGGEDRAAID:', e.message); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})().catch(e => { console.error('MISLUKT:', e.message); process.exit(1); });
