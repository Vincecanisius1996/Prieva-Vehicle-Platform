// Eenmalig: global_todos en vehicles.subtasks samenvoegen in de tabel `taken`.
//
//   node inhaalslag/taken-samenvoegen.js            proefdraai — telt alleen, schrijft niets
//   node inhaalslag/taken-samenvoegen.js --echt     voert het uit
//
// Idempotent: `taken.herkomst` is UNIQUE, dus een tweede ronde voegt niets dubbel toe.
// De bronnen blijven staan. `global_todos` en `vehicles.subtasks` worden NIET geleegd — ze zijn
// bevroren als rollback, net als de JSON-bestanden na de Postgres-migratie. Pas als dit een tijd
// goed draait kunnen ze weg.
const pg = require('/opt/pvp-api/node_modules/pg');

const ECHT = process.argv.includes('--echt');
if (!process.env.PVP_PG) { console.error('PVP_PG ontbreekt.'); process.exit(1); }

(async () => {
  const pool = new pg.Pool({ connectionString: process.env.PVP_PG });
  const uit = { todos: 0, subtaken: 0, overgeslagen: 0, wees: 0 };

  const { rows: todos } = await pool.query('SELECT * FROM global_todos ORDER BY id');
  const { rows: autos } = await pool.query("SELECT id, subtasks FROM vehicles WHERE subtasks <> '[]'::jsonb");
  const bestaat = new Set((await pool.query('SELECT id FROM vehicles')).rows.map(r => r.id));

  const zet = async (herkomst, t) => {
    if (!ECHT) return true;
    const r = await pool.query(
      `INSERT INTO taken (tekst,vehicle_id,owner,klaar,aangemaakt_ts,aangemaakt_door,klaar_ts,klaar_door,herkomst)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (herkomst) DO NOTHING RETURNING id`,
      [t.tekst, t.vehicleId, t.owner, t.klaar, t.ts, t.door, t.klaarTs, t.klaarDoor, herkomst]);
    return r.rowCount > 0;
  };

  for (const t of todos) {
    const tekst = String(t.text || '').trim();
    if (!tekst) { uit.overgeslagen++; continue; }   // een taak zonder tekst is geen taak
    // Een koppeling naar een auto die niet meer bestaat wordt een losse taak: de tekst blijft, de
    // dode verwijzing gaat eraf. (Nu zijn dat er nul, maar het script moet er tegen kunnen.)
    let vid = t.vehicle_id || null;
    if (vid && !bestaat.has(vid)) { uit.wees++; vid = null; }
    if (await zet('gt:' + t.id, { tekst, vehicleId: vid, owner: t.owner || null, klaar: !!t.done,
      ts: t.created_at || null, door: null, klaarTs: t.done_at || null, klaarDoor: t.done_by || null })) uit.todos++;
  }

  for (const a of autos) {
    for (const s of (Array.isArray(a.subtasks) ? a.subtasks : [])) {
      const tekst = String((s && s.text) || '').trim();
      if (!tekst) { uit.overgeslagen++; continue; }
      if (await zet(`sub:${a.id}:${s.id}`, { tekst, vehicleId: a.id, owner: s.owner || null,
        klaar: !!s.done, ts: s.createdAt || null, door: null,
        klaarTs: s.doneAt || null, klaarDoor: s.doneBy || null })) uit.subtaken++;
    }
  }

  console.log((ECHT ? 'UITGEVOERD' : 'PROEFDRAAI (niets geschreven)') + ':');
  console.log(`  uit global_todos      : ${uit.todos}`);
  console.log(`  uit vehicles.subtasks : ${uit.subtaken}`);
  console.log(`  overgeslagen (leeg)   : ${uit.overgeslagen}`);
  console.log(`  dode auto-verwijzing  : ${uit.wees} (worden losse taken)`);
  if (ECHT) {
    const n = await pool.query('SELECT count(*)::int AS n, count(vehicle_id)::int AS met_auto FROM taken');
    console.log(`  in tabel taken nu     : ${n.rows[0].n}, waarvan ${n.rows[0].met_auto} aan een auto`);
  }
  await pool.end();
})().catch(e => { console.error('FOUT:', e.message); process.exit(1); });
