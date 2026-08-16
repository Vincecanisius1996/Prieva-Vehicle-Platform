// PVP — eenmalige import: JSON-bestanden -> PostgreSQL. Herhaalbaar (idempotent).
//
// Gebruik:
//   set -a; . /var/pvp/pg.env; set +a
//   node import-json.js [pad-naar-index.html] --overschrijf
//
// LET OP: dit script is bedoeld voor de EENMALIGE migratie. Het vervangt de to-do's, het logboek
// en de BPM-rapporten in de database door wat er in de JSON-bestanden staat. Sinds de omschakeling
// zijn die JSON-bestanden bevroren; opnieuw draaien betekent dus dataverlies. Daarom is de vlag
// --overschrijf verplicht zodra de database al gevuld is.
//
// Omgeving:
//   PVP_PG    verbindings-DSN (verplicht)
//   PVP_DATA  map met de JSON-bestanden (standaard /var/pvp)
//
// De catalogus (de hardcoded lijst `V` uit index.html) gaat met ON CONFLICT DO NOTHING naar
// `vehicles`, zodat een herhaalde import de live status niet overschrijft.

const fs = require('fs');
const path = require('path');
const pg = require('pg');

pg.types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10))); // bigint -> number

process.stdout.on('error', () => {}); // niet klagen als de uitvoer door bv. `| head` wordt afgekapt

const DATA_DIR = process.env.PVP_DATA || '/var/pvp';
const INDEX_HTML = process.argv[2] || '/var/www/html/index.html';
const DSN = process.env.PVP_PG;
if (!DSN) { console.error('PVP_PG ontbreekt. Doe eerst: set -a; . /var/pvp/pg.env; set +a'); process.exit(1); }

function readJson(file, fb) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fb; } }

// De lijst V uit index.html halen (JS-objectliteral, dus via new Function).
function readCatalog(file) {
  let html;
  try { html = fs.readFileSync(file, 'utf8'); } catch (e) { console.error('Kan ' + file + ' niet lezen: ' + e.message); process.exit(1); }
  const s = html.indexOf('const V = [');
  const e = s < 0 ? -1 : html.indexOf('\n];', s);
  if (s < 0 || e < 0) { console.error('Kon de lijst V niet vinden in ' + file); process.exit(1); }
  const lit = html.slice(s + 'const V = '.length, e + 2);
  let V;
  try { V = new Function('return ' + lit)(); } catch (err) { console.error('V is niet te lezen: ' + err.message); process.exit(1); }
  if (!Array.isArray(V) || !V.length) { console.error('V is leeg.'); process.exit(1); }
  // Meld velden die we niet kennen, in plaats van ze stil te laten vallen.
  const known = new Set(['id','vin','kenteken','merk','model','uitv','kleur','brandstof','transm','reg','km','inkoopdatum','lev','importAuto','batch','note','status']);
  const unknown = new Set();
  V.forEach(v => Object.keys(v).forEach(k => { if (!known.has(k)) unknown.add(k); }));
  if (unknown.size) console.warn('LET OP — onbekende velden in V (niet geïmporteerd): ' + [...unknown].join(', '));
  return V;
}

(async () => {
  const client = new pg.Client({ connectionString: DSN });
  await client.connect();

  // Veiligheidsslot: is de database al in gebruik, dan alleen doorgaan met --overschrijf.
  if (!process.argv.includes('--overschrijf')) {
    const r = await client.query('SELECT (SELECT count(*) FROM global_todos) + (SELECT count(*) FROM activity_log) + (SELECT count(*) FROM bpm_reports) AS n');
    if (r.rows[0].n > 0) {
      console.error('De database bevat al gegevens (' + r.rows[0].n + ' rijen in global_todos/activity_log/bpm_reports).');
      console.error('Opnieuw importeren vervangt die door de inhoud van de JSON-bestanden — die zijn sinds de');
      console.error('omschakeling bevroren, dus dat is dataverlies. Weet je het zeker? Voeg --overschrijf toe.');
      await client.end();
      process.exit(1);
    }
  }

  const counts = {};
  try {
    await client.query('BEGIN');

    // 1) Catalogus uit index.html
    const V = readCatalog(INDEX_HTML);
    for (let i = 0; i < V.length; i++) {
      const v = V[i];
      await client.query(
        `INSERT INTO vehicles (id,vin,kenteken,merk,model,uitv,kleur,brandstof,transm,reg,km,inkoopdatum,lev,import_auto,batch,note,sort_order,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (id) DO NOTHING`,
        [v.id, v.vin || null, v.kenteken || null, v.merk || null, v.model || null, v.uitv || null,
         v.kleur || null, v.brandstof || null, v.transm || null, v.reg || null,
         (v.km === undefined || v.km === null || v.km === '') ? null : Number(v.km),
         v.inkoopdatum || null, v.lev || null, !!v.importAuto, v.batch || null, v.note || null,
         i, v.status || 'komende']);
    }
    counts['catalogus (V)'] = V.length;

    // 2) state.json -> status per voertuig + to-do's + logboek + tellers
    const st = readJson(path.join(DATA_DIR, 'state.json'), null);
    if (st) {
      const vs = st.vehicles || {};
      const ids = Object.keys(vs);
      for (const id of ids) {
        const v = vs[id] || {};
        await client.query(
          `INSERT INTO vehicles (id,status,klaar,route,owner,arrived_at,tax_at,photos,subtasks,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
           ON CONFLICT (id) DO UPDATE SET
             status=EXCLUDED.status, klaar=EXCLUDED.klaar, route=EXCLUDED.route, owner=EXCLUDED.owner,
             arrived_at=EXCLUDED.arrived_at, tax_at=EXCLUDED.tax_at,
             photos=EXCLUDED.photos, subtasks=EXCLUDED.subtasks, updated_at=now()`,
          [id, v.status || 'komende', Number(v.klaar) || 0, v.route || null, v.owner || null,
           v.arrivedAt || null, v.taxAt || null,
           JSON.stringify(v.photos || {}), JSON.stringify(Array.isArray(v.subtasks) ? v.subtasks : [])]);
      }
      counts['voertuigstatus (state.json)'] = ids.length;

      const todos = Array.isArray(st.globalTodos) ? st.globalTodos : [];
      await client.query('DELETE FROM global_todos');
      for (const t of todos) {
        await client.query(
          `INSERT INTO global_todos (id,text,owner,vehicle_id,done,created_at,done_at,done_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [t.id, t.text || null, t.owner || null, t.vehicleId || null, !!t.done,
           t.createdAt || null, t.doneAt || null, t.doneBy || null]);
      }
      counts['algemene to-do\'s'] = todos.length;

      const log = Array.isArray(st.activityLog) ? st.activityLog : [];
      await client.query('DELETE FROM activity_log');
      for (const a of log) {
        await client.query(
          `INSERT INTO activity_log (ts,by_name,action,text,vehicle_id) VALUES ($1,$2,$3,$4,$5)`,
          [a.ts || null, a.by || null, a.action || null, a.text || '', a.vehicleId || null]);
      }
      counts['logboekregels'] = log.length;

      for (const [k, val] of [['subUid', st.subUid], ['gtUid', st.gtUid]]) {
        if (typeof val === 'number') {
          await client.query(`INSERT INTO meta (key,value) VALUES ($1,$2)
                              ON CONFLICT (key) DO UPDATE SET value=GREATEST(meta.value, EXCLUDED.value)`, [k, val]);
        }
      }
    } else {
      console.warn('Geen state.json gevonden in ' + DATA_DIR + ' — status overgeslagen.');
    }

    // 3) adphotos.json -> vehicles.ad_photos
    const ad = readJson(path.join(DATA_DIR, 'adphotos.json'), {});
    let adIds = 0, adFotos = 0;
    for (const id of Object.keys(ad)) {
      const arr = Array.isArray(ad[id]) ? ad[id] : [];
      await client.query(
        `INSERT INTO vehicles (id, ad_photos) VALUES ($1,$2::jsonb)
         ON CONFLICT (id) DO UPDATE SET ad_photos=EXCLUDED.ad_photos, updated_at=now()`,
        [id, JSON.stringify(arr)]);
      adIds++; adFotos += arr.length;
    }
    counts['advertentiefoto\'s'] = adIds + ' auto\'s / ' + adFotos + ' foto\'s';

    // 4) reports.json -> bpm_reports + bpm_notifs
    const rp = readJson(path.join(DATA_DIR, 'reports.json'), { vehicles: {}, notifs: [] });
    await client.query('DELETE FROM bpm_reports');
    let nrep = 0;
    for (const id of Object.keys(rp.vehicles || {})) {
      for (const r of (Array.isArray(rp.vehicles[id]) ? rp.vehicles[id] : [])) {
        await client.query(
          `INSERT INTO bpm_reports (vehicle_id,url,name,ts,by_name) VALUES ($1,$2,$3,$4,$5)`,
          [id, r.url, r.name || null, r.ts || null, r.by || null]);
        nrep++;
      }
    }
    counts['BPM-rapporten'] = nrep;

    await client.query('DELETE FROM bpm_notifs');
    const notifs = Array.isArray(rp.notifs) ? rp.notifs : [];
    for (const n of notifs) {
      await client.query(
        `INSERT INTO bpm_notifs (vehicle_id,name,ts,by_name,seen) VALUES ($1,$2,$3,$4,$5)`,
        [n.id || null, n.name || null, n.ts || null, n.by || null, !!n.seen]);
    }
    counts['BPM-meldingen'] = notifs.length;

    // 5) users.json -> users
    const users = readJson(path.join(DATA_DIR, 'users.json'), []);
    for (const u of (Array.isArray(users) ? users : [])) {
      await client.query(
        `INSERT INTO users (username,role,salt,hash,name) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (username) DO UPDATE SET role=EXCLUDED.role, salt=EXCLUDED.salt, hash=EXCLUDED.hash, name=EXCLUDED.name`,
        [String(u.username || '').toLowerCase(), u.role, u.salt, u.hash, u.name || null]);
    }
    counts['accounts'] = (users || []).length;

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Import MISLUKT (niets gewijzigd): ' + e.message);
    await client.end();
    process.exit(1);
  }

  console.log('Import gelukt. Aantallen uit de JSON-bestanden:');
  for (const k of Object.keys(counts)) console.log('  ' + k.padEnd(30) + counts[k]);

  const tables = ['vehicles', 'global_todos', 'activity_log', 'bpm_reports', 'bpm_notifs', 'users', 'meta'];
  console.log('Rijen in de database:');
  for (const t of tables) {
    const r = await client.query('SELECT count(*)::int AS n FROM ' + t);
    console.log('  ' + t.padEnd(30) + r.rows[0].n);
  }
  const m = await client.query('SELECT key, value FROM meta ORDER BY key');
  console.log('  meta: ' + m.rows.map(r => r.key + '=' + r.value).join(', '));
  await client.end();
})();
