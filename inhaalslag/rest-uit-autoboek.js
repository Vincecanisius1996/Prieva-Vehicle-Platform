// Groep B en C: de twintig auto's waarvan de fase niet uit het Autoboek af te leiden was.
// De fase per rij is op 19-08-2026 door Vince opgegeven. Zonder --echt wordt er niets weggeschreven.
const pg = require('/opt/pvp-api/node_modules/pg');
const drive = require('/opt/pvp-api/autoboek/drive.js');
const { lees } = require('/opt/pvp-api/autoboek/xlsx-lees.js');
const { leeg, dag, merk, model, uitvoering, titel, BRAND, TRANS, norm } = require('./lopende-uit-autoboek.js');

// Wat er per rij is opgegeven. De sleutel is het rijnummer op "Lopende Autos".
const FASE = {
  17: 'papieren-compleet', 18: 'papieren-compleet', 19: 'papieren-compleet',
  21: 'papieren-compleet', 28: 'papieren-compleet',
  31: 'alleen-rdw-fotos',                       // "papieren ontbreken"
  32: 'rdw-importeren', 34: 'rdw-importeren', 37: 'rdw-importeren',
  39: 'rdw-importeren', 42: 'rdw-importeren', 43: 'rdw-importeren',
  44: 'verkoopklaar',
  47: 'rdw-goedkeuring',                        // "afwachting"
  66: 'bpm-verstuurd',
  2: 'verkoopklaar', 3: 'verkoopklaar', 4: 'papieren-compleet',
  12: 'verkoopklaar', 35: 'verkoopklaar',
};

// De stappenrij zoals index.html hem opbouwt. klaar = aantal afgeronde stappen, dus tegelijk de
// index van de stap die nu open staat.
const STAP = {
  JA: ["RDW Foto's", "Papieren Foto's", 'Papieren uploaden', 'S-TAX: auto klaar ter taxatie',
       'BPM-rapport geüpload door S-TAX', 'RDW Importeer', 'RDW Goedkeuring',
       'BPM-taxatierapport versturen', 'Wachten op BIN', 'BIN', 'Fotograaf', 'Mobilox Online'],
  NEE: ["RDW Foto's", "Papieren Foto's", 'RDW Importeer', 'RDW Goedkeuring', 'BPM-rapport maken',
        'Versturen', 'Wachten op BIN', 'BIN', 'Fotograaf', 'Mobilox Online'],
};

// Een omschrijving noemt óf de stap die nu open staat, óf een stap die net af is. Dat onderscheid
// staat hier expliciet, want het scheelt precies één.
function klaarUit(fase, route) {
  const rij = STAP[route];
  const open = naam => { const i = rij.indexOf(naam); if (i < 0) throw new Error(`stap "${naam}" bestaat niet in route ${route}`); return i; };
  const af   = naam => open(naam) + 1;
  switch (fase) {
    case 'alleen-rdw-fotos':  return af("RDW Foto's");
    case 'papieren-compleet': return af("Papieren Foto's");
    case 'rdw-importeren':    return open('RDW Importeer');
    case 'rdw-goedkeuring':   return open('RDW Goedkeuring');
    case 'bpm-verstuurd':     return af(route === 'JA' ? 'BPM-taxatierapport versturen' : 'Versturen');
    case 'verkoopklaar':      return rij.length;
    default: throw new Error('onbekende fase: ' + fase);
  }
}


const ECHT = process.argv.includes('--echt');

async function hoofd() {
  const tok = await drive.token('https://www.googleapis.com/auth/drive');
  const blad = lees(await drive.download(tok, process.env.AUTOBOEK_FILE_ID), 'Lopende Autos');
  const pool = new pg.Pool({ connectionString: process.env.PVP_PG });
  const { rows: er } = await pool.query('select id, coalesce(kenteken,$1) k from vehicles', ['']);
  const bekend = new Set(); er.forEach(r => { bekend.add(norm(r.id)); if (norm(r.k)) bekend.add(norm(r.k)); });
  const { rows: [{ max }] } = await pool.query('select coalesce(max(sort_order),-1) max from vehicles');

  const autos = [], overgeslagen = [];
  for (const nr of Object.keys(FASE).map(Number).sort((a, b) => a - b)) {
    const c = blad[nr];
    if (!c) { overgeslagen.push(`rij ${nr} bestaat niet`); continue; }
    const vin = leeg(c[4]);
    if (!vin) { overgeslagen.push(`rij ${nr} heeft geen VIN`); continue; }
    let kent = leeg(c[5]).toUpperCase();
    if (kent.includes('XXX')) kent = '';                       // plaatshouder, geen kenteken
    if (kent && !kent.includes('-')) { const g = kent.match(/[A-Z]+|[0-9]+/g) || []; if (g.length === 3) kent = g.join('-'); }
    if (bekend.has(norm(vin)) || (kent && bekend.has(norm(kent)))) { overgeslagen.push(`rij ${nr} staat al in PVP`); continue; }

    let brandstof = BRAND[String(leeg(c[11])).toUpperCase()] || null;
    let transm = TRANS[String(leeg(c[12])).toUpperCase()] || null;
    if (!brandstof && TRANS[String(leeg(c[11])).toUpperCase()]) {
      const b2 = BRAND[String(leeg(c[12])).toUpperCase()], t2 = TRANS[String(leeg(c[11])).toUpperCase()];
      if (b2 && t2) { brandstof = b2; transm = t2; }
    }
    const route = leeg(c[29]) !== '' ? 'JA' : 'NEE';
    autos.push({ rij: nr, fase: FASE[nr], route, klaar: klaarUit(FASE[nr], route),
      id: vin, kenteken: kent || '—', merk: merk(c[6]), model: model(c[7]), uitv: uitvoering(c[10]),
      kleur: titel(c[8]), brandstof, transm, reg: dag(c[13]),
      km: leeg(c[14]) ? Math.round(Number(c[14])) : null, inkoopdatum: dag(c[15]),
      lev: leeg(c[9]) === 'inruil' ? 'Inruil' : (leeg(c[9]) || null),
      inkoopprijs: leeg(c[19]) ? Number(c[19]) : null });
  }

  console.log('rij  fase                route  klaar  open stap                     auto');
  for (const a of autos) {
    const open = STAP[a.route][a.klaar] || '— Verkoopklaar';
    console.log(String(a.rij).padEnd(5) + a.fase.padEnd(20) + a.route.padEnd(7) + String(a.klaar).padEnd(7) +
      open.padEnd(30) + a.kenteken.padEnd(11) + a.merk + ' ' + a.model);
  }
  if (overgeslagen.length) console.log('\novergeslagen: ' + overgeslagen.join('; '));
  const gaten = autos.filter(a => !a.merk || !a.model || !a.km || !a.inkoopdatum || !a.brandstof || !a.transm);
  console.log('\nonvolledige velden: ' + (gaten.length ? gaten.map(a => 'rij ' + a.rij).join(', ') : 'geen'));
  const zonderKenteken = autos.filter(a => a.kenteken === '—');
  console.log('zonder kenteken   : ' + zonderKenteken.length + (zonderKenteken.length ? ' (rij ' + zonderKenteken.map(a => a.rij).join(', ') + ')' : ''));

  if (!ECHT) { console.log('\n>>> PROEFDRAAI — er is niets weggeschreven. Draai met --echt.'); await pool.end(); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = Number(max);
    for (const a of autos) {
      n++;
      await client.query(
        `insert into vehicles (id,vin,kenteken,merk,model,uitv,kleur,brandstof,transm,reg,km,
           inkoopdatum,lev,inkoopprijs,import_auto,note,sort_order,status,klaar,route,autoboek_status)
         values ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$15,'lopende',$16,$17,'ok')`,
        [a.id, a.kenteken, a.merk, a.model, a.uitv, a.kleur, a.brandstof, a.transm, a.reg, a.km,
         a.inkoopdatum, a.lev, a.inkoopprijs, 'Overgenomen uit het Autoboek (Lopende) op 19-08-2026, fase met de hand vastgesteld.', n, a.klaar, a.route]);
    }
    await client.query('COMMIT');
    console.log(`\n${autos.length} auto's toegevoegd, sorteervolgorde ${Number(max) + 1} t/m ${n}.`);
  } catch (e) { await client.query('ROLLBACK'); console.error('TERUGGEDRAAID:', e.message); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
}

if (require.main === module) hoofd().catch(e => { console.error('MISLUKT:', e.message); process.exit(1); });
module.exports = { FASE, STAP, klaarUit };
