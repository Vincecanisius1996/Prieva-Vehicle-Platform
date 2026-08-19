// Eenmalige inhaalslag: auto's van het tabblad "Lopende Autos" overnemen in PVP.
// Bewust NIET via /api/vehicle: dat schrijft elke nieuwe auto naar het Autoboek, en staatErAl()
// kijkt daarbij alleen op "Komende Autos". Deze auto's staan op Lopende, worden dus niet herkend,
// en zouden er als dubbele regel op Komende bij komen. Daarom rechtstreeks de database in.
// Zonder --echt wordt er niets weggeschreven.
const drive = require('/opt/pvp-api/autoboek/drive.js');
const { lees } = require('/opt/pvp-api/autoboek/xlsx-lees.js');
const pg = require('/opt/pvp-api/node_modules/pg');
const fs = require('fs');

const ECHT = process.argv.includes('--echt');
const SCOPE = 'https://www.googleapis.com/auth/drive';
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const leeg = s => { const t = String(s == null ? '' : s).trim(); return (t === '' || t === '-' || t === '—') ? '' : t; };
const dag = n => { const d = new Date(Date.UTC(1899, 11, 30) + Number(n) * 86400000);
  return isNaN(d) ? null : `${String(d.getUTCDate()).padStart(2,'0')}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${d.getUTCFullYear()}`; };

// Het Autoboek schrijft in afkortingen en wisselende hoofdletters; PVP kent één schrijfwijze per
// waarde. Zonder dit worden 'VW', 'opel' en 'Citroen' drie merken die in geen enkel overzicht
// bij elkaar optellen.
// Eén bron voor merknamen: autoboek/merken.js. Zelf een tabelletje bijhouden liep meteen mis —
// 'Alfa Romeo' werd 'Alfa romeo' omdat alles na de eerste letter naar kleine letters ging.
const { volledigMerk } = require('/opt/pvp-api/autoboek/merken.js');
// merken.js geeft de schrijfwijze van het Autoboek terug; PVP houdt op zijn eigen scherm de
// correcte Nederlandse spelling aan. Alleen daar waar die twee verschillen staat hier een uitzondering.
const PVP_SPELLING = { Citroen: 'Citroën' };
const merk = s => { const t = leeg(s); if (!t) return null;
  const v = volledigMerk(t) || t.charAt(0).toUpperCase() + t.slice(1);
  return PVP_SPELLING[v] || v; };
const BRAND = { BENZ:'Benzine', BENZINE:'Benzine', ELEC:'Elektrisch', ELEKTRISCH:'Elektrisch',
  PHEV:'PHEV', DIESEL:'Diesel', HYBRIDE:'Hybride' };
const TRANS = { AUT:'Automaat', AUTOMAAT:'Automaat', HAND:'Handgeschakeld', 'HAND.':'Handgeschakeld',
  HANDGESCHAKELD:'Handgeschakeld' };
// Excel levert een cel met alleen cijfers terug als getal, dus '208' komt binnen als '208.0'.
// En modellen staan door elkaar met kleine en grote letters. 'e-Niro' en 'e-Corsa' blijven zoals
// ze zijn: die kleine letter hoort erbij.
function model(s) {
  let t = leeg(s); if (!t) return null;
  if (/^\d+\.0$/.test(t)) t = t.slice(0, -2);
  if (/^[a-z]-/.test(t)) return t;
  return t.replace(/(^|[\s-])([a-z])/g, (_, v, l) => v + l.toUpperCase());
}
const uitvoering = s => { const t = leeg(s); if (!t) return null; return /^\d+\.0$/.test(t) ? t.slice(0, -2) : t; };
const titel = s => { const t = leeg(s); return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : null; };

async function hoofd() {
  const tok = await drive.token(SCOPE);
  const boek = lees(await drive.download(tok, process.env.AUTOBOEK_FILE_ID));
  const blad = boek['Lopende Autos'];
  const pool = new pg.Pool({ connectionString: process.env.PVP_PG });
  const { rows: bestaand } = await pool.query('select id, coalesce(kenteken,$1) k from vehicles', ['']);
  const bekend = new Set(); bestaand.forEach(r => { bekend.add(norm(r.id)); if (norm(r.k)) bekend.add(norm(r.k)); });
  const { rows: [{ max }] } = await pool.query('select coalesce(max(sort_order),-1) max from vehicles');

  const A = [], B = [], C = [], vreemd = [];
  for (const nr of Object.keys(blad).map(Number).sort((a, b) => a - b)) {
    if (nr < 2) continue;
    const c = blad[nr]; const vin = leeg(c[4]); if (!vin) continue;
    // Het boek schrijft kentekens door elkaar: kleine letters, met en zonder streepjes, en
    // één plaatshouder ('93-XXX-1'). PVP houdt hoofdletters mét streepjes aan. Een plaatshouder
    // is géén kenteken en bewijst dus niets over RDW-goedkeuring — die auto hoort in groep B.
    let kent = leeg(c[5]).toUpperCase();
    if (kent.includes('XXX')) { vreemd.push({ nr, wat: `kenteken "${kent}" is een plaatshouder — als "geen kenteken" behandeld` }); kent = ''; }
    if (kent && !kent.includes('-')) {
      const groepen = kent.match(/[A-Z]+|[0-9]+/g) || [];
      if (groepen.length === 3) { const heel = groepen.join('-'); vreemd.push({ nr, wat: `kenteken ${kent} geschreven als ${heel}` }); kent = heel; }
    }
    if (bekend.has(norm(vin)) || (kent && bekend.has(norm(kent)))) continue;

    let brandstof = BRAND[String(leeg(c[11])).toUpperCase()] || null;
    let transm    = TRANS[String(leeg(c[12])).toUpperCase()] || null;
    // Eén rij heeft de twee kolommen verwisseld staan ('Aut' als brandstof, 'Elec' als transmissie).
    // In PVP zetten we het goed; het Autoboek zelf raken we niet aan.
    if (!brandstof && TRANS[String(leeg(c[11])).toUpperCase()]) {
      const b2 = BRAND[String(leeg(c[12])).toUpperCase()], t2 = TRANS[String(leeg(c[11])).toUpperCase()];
      if (b2 && t2) { brandstof = b2; transm = t2; vreemd.push({ nr, wat: 'brandstof en transmissie stonden verwisseld' }); }
    }
    const taxatie = leeg(c[29]) !== '';
    const inkoop = dag(c[15]);
    const auto = {
      rij: nr, id: vin, vin, kenteken: kent || '—',
      merk: merk(c[6]), model: model(c[7]), uitv: uitvoering(c[10]),
      kleur: titel(c[8]), brandstof, transm,
      reg: dag(c[13]), km: leeg(c[14]) ? Math.round(Number(c[14])) : null,
      inkoopdatum: inkoop, lev: leeg(c[9]) === 'inruil' ? 'Inruil' : (leeg(c[9]) || null),
      inkoopprijs: leeg(c[19]) ? Number(c[19]) : null,
      route: taxatie ? 'JA' : 'NEE',
      klaar: taxatie ? 10 : 8,           // t/m BIN; Fotograaf en Mobilox Online blijven open
      aant: [leeg(c[0]), leeg(c[1])].filter(Boolean).join(' | '),
    };
    const oud = inkoop && Number(inkoop.slice(6)) * 100 + Number(inkoop.slice(3, 5)) < 202604;
    if (oud) C.push(auto); else if (kent) A.push(auto); else B.push(auto);
  }

  console.log(`groep A (mét kenteken, vanaf april): ${A.length}`);
  console.log(`groep B (zonder kenteken)          : ${B.length}`);
  console.log(`groep C (ouder dan april)          : ${C.length}`);
  if (vreemd.length) console.log('\nrechtgezet:', vreemd.map(v => `rij ${v.nr}: ${v.wat}`).join('; '));

  console.log('\n— groep A, zo komen ze in PVP —');
  console.log('rij  route klaar  kenteken    merk         model        brandstof   transm         km      inkoop');
  for (const a of A) console.log(
    String(a.rij).padEnd(5) + String(a.route).padEnd(6) + String(a.klaar).padEnd(7) +
    String(a.kenteken).padEnd(12) + String(a.merk).padEnd(13) + String(a.model).slice(0,12).padEnd(13) +
    String(a.brandstof).padEnd(12) + String(a.transm).padEnd(15) + String(a.km).padEnd(8) + a.inkoopdatum);

  const ontbreekt = A.filter(a => !a.merk || !a.model || !a.brandstof || !a.transm || !a.km || !a.inkoopdatum);
  console.log('\nonvolledig in groep A:', ontbreekt.length ? ontbreekt.map(a => 'rij ' + a.rij).join(', ') : 'geen');

  fs.writeFileSync(__dirname + '/groepen-bc.json', JSON.stringify({ B, C }, null, 1));

  if (!ECHT) { console.log('\n>>> PROEFDRAAI — er is niets weggeschreven. Draai met --echt om te importeren.'); await pool.end(); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = Number(max);
    for (const a of A) {
      n++;
      await client.query(
        `insert into vehicles (id,vin,kenteken,merk,model,uitv,kleur,brandstof,transm,reg,km,
           inkoopdatum,lev,inkoopprijs,import_auto,note,sort_order,status,klaar,route,autoboek_status)
         values ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$15,'lopende',$16,$17,'ok')`,
        [a.id, a.kenteken, a.merk, a.model, a.uitv, a.kleur, a.brandstof, a.transm, a.reg, a.km,
         a.inkoopdatum, a.lev, a.inkoopprijs, 'Overgenomen uit het Autoboek (Lopende) op 19-08-2026.', n, a.klaar, a.route]);
    }
    await client.query('COMMIT');
    console.log(`\n${A.length} auto's toegevoegd, sorteervolgorde ${Number(max)+1} t/m ${n}.`);
  } catch (e) { await client.query('ROLLBACK'); console.error('TERUGGEDRAAID:', e.message); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
}

// Alleen draaien als het script zelf wordt aangeroepen; bij require() zijn we uit op de
// vertaalfuncties hieronder. Zonder deze grens haalt een require() het hele Autoboek op.
if (require.main === module) hoofd().catch(e => { console.error('MISLUKT:', e.message); process.exit(1); });

module.exports = { leeg, dag, merk, model, uitvoering, titel, BRAND, TRANS, norm };
