// De vijf auto's uit de bedrijfsvoorraad staan nu op Komende. Ze zijn al van ons, dus horen ze op
// Lopende — in PVP én in het Autoboek. Dit doet dezelfde stap als het vinkje "binnen" in de app.
const pg = require('/opt/pvp-api/node_modules/pg');
const autoboek = require('../autoboek/index.js');
const ECHT = process.argv.includes('--echt');
const KENTEKENS = ['KV-115-L', '9-ZPF-87', 'V-78-RDJ', '93-XXX-1', '90-GXX-1'];
const pool = new pg.Pool({ connectionString: process.env.PVP_PG });

(async () => {
  if (!autoboek.aan()) { console.log('Autoboek-koppeling staat uit (AUTOBOEK_FILE_ID)'); process.exit(1); }
  for (const k of KENTEKENS) {
    const { rows } = await pool.query('SELECT id,vin,kenteken,merk,model,status FROM vehicles WHERE kenteken=$1', [k]);
    if (!rows.length) { console.log(k, '-> niet in PVP'); continue; }
    const v = rows[0];
    if (v.status !== 'komende') { console.log(k, '-> staat al op', v.status, '— overgeslagen'); continue; }
    if (!ECHT) { console.log(`${k} -> zou naar lopende gaan (${v.merk} ${v.model})`); continue; }
    try {
      const uit = await autoboek.verplaatsBinnengekomen({ vin: v.vin, kenteken: v.kenteken });
      await pool.query(`UPDATE vehicles SET status='lopende', arrived_at=$2, autoboek_status='ok',
                          autoboek_rij=$3, autoboek_fout=NULL, autoboek_ts=$2, updated_at=now() WHERE id=$1`,
        [v.id, Date.now(), uit.rij]);
      console.log(`${k} -> lopende | Autoboek: Lopende Autos rij ${uit.rij}`);
    } catch (e) {
      await pool.query('UPDATE vehicles SET autoboek_status=$2, autoboek_fout=$3, autoboek_ts=$4 WHERE id=$1',
        [v.id, 'fout', String(e.message).slice(0, 400), Date.now()]);
      console.log(`${k} -> MISLUKT: ${e.message}`);
    }
  }
  if (!ECHT) console.log('\n>>> PROEFDRAAI');
  await pool.end();
})();
