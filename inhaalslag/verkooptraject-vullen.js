// Eenmalig: het verkooppad vullen voor auto's die al gefotografeerd en online zijn.
//
//   node inhaalslag/verkooptraject-vullen.js            proefdraai
//   node inhaalslag/verkooptraject-vullen.js --echt     voert het uit
//
// Waarom niet uit `vehicles.klaar`: onder het oude model KÓN niemand de stap Fotograaf afvinken
// zolang het importtraject liep, dus dat een auto er niet aan toe was zegt niets over of hij al
// gefotografeerd is. De foto's staan bovendien in Mobilox, niet in PVP.
//
// Het bruikbare signaal is `vehicles.mobilox_online`, dat de agent elk kwartier bijwerkt: staat de
// advertentie online, dan is er gefotografeerd én online gezet. De rest begint leeg en wordt met de
// hand afgevinkt — dat waren er bij de invoering negen, waarvan Prieva er vier echt nog moest doen.
//
// Idempotent: ON CONFLICT DO NOTHING op vehicle_id, dus twee keer draaien voegt niets dubbel toe.
const pg = require('/opt/pvp-api/node_modules/pg');
const ECHT = process.argv.includes('--echt');

(async () => {
  if (!process.env.PVP_PG) { console.error('PVP_PG ontbreekt.'); process.exit(1); }
  const pool = new pg.Pool({ connectionString: process.env.PVP_PG });
  const { rows } = await pool.query(
    `SELECT id, merk, model, kenteken, status, mobilox_online, mobilox_ts
       FROM vehicles WHERE status IN ('lopende','gemeld verkocht','verkocht') ORDER BY id`);
  const online = rows.filter(r => r.mobilox_online === true);
  const open = rows.filter(r => r.mobilox_online !== true && r.status !== 'verkocht');
  console.log((ECHT ? 'UITGEVOERD' : 'PROEFDRAAI (niets geschreven)') + ':');
  console.log(`  auto's bekeken                  : ${rows.length}`);
  console.log(`  staat online -> beide stappen af: ${online.length}`);
  console.log(`  nog open (handmatig afvinken)   : ${open.length}`);
  for (const r of open) console.log(`      ${(r.merk + ' ' + r.model).slice(0, 32).padEnd(32)} ${String(r.kenteken || r.id).padEnd(19)} ${r.status}`);
  if (ECHT) {
    let n = 0;
    for (const r of online) {
      /* Het moment is niet te achterhalen; we nemen wanneer de agent de advertentie voor het laatst
         zag. Ontbreekt ook dat, dan het moment van de migratie zelf — NIET null: een rij met een
         leeg moment telt als "stap nog niet gedaan", en dan zet de migratie de auto's die juist al
         klaar zijn alsnog op de fotolijst. Een ruwe datum is hier beter dan geen. */
      const ts = r.mobilox_ts || Date.now();
      const res = await pool.query(
        `INSERT INTO verkooptraject (vehicle_id, foto_ts, foto_door, online_ts, online_door)
         VALUES ($1,$2,'overgezet bij de splitsing',$3,'overgezet bij de splitsing')
         ON CONFLICT (vehicle_id) DO NOTHING`, [r.id, ts, ts]);
      n += res.rowCount;
    }
    console.log(`  rijen aangemaakt                : ${n}`);
  }
  await pool.end();
})().catch(e => { console.error('FOUT:', e.message); process.exit(1); });
