// PVP backend — opslag in PostgreSQL (database `pvp`). Enige externe afhankelijkheid: `pg`.
// De API-antwoorden zijn identiek aan de vorige JSON-versie; de frontend is ongewijzigd.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pg = require('pg');

pg.types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10))); // bigint -> number i.p.v. string

// Koppeling met het Autoboek. Ontbreekt de map of gaat het laden mis, dan draait PVP gewoon door
// zonder die koppeling — een auto toevoegen mag nooit stukgaan omdat Google onbereikbaar is.
let autoboek = null;
try { autoboek = require('./autoboek'); } catch (e) { console.error('autoboek-koppeling niet geladen:', e.message); }
// Inkoopstukken uitlezen. Zelfde gedachte: ontbreekt het of staat de sleutel er niet, dan werkt de
// app gewoon door en vult de gebruiker het formulier met de hand.
let uitlezen = null;
try { uitlezen = require('./uitlezen'); } catch (e) { console.error('uitlezen niet geladen:', e.message); }

const DATA_DIR = process.env.PVP_DATA || '/var/pvp';
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SECRET_FILE = path.join(DATA_DIR, 'secret');
const PORT = Number(process.env.PVP_PORT) || 3000;

if (!process.env.PVP_PG) { console.error('PVP_PG ontbreekt (verwacht via EnvironmentFile=/var/pvp/pg.env).'); process.exit(1); }
const pool = new pg.Pool({ connectionString: process.env.PVP_PG, max: 5, statement_timeout: 15000, idleTimeoutMillis: 30000 });
pool.on('error', e => console.error('PG-poolfout (verbinding wordt vervangen): ' + e.message));

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let SECRET;
try { SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim(); }
catch (e) { SECRET = crypto.randomBytes(32).toString('hex'); try { fs.writeFileSync(SECRET_FILE, SECRET); } catch (_) {} }

function hashPw(pw, salt) { return crypto.scryptSync(String(pw), salt, 64).toString('hex'); }
async function findUser(username) { const r = await pool.query('SELECT username, role, salt, hash, name FROM users WHERE username=$1', [String(username || '').toLowerCase()]); return r.rows[0]; }
function sign(p) { return crypto.createHmac('sha256', SECRET).update(p).digest('hex'); }
function makeToken(u) { const p = Buffer.from(JSON.stringify({ u: u.username, r: u.role, n: u.name || u.username })).toString('base64'); return p + '.' + sign(p); }
function verifyToken(tok) { if (!tok || tok.indexOf('.') < 0) return null; const i = tok.lastIndexOf('.'); const p = tok.slice(0, i), sig = tok.slice(i + 1); if (sign(p) !== sig) return null; try { return JSON.parse(Buffer.from(p, 'base64').toString('utf8')); } catch (e) { return null; } }
function parseCookies(req) { const h = req.headers.cookie || ''; const out = {}; h.split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); }); return out; }
function userFromReq(req) { return verifyToken(parseCookies(req).pvp_session); }
function saveDataUrl(dataUrl, id, prefix) {
  const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const safeId = String(id).replace(/[^A-Za-z0-9._-]/g, '_');
  const dir = path.join(UPLOAD_DIR, safeId);
  fs.mkdirSync(dir, { recursive: true });
  const fname = prefix + '_' + crypto.randomBytes(6).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(dir, fname), Buffer.from(m[2], 'base64'));
  return '/uploads/' + safeId + '/' + fname;
}
function saveFile(dataUrl, id, prefix) {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const extMap = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif' };
  const ext = extMap[mime]; if (!ext) return null;
  const safeId = String(id).replace(/[^A-Za-z0-9._-]/g, '_');
  const dir = path.join(UPLOAD_DIR, safeId);
  fs.mkdirSync(dir, { recursive: true });
  const fname = prefix + '_' + crypto.randomBytes(6).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(dir, fname), Buffer.from(m[2], 'base64'));
  return '/uploads/' + safeId + '/' + fname;
}
// Bedragen uit een ander systeem komen in Nederlandse notatie binnen: "2.950,00" is 2950, niet 2,95.
// Zonder dit onderscheid weiger je een geldige prijs of boek je er een die duizend keer te laag is.
function bedrag(x) {
  if (x === undefined || x === null || String(x).trim() === '') return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : NaN;
  let t = String(x).replace(/[^0-9.,-]/g, '');
  if (!/\d/.test(t)) return NaN;      // "abc" wordt anders 0, en dat boekt een verkoop van nul euro
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');          // komma is de decimaal
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');      // 2.950 = duizendtallen
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
function sendJson(res, code, obj, headers) { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers || {})); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve) => {
    let data = ''; let bad = false;
    req.on('data', c => { data += c; if (data.length > 32 * 1024 * 1024) { bad = true; req.destroy(); } });
    req.on('end', () => { if (bad) return resolve(null); if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic', '.pdf': 'application/pdf', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serveUpload(req, res, url) {
  if (!userFromReq(req)) return sendJson(res, 401, { error: 'auth' });
  const rel = decodeURIComponent(url.replace(/^\/uploads\//, ''));
  if (rel.indexOf('..') >= 0) return sendJson(res, 400, { error: 'bad' });
  const fp = path.join(UPLOAD_DIR, rel);
  fs.stat(fp, (e, st) => {
    if (e || !st.isFile()) return sendJson(res, 404, { error: 'notfound' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'private, max-age=300' });
    fs.createReadStream(fp).pipe(res);
  });
}

/* ===== Opslag (PostgreSQL). De vorm van elk antwoord is gelijk aan de JSON-versie. ===== */

// { vehicles:{ id:{status,klaar,route,owner,subtasks,photos,arrivedAt,taxAt} }, subUid, globalTodos, gtUid, activityLog }
async function getState() {
  const [veh, todos, log, meta] = await Promise.all([
    pool.query('SELECT id,status,klaar,route,owner,subtasks,photos,arrived_at,tax_at FROM vehicles ORDER BY sort_order NULLS LAST, id'),
    pool.query('SELECT id,text,owner,vehicle_id,done,created_at,done_at,done_by FROM global_todos ORDER BY id'),
    pool.query('SELECT ts,by_name,action,text,vehicle_id FROM activity_log ORDER BY id'),
    pool.query('SELECT key,value FROM meta')
  ]);
  const vehicles = {};
  for (const r of veh.rows) vehicles[r.id] = { status: r.status, klaar: r.klaar, route: r.route, owner: r.owner, subtasks: r.subtasks || [], photos: r.photos || {}, arrivedAt: r.arrived_at, taxAt: r.tax_at };
  const m = {}; for (const r of meta.rows) m[r.key] = r.value;
  return {
    vehicles,
    subUid: m.subUid || 1,
    globalTodos: todos.rows.map(r => {
      const t = { id: r.id, text: r.text, owner: r.owner, vehicleId: r.vehicle_id, done: r.done };
      // createdAt/doneAt/doneBy alleen meesturen als ze gevuld zijn — precies zoals de JSON-versie deed.
      if (r.created_at !== null) t.createdAt = r.created_at;
      if (r.done_at !== null) t.doneAt = r.done_at;
      if (r.done_by !== null) t.doneBy = r.done_by;
      return t;
    }),
    gtUid: m.gtUid || 1,
    activityLog: log.rows.map(r => ({ ts: r.ts, by: r.by_name, action: r.action, text: r.text, vehicleId: r.vehicle_id }))
  };
}

// Eén auto naar het Autoboek schrijven en de uitkomst vastleggen. Gooit nooit: het toevoegen van een
// auto in PVP mag niet mislukken omdat Google even niet meewerkt. Wat er misging komt in de database
// en daarmee op het scherm, zodat het opnieuw geprobeerd kan worden in plaats van stil te verdwijnen.
async function naarAutoboek(id) {
  const bewaar = async (status, rij, fout) => {
    await pool.query('UPDATE vehicles SET autoboek_status=$2, autoboek_rij=$3, autoboek_ts=$4, autoboek_fout=$5 WHERE id=$1',
      [id, status, rij, Date.now(), fout]);
    return { status, rij: rij || null, fout: fout || null };
  };
  if (!autoboek || !autoboek.aan()) return { status: 'uit', rij: null, fout: null };
  try {
    const r = await pool.query('SELECT * FROM vehicles WHERE id=$1', [id]);
    if (!r.rowCount) return { status: 'fout', rij: null, fout: 'auto niet gevonden' };
    const v = r.rows[0];
    const uit = await autoboek.schrijfAuto({
      vin: v.vin, kenteken: v.kenteken, merk: v.merk, model: v.model, uitv: v.uitv, kleur: v.kleur,
      brandstof: v.brandstof, transm: v.transm, reg: v.reg, km: v.km, inkoopdatum: v.inkoopdatum,
      lev: v.lev, batch: v.batch, inkoopprijs: v.inkoopprijs,
    });
    return await bewaar('ok', uit.rij, null);
  } catch (e) {
    console.error('autoboek:', id, e.message);
    return await bewaar('fout', null, String(e.message).slice(0, 400));
  }
}

// De verkoop naar het Autoboek: de regel verhuist van "Lopende Autos" naar "Verkochte Autos".
// Zelfde opzet als naarAutoboek(): gooit nooit, en wat er misging komt in de database en dus op het
// scherm, met een knop om het opnieuw te proberen. Beter een auto die nog verplaatst moet worden dan
// een stille mislukking.
async function verkoopNaarAutoboek(id) {
  const bewaar = async (status, rij, fout) => {
    await pool.query('UPDATE vehicles SET autoboek_status=$2, autoboek_rij=$3, autoboek_ts=$4, autoboek_fout=$5 WHERE id=$1',
      [id, status, rij, Date.now(), fout]);
    return { status, rij: rij || null, fout: fout || null };
  };
  if (!autoboek || !autoboek.aan()) return { status: 'uit', rij: null, fout: null };
  try {
    const r = await pool.query('SELECT * FROM vehicles WHERE id=$1', [id]);
    if (!r.rowCount) return { status: 'fout', rij: null, fout: 'auto niet gevonden' };
    const v = r.rows[0];
    const uit = await autoboek.verplaatsNaarVerkocht(
      { vin: v.vin, kenteken: v.kenteken, merk: v.merk, model: v.model },
      { factuurnr: v.verkoop_factuurnr, factuurdatum: v.verkoop_factuurdatum,
        verkoopprijs: v.verkoopprijs === null ? null : Number(v.verkoopprijs) });
    return await bewaar('ok', uit.rij, null);
  } catch (e) {
    console.error('autoboek verkoop:', id, e.message);
    return await bewaar('fout', null, String(e.message).slice(0, 400));
  }
}

// Dezelfde opzet als hierboven, voor de andere twee richtingen.
async function autoboekVerplaats(id, wat) {
  const bewaar = async (status, rij, fout) => {
    await pool.query('UPDATE vehicles SET autoboek_status=$2, autoboek_rij=$3, autoboek_ts=$4, autoboek_fout=$5 WHERE id=$1',
      [id, status, rij, Date.now(), fout]);
    return { status, rij: rij || null, fout: fout || null };
  };
  if (!autoboek || !autoboek.aan()) return { status: 'uit', rij: null, fout: null };
  try {
    const r = await pool.query('SELECT vin,kenteken FROM vehicles WHERE id=$1', [id]);
    if (!r.rowCount) return { status: 'fout', rij: null, fout: 'auto niet gevonden' };
    const v = r.rows[0];
    const fn = wat === 'terug' ? autoboek.verplaatsNaarLopend : autoboek.verplaatsBinnengekomen;
    const uit = await fn({ vin: v.vin, kenteken: v.kenteken });
    return await bewaar('ok', uit.rij, null);
  } catch (e) {
    console.error('autoboek ' + wat + ':', id, e.message);
    return await bewaar('fout', null, String(e.message).slice(0, 400));
  }
}

// De frontend stuurt telkens de complete state op; dit is één transactie.
// Voertuigen die niet in de payload zitten blijven staan (nodig voor de latere Autoboek-sync).
async function putState(b) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const vs = (b && b.vehicles) || {};
    for (const id of Object.keys(vs)) {
      const v = vs[id] || {};
      await client.query(
        `INSERT INTO vehicles (id,status,klaar,route,owner,arrived_at,tax_at,photos,subtasks,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
         ON CONFLICT (id) DO UPDATE SET
           -- Een gemelde of bevestigde verkoop niet laten terugdraaien. De frontend stuurt zijn hele
           -- geheugen op; een tabblad dat nog openstond van vóór de melding zou de auto anders
           -- terugzetten naar 'lopende'. stateOk beschermt hier niet tegen: dat inlezen ging goed,
           -- de gegevens zijn alleen verouderd.
           status=CASE WHEN vehicles.status IN ('gemeld verkocht','verkocht')
                       THEN vehicles.status ELSE EXCLUDED.status END,
           klaar=EXCLUDED.klaar, route=EXCLUDED.route, owner=EXCLUDED.owner,
           arrived_at=EXCLUDED.arrived_at, tax_at=EXCLUDED.tax_at,
           photos=EXCLUDED.photos, subtasks=EXCLUDED.subtasks, updated_at=now()`,
        [id, v.status || 'komende', Number(v.klaar) || 0, v.route || null, v.owner || null,
         v.arrivedAt || null, v.taxAt || null,
         JSON.stringify(v.photos || {}), JSON.stringify(Array.isArray(v.subtasks) ? v.subtasks : [])]);
    }

    const todos = Array.isArray(b.globalTodos) ? b.globalTodos : [];
    await client.query('DELETE FROM global_todos');
    if (todos.length) {
      await client.query(
        `INSERT INTO global_todos (id,text,owner,vehicle_id,done,created_at,done_at,done_by)
         SELECT * FROM unnest($1::bigint[],$2::text[],$3::text[],$4::text[],$5::boolean[],$6::bigint[],$7::bigint[],$8::text[])`,
        [todos.map(t => t.id), todos.map(t => t.text || null), todos.map(t => t.owner || null),
         todos.map(t => t.vehicleId || null), todos.map(t => !!t.done), todos.map(t => t.createdAt || null),
         todos.map(t => t.doneAt || null), todos.map(t => t.doneBy || null)]);
    }

    const log = Array.isArray(b.activityLog) ? b.activityLog : [];
    await client.query('DELETE FROM activity_log');
    if (log.length) {
      await client.query(
        `INSERT INTO activity_log (ts,by_name,action,text,vehicle_id)
         SELECT * FROM unnest($1::bigint[],$2::text[],$3::text[],$4::text[],$5::text[])`,
        [log.map(a => a.ts || null), log.map(a => a.by || null), log.map(a => a.action || null),
         log.map(a => a.text || ''), log.map(a => a.vehicleId || null)]);
    }

    for (const [k, val] of [['subUid', b.subUid], ['gtUid', b.gtUid]]) {
      if (typeof val === 'number') {
        await client.query(`INSERT INTO meta (key,value) VALUES ($1,$2)
                            ON CONFLICT (key) DO UPDATE SET value=GREATEST(meta.value, EXCLUDED.value)`, [k, val]);
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function getBpm() {
  const [rep, nf] = await Promise.all([
    pool.query('SELECT vehicle_id,url,name,ts,by_name FROM bpm_reports ORDER BY id'),
    pool.query('SELECT vehicle_id,name,ts,by_name,seen FROM bpm_notifs ORDER BY id')
  ]);
  const vehicles = {};
  for (const r of rep.rows) { if (!vehicles[r.vehicle_id]) vehicles[r.vehicle_id] = []; vehicles[r.vehicle_id].push({ url: r.url, name: r.name, ts: r.ts, by: r.by_name }); }
  return { vehicles, notifs: nf.rows.map(n => ({ id: n.vehicle_id, name: n.name, ts: n.ts, by: n.by_name, seen: n.seen })) };
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;
  try {
    if (method === 'GET' && url === '/api/health') { let db = false; try { await pool.query('SELECT 1'); db = true; } catch (_) {} return sendJson(res, 200, { ok: true, time: Date.now(), db }); }
    if (method === 'POST' && url === '/api/login') {
      const b = await readBody(req) || {};
      const user = await findUser(b.username);
      if (!user || hashPw(b.password, user.salt) !== user.hash) return sendJson(res, 401, { error: 'invalid' });
      return sendJson(res, 200, { name: user.name || user.username, role: user.role }, { 'Set-Cookie': `pvp_session=${makeToken(user)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
    }
    if (method === 'POST' && url === '/api/logout') return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'pvp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    if (method === 'GET' && url === '/api/me') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); return sendJson(res, 200, { name: u.n, role: u.r, uitlezen: !!(uitlezen && uitlezen.aan()) }); }

    if (method === 'GET' && url.indexOf('/uploads/') === 0) return serveUpload(req, res, url);

    if (url === '/api/state' && method === 'GET') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' }); return sendJson(res, 200, await getState()); }
    if (url === '/api/state' && method === 'PUT') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' }); const b = await readBody(req); if (b === null) return sendJson(res, 400, { error: 'bad' }); await putState(b); return sendJson(res, 200, { ok: true }); }
    if (url === '/api/photo' && method === 'POST') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' }); const b = await readBody(req) || {}; if (!b.id || !b.key || !b.dataUrl) return sendJson(res, 400, { error: 'missing' }); const up = saveDataUrl(b.dataUrl, b.id, String(b.key).replace(/[^A-Za-z0-9._-]/g, '_')); if (!up) return sendJson(res, 400, { error: 'format' }); return sendJson(res, 200, { url: up }); }

    if (url === '/api/status' && method === 'GET') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); const r = await pool.query('SELECT id,status FROM vehicles ORDER BY sort_order NULLS LAST, id'); const out = {}; for (const row of r.rows) out[row.id] = { status: row.status }; return sendJson(res, 200, { vehicles: out }); }

    // Catalogus (dezelfde vorm als de lijst V in index.html). Sinds Fase 2 laadt de frontend hier
    // zijn auto's uit; de lijst in index.html is nog slechts terugval.
    if (url === '/api/vehicles' && method === 'GET') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      const r = await pool.query('SELECT id,vin,kenteken,merk,model,uitv,kleur,brandstof,transm,reg,km,inkoopdatum,lev,import_auto,batch,note,status,factuurnr,inkoopprijs,verkoopdatum,docs,autoboek_status,autoboek_rij,autoboek_fout,verkoop_factuurnr,verkoop_factuurdatum,verkoopprijs,verkocht_gemeld_ts,verkocht_bevestigd_door FROM vehicles ORDER BY sort_order NULLS LAST, id');
      // inkoopprijs is numeric; die geeft pg als string terug. Hier omzetten en niet met een globale
      // type-parser, want dan raak je ook iedere toekomstige numeric elders in de app.
      return sendJson(res, 200, r.rows.map(v => ({ id: v.id, vin: v.vin, kenteken: v.kenteken, merk: v.merk, model: v.model, uitv: v.uitv, kleur: v.kleur, brandstof: v.brandstof, transm: v.transm, reg: v.reg, km: v.km, inkoopdatum: v.inkoopdatum, lev: v.lev, importAuto: v.import_auto, batch: v.batch, note: v.note, status: v.status, factuurnr: v.factuurnr, inkoopprijs: v.inkoopprijs === null ? null : Number(v.inkoopprijs), verkoopdatum: v.verkoopdatum, docs: Array.isArray(v.docs) ? v.docs : [],
        autoboekStatus: v.autoboek_status, autoboekRij: v.autoboek_rij, autoboekFout: v.autoboek_fout,
        verkoopFactuurnr: v.verkoop_factuurnr, verkoopFactuurdatum: v.verkoop_factuurdatum,
        verkoopprijs: v.verkoopprijs === null ? null : Number(v.verkoopprijs),
        verkochtGemeldTs: v.verkocht_gemeld_ts, verkochtDoor: v.verkocht_bevestigd_door })));
    }

    // Nieuwe auto vastleggen (de plusknop). Alleen team/admin. Bewust een eigen endpoint en niet via
    // PUT /api/state: dat schrijft alleen voortgang terug en raakt de catalogusvelden niet aan.
    if (url === '/api/vehicle' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
      const b = await readBody(req) || {};
      const tekst = x => { const s = (x === undefined || x === null) ? '' : String(x).trim(); return s === '' ? null : s; };
      const vin = tekst(b.vin), kent = tekst(b.kenteken);
      // De sleutel is de VIN bij import en anders het kenteken — precies zoals de bestaande rijen.
      const id = vin || kent;
      if (!id) return sendJson(res, 400, { error: 'geen vin of kenteken' });
      const bestaat = await pool.query('SELECT id FROM vehicles WHERE id=$1', [id]);
      if (bestaat.rowCount) return sendJson(res, 409, { error: 'bestaat al', id });
      // Dezelfde omzetting als bij de verkoopmelding. Stond hier een eigen variant die "12.500,00" tot
      // 12,5 maakte — een factor duizend te laag, en dat merk je pas als het in het Autoboek staat.
      const getal = x => { const n = bedrag(x); return n === null || Number.isNaN(n) ? null : n; };
      // Achteraan in de weergavevolgorde; nieuwe auto's horen onderaan de lijst.
      const so = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM vehicles');
      await pool.query(
        `INSERT INTO vehicles (id,vin,kenteken,merk,model,uitv,kleur,brandstof,transm,reg,km,inkoopdatum,lev,
                               import_auto,batch,note,factuurnr,inkoopprijs,verkoopdatum,sort_order,status,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'komende',now())`,
        [id, vin, kent || '—', tekst(b.merk), tekst(b.model), tekst(b.uitv), tekst(b.kleur), tekst(b.brandstof),
         tekst(b.transm), tekst(b.reg), getal(b.km), tekst(b.inkoopdatum), tekst(b.lev), b.importAuto === true,
         tekst(b.batch), tekst(b.note), tekst(b.factuurnr), getal(b.inkoopprijs), tekst(b.verkoopdatum), so.rows[0].n]);
      // Bewust niet hier in activity_log schrijven: putState() gooit die tabel leeg en vult hem
      // opnieuw uit de payload van de frontend, dus een regel van de server zou weer verdwijnen.
      // De frontend logt dit met logActivity().
      const ab = await naarAutoboek(id);
      return sendJson(res, 200, { ok: true, id, autoboek: ab });
    }

    // Auto verwijderen. Alleen admin: dit is de enige onomkeerbare handeling in PVP.
    //
    // Het Autoboek wordt NIET aangeraakt. De koppeling is met opzet alleen-toevoegen — dat is precies
    // waarom hij veilig is op een bestand waar Power BI op draait. In plaats daarvan geven we het
    // rijnummer terug, zodat de gebruiker die ene regel zelf kan weghalen.
    //
    // De geüploade bestanden blijven op schijf staan. `pvp-uploads-opruimen` verplaatst wezen
    // vannacht naar /var/pvp/prullenbak, waar ze nog 30 dagen staan: het vangnet bij een vergissing.
    /* ===== Verkoop =====
       Twee stappen met opzet. Een melding komt straks van een ander systeem (Mobilox) en zet de auto
       op 'gemeld verkocht'; pas als een beheerder bevestigt gaat hij op 'verkocht' en verhuist de regel
       in het Autoboek. Zo kan een verkeerde of dubbele melding nooit ongemerkt een auto afsluiten. */

    // Melding van buiten: bearer-token, geen sessiecookie. Token uit /var/pvp/verkoop.env.
    if (url === '/api/verkocht' && method === 'POST') {
      // Twee manieren binnen: een ander systeem met een bearer-token, of een ingelogde collega in de
      // app. Bewust hetzelfde endpoint — dan gelden voor beide dezelfde regels rond idempotentie,
      // opzoeken en vastleggen, en kan er geen tweede variant ontstaan die net iets anders doet.
      const sessie = userFromReq(req);
      const viaApp = sessie && (sessie.r === 'team' || sessie.r === 'admin');
      if (!viaApp) {
        const token = (process.env.PVP_VERKOOP_TOKEN || '').trim();
        // Geen token ingesteld = de koppeling van buiten staat uit. Nooit "geen token dus vrije toegang".
        if (!token) return sendJson(res, 503, { error: 'verkoopkoppeling staat uit' });
        const kop = String(req.headers.authorization || '');
        const gegeven = kop.startsWith('Bearer ') ? kop.slice(7).trim() : '';
        const a = Buffer.from(gegeven), b = Buffer.from(token);
        // Lengte eerst vergelijken: timingSafeEqual gooit bij ongelijke lengte.
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return sendJson(res, 401, { error: 'auth' });
      }

      const body = await readBody(req) || {};
      const tekst = x => { const t = (x === undefined || x === null) ? '' : String(x).trim(); return t === '' ? null : t; };
      const sleutel = tekst(body.voertuig);
      const factuurnr = tekst(body.factuurnummer);
      const factuurdatum = tekst(body.factuurdatum);
      const prijsRuw = body.verkoopprijs;
      const prijs = bedrag(prijsRuw);

      const spoor = (vid, uitkomst) => pool.query(
        'INSERT INTO verkoop_meldingen (ts,vehicle_id,bron,factuurnr,factuurdatum,verkoopprijs,uitkomst,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [Date.now(), vid, tekst(body.bron) || (viaApp ? 'app: ' + (sessie.u || '?') : 'onbekend'), factuurnr, factuurdatum, Number.isFinite(prijs) ? prijs : null, uitkomst, JSON.stringify(body)]
      ).catch(e => console.error('verkoopmelding niet gelogd:', e.message));

      if (!sleutel || !factuurnr) { await spoor(null, 'ongeldig'); return sendJson(res, 400, { error: 'voertuig en factuurnummer zijn verplicht' }); }
      if (prijs !== null && !Number.isFinite(prijs)) { await spoor(null, 'ongeldig'); return sendJson(res, 400, { error: 'verkoopprijs is geen getal' }); }

      // Opzoeken op id, VIN of kenteken. Genormaliseerd, want een ander systeem schrijft JJ-285-K waar
      // PVP JJ285K heeft. De lege sleutel mag nooit matchen op auto's met een kastlijntje in het veld.
      const plat = String(sleutel).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const gev = await pool.query(
        `SELECT id,status,verkoop_factuurnr FROM vehicles
          WHERE id=$1
             OR ($2 <> '' AND upper(regexp_replace(coalesce(vin,''),      '[^A-Za-z0-9]', '', 'g')) = $2)
             OR ($2 <> '' AND upper(regexp_replace(coalesce(kenteken,''), '[^A-Za-z0-9]', '', 'g')) = $2)
          LIMIT 2`, [sleutel, plat]);
      if (!gev.rowCount) { await spoor(null, 'onbekend voertuig'); return sendJson(res, 404, { error: 'onbekend voertuig', gezocht: sleutel }); }
      if (gev.rowCount > 1) { await spoor(null, 'ongeldig'); return sendJson(res, 409, { error: 'sleutel past op meer dan één auto', gezocht: sleutel }); }
      const v = gev.rows[0];

      // Idempotent: dezelfde melding nog eens is goed, een andere melding op dezelfde auto niet.
      if (v.status === 'gemeld verkocht' || v.status === 'verkocht') {
        if ((v.verkoop_factuurnr || '') === factuurnr) {
          await spoor(v.id, 'ongewijzigd');
          return sendJson(res, 200, { ok: true, ongewijzigd: true, id: v.id, status: v.status });
        }
        await spoor(v.id, 'conflict');
        return sendJson(res, 409, { error: 'auto staat al op een andere verkoop', id: v.id, status: v.status, bestaand: v.verkoop_factuurnr, gemeld: factuurnr });
      }

      await pool.query(
        `UPDATE vehicles SET status='gemeld verkocht', verkoop_factuurnr=$2, verkoop_factuurdatum=$3,
                verkoopprijs=$4, verkocht_gemeld_ts=$5, updated_at=now() WHERE id=$1`,
        [v.id, factuurnr, factuurdatum, prijs, Date.now()]);
      await spoor(v.id, 'gemeld');
      console.log('verkoop gemeld:', v.id, 'factuur', factuurnr);
      return sendJson(res, 200, { ok: true, id: v.id, status: 'gemeld verkocht' });
    }

    // Per ongeluk bevestigd: terug naar lopende, en de regel gaat in het Autoboek terug.
    if (url === '/api/verkoop-terug' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'admin') return sendJson(res, 403, { error: 'alleen een beheerder kan dit terugzetten' });
      const b = await readBody(req) || {};
      if (!b.id) return sendJson(res, 400, { error: 'missing' });
      const r = await pool.query('SELECT id,status FROM vehicles WHERE id=$1', [b.id]);
      if (!r.rowCount) return sendJson(res, 404, { error: 'onbekende auto' });
      if (r.rows[0].status !== 'verkocht') return sendJson(res, 409, { error: 'deze auto staat niet op verkocht', status: r.rows[0].status });
      await pool.query(`UPDATE vehicles SET status='lopende', verkoop_factuurnr=NULL, verkoop_factuurdatum=NULL,
        verkoopprijs=NULL, verkocht_gemeld_ts=NULL, verkocht_bevestigd_ts=NULL, verkocht_bevestigd_door=NULL,
        updated_at=now() WHERE id=$1`, [b.id]);
      console.log('verkoop teruggedraaid:', b.id, 'door', u.u);
      return sendJson(res, 200, { ok: true, id: b.id, status: 'lopende', autoboek: await autoboekVerplaats(b.id, 'terug') });
    }

    // Auto binnengekomen: de regel verhuist in het Autoboek van Komende naar Lopende. De status zelf
    // loopt via PUT /api/state; dit endpoint doet alleen het Autoboek, zodat het opslaan snel blijft.
    if (url === '/api/binnengekomen' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
      const b = await readBody(req) || {};
      if (!b.id) return sendJson(res, 400, { error: 'missing' });
      const r = await pool.query('SELECT id FROM vehicles WHERE id=$1', [b.id]);
      if (!r.rowCount) return sendJson(res, 404, { error: 'onbekende auto' });
      return sendJson(res, 200, { autoboek: await autoboekVerplaats(b.id, 'binnen') });
    }

    // Bevestigen door een beheerder: status 'verkocht' én de regel in het Autoboek verplaatsen.
    if (url === '/api/verkoop-bevestigen' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'admin') return sendJson(res, 403, { error: 'alleen een beheerder kan een verkoop bevestigen' });
      const b = await readBody(req) || {};
      if (!b.id) return sendJson(res, 400, { error: 'missing' });
      const r = await pool.query('SELECT * FROM vehicles WHERE id=$1', [b.id]);
      if (!r.rowCount) return sendJson(res, 404, { error: 'onbekende auto' });
      const v = r.rows[0];
      if (v.status !== 'gemeld verkocht' && v.status !== 'verkocht') {
        return sendJson(res, 409, { error: 'deze auto is niet gemeld als verkocht', status: v.status });
      }
      if (v.status !== 'verkocht') {
        await pool.query(
          `UPDATE vehicles SET status='verkocht', verkocht_bevestigd_ts=$2, verkocht_bevestigd_door=$3, updated_at=now() WHERE id=$1`,
          [v.id, Date.now(), u.n || u.u || '?']);
      }
      // Het Autoboek is een aparte stap: mislukt dat, dan blijft de bevestiging in PVP wél staan en is
      // de fout zichtbaar, net als bij het aanmaken van een auto.
      const ab = await verkoopNaarAutoboek(v.id);
      return sendJson(res, 200, { ok: true, id: v.id, status: 'verkocht', autoboek: ab });
    }

    if (url === '/api/vehicle-del' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'admin') return sendJson(res, 403, { error: 'alleen een beheerder kan een auto verwijderen' });
      const b = await readBody(req) || {};
      if (!b.id) return sendJson(res, 400, { error: 'missing' });
      const r = await pool.query('SELECT id,merk,model,vin,kenteken,status,klaar,photos,subtasks,ad_photos,docs,autoboek_rij FROM vehicles WHERE id=$1', [b.id]);
      if (!r.rowCount) return sendJson(res, 404, { error: 'onbekende auto' });
      const v = r.rows[0];
      const aantal = o => (Array.isArray(o) ? o.length : Object.keys(o || {}).length);
      // Een lopend dossier met foto's of subtaken is geen vergissing maar werk. Alleen weggooien als
      // de gebruiker dat na de waarschuwing nog steeds wil.
      const bezet = v.status === 'lopende' && (aantal(v.photos) || aantal(v.subtasks) || aantal(v.ad_photos) || (v.klaar || 0) > 0);
      if (bezet && b.tochWeg !== true) {
        return sendJson(res, 409, {
          error: 'lopend dossier',
          waarschuwing: `Deze auto is al binnen en er is aan gewerkt: ${aantal(v.photos)} keuringsfoto's, ${aantal(v.ad_photos)} advertentiefoto's, ${aantal(v.subtasks)} subtaken, stap ${v.klaar || 0} afgerond.`,
        });
      }
      // In één transactie: gaat er iets mis, dan is er niets half weg. Zonder dit kunnen de to-do's
      // verdwenen zijn terwijl de auto blijft staan, en dan is niet meer te zien wat er gebeurd is.
      // bpm_notifs hoort erbij: een melding die naar een verdwenen auto wijst, is een spookmelding.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM global_todos WHERE vehicle_id=$1', [b.id]);
        await client.query('DELETE FROM bpm_reports  WHERE vehicle_id=$1', [b.id]);
        await client.query('DELETE FROM bpm_notifs   WHERE vehicle_id=$1', [b.id]);
        await client.query('DELETE FROM vehicles     WHERE id=$1', [b.id]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('auto verwijderen mislukt:', b.id, e.message);
        return sendJson(res, 500, { error: 'verwijderen mislukt — er is niets weggegooid' });
      } finally { client.release(); }
      console.log('auto verwijderd:', b.id, 'door', u.u);
      return sendJson(res, 200, {
        ok: true, id: b.id,
        naam: [v.merk, v.model].filter(Boolean).join(' ') || b.id,
        autoboekRij: v.autoboek_rij || null,
        bestanden: aantal(v.photos) + aantal(v.ad_photos) + aantal(v.docs),
      });
    }

    // Inkoopstukken uitlezen en er een ingevuld voorstel van maken. Maakt zelf niets aan: de
    // gebruiker kijkt het na en drukt daarna pas op Opslaan. Eén verkeerd gelezen VIN levert anders
    // een spookauto op die je in twee systemen moet opruimen.
    if (url === '/api/uitlezen' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
      if (!uitlezen || !uitlezen.aan()) return sendJson(res, 200, { uit: true, fout: 'automatisch uitlezen staat uit' });
      const b = await readBody(req) || {};
      if (!Array.isArray(b.docs) || !b.docs.length) return sendJson(res, 400, { error: 'geen documenten' });
      try {
        const r = await uitlezen.lees(b.docs);
        // Namen erbij, niet alleen een aantal: bij een tegenvallende uitlezing is de eerste vraag
        // altijd "welke stukken kreeg het model eigenlijk te zien?", en die was zo niet te beantwoorden.
        const gevuld = Object.entries(r.velden || {}).filter(([, w]) => w !== null && w !== undefined && w !== '').map(([k]) => k);
        console.log('uitlezen:', u.u, r.verbruik.in, 'in /', r.verbruik.uit, 'uit tokens'
          + (r.pogingen > 1 ? ' | ' + r.pogingen + ' pogingen' : '')
          + ' | gebruikt: ' + r.gebruikt.join(', ')
          + ' | overgeslagen: ' + (r.overgeslagen.join(', ') || '-')
          + ' | gevuld: ' + (gevuld.join(',') || 'NIETS'));
        return sendJson(res, 200, r);
      } catch (e) {
        console.error('uitlezen:', e.message);
        return sendJson(res, 200, { fout: String(e.message).slice(0, 300) });
      }
    }

    // Opnieuw proberen de auto in het Autoboek te zetten (knop in de app na een mislukte poging).
    if (url === '/api/autoboek-retry' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
      const b = await readBody(req) || {};
      if (!b.id) return sendJson(res, 400, { error: 'missing' });
      const bestaat = await pool.query('SELECT id FROM vehicles WHERE id=$1', [b.id]);
      if (!bestaat.rowCount) return sendJson(res, 404, { error: 'onbekende auto' });
      return sendJson(res, 200, { autoboek: await naarAutoboek(b.id) });
    }

    // Document bij een auto (koopovereenkomst, proforma, screenshot). Gaat via saveFile en niet via
    // saveDataUrl, want pdf's moeten er ook langs kunnen.
    if (url === '/api/vehicledoc' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
      const b = await readBody(req) || {};
      if (!b.id || !b.dataUrl) return sendJson(res, 400, { error: 'missing' });
      const up = saveFile(b.dataUrl, b.id, 'doc'); if (!up) return sendJson(res, 400, { error: 'format' });
      const naam = String(b.name || 'document').slice(0, 200);
      await pool.query(
        `INSERT INTO vehicles (id, docs) VALUES ($1, jsonb_build_array($2::jsonb))
         ON CONFLICT (id) DO UPDATE SET docs = vehicles.docs || jsonb_build_array($2::jsonb), updated_at=now()`,
        [b.id, JSON.stringify({ url: up, name: naam, ts: Date.now() })]);
      return sendJson(res, 200, { url: up });
    }

    if (url === '/api/adphotos' && method === 'GET') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); const r = await pool.query(`SELECT id, ad_photos FROM vehicles WHERE ad_photos <> '[]'::jsonb ORDER BY sort_order NULLS LAST, id`); const out = {}; for (const row of r.rows) out[row.id] = row.ad_photos; return sendJson(res, 200, out); }
    if (url === '/api/adphoto' && method === 'POST') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); const b = await readBody(req) || {}; if (!b.id || !b.dataUrl) return sendJson(res, 400, { error: 'missing' }); const up = saveDataUrl(b.dataUrl, b.id, 'ad'); if (!up) return sendJson(res, 400, { error: 'format' }); await pool.query(`INSERT INTO vehicles (id, ad_photos) VALUES ($1, jsonb_build_array($2::text)) ON CONFLICT (id) DO UPDATE SET ad_photos = vehicles.ad_photos || jsonb_build_array($2::text), updated_at=now()`, [b.id, up]); return sendJson(res, 200, { url: up }); }
    if (url === '/api/adphotos-set' && method === 'POST') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); const b = await readBody(req) || {}; if (!b.id || !Array.isArray(b.urls)) return sendJson(res, 400, { error: 'missing' }); await pool.query(`INSERT INTO vehicles (id, ad_photos) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO UPDATE SET ad_photos=EXCLUDED.ad_photos, updated_at=now()`, [b.id, JSON.stringify(b.urls)]); return sendJson(res, 200, { ok: true }); }

    if (url === '/api/taxstate' && method === 'GET') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); if (u.r !== 'taxateur' && u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' }); const r = await pool.query('SELECT id,status,route,photos FROM vehicles ORDER BY sort_order NULLS LAST, id'); const out = {}; for (const row of r.rows) out[row.id] = { status: row.status, route: row.route || null, photos: row.photos || {} }; return sendJson(res, 200, { vehicles: out }); }
    if (url === '/api/bpmreports' && method === 'GET') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); return sendJson(res, 200, await getBpm()); }
    if (url === '/api/bpmreport' && method === 'POST') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); if (u.r !== 'taxateur' && u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' }); const b = await readBody(req) || {}; if (!b.id || !b.dataUrl) return sendJson(res, 400, { error: 'missing' }); const up = saveFile(b.dataUrl, b.id, 'bpm'); if (!up) return sendJson(res, 400, { error: 'format' }); const rec = { url: up, name: String(b.name || 'BPM-rapport').slice(0, 120), ts: Date.now(), by: u.n || u.u }; const client = await pool.connect(); try { await client.query('BEGIN'); await client.query('INSERT INTO bpm_reports (vehicle_id,url,name,ts,by_name) VALUES ($1,$2,$3,$4,$5)', [b.id, rec.url, rec.name, rec.ts, rec.by]); await client.query('INSERT INTO bpm_notifs (vehicle_id,name,ts,by_name,seen) VALUES ($1,$2,$3,$4,false)', [b.id, rec.name, rec.ts, rec.by]); await client.query('COMMIT'); } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); } return sendJson(res, 200, { url: up }); }
    if (url === '/api/bpmnotif-seen' && method === 'POST') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' }); await pool.query('UPDATE bpm_notifs SET seen=true WHERE seen=false'); return sendJson(res, 200, { ok: true }); }
    if (url === '/api/bpmreport-del' && method === 'POST') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); if (u.r !== 'taxateur' && u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' }); const b = await readBody(req) || {}; if (!b.id || !b.url) return sendJson(res, 400, { error: 'missing' }); await pool.query('DELETE FROM bpm_reports WHERE vehicle_id=$1 AND url=$2', [b.id, b.url]); try { const rel = decodeURIComponent(String(b.url).replace(/^\/uploads\//, '')); if (rel.indexOf('..') < 0) fs.unlink(path.join(UPLOAD_DIR, rel), () => {}); } catch (_) {} return sendJson(res, 200, { ok: true }); }

    // Alleen voor lokaal testen: serveer de frontend als PVP_FRONTEND is gezet. In productie doet nginx dit.
    if (process.env.PVP_FRONTEND && method === 'GET') {
      let p = (url === '/' ? '/index.html' : url).replace(/\.\./g, '');
      const fp = path.join(process.env.PVP_FRONTEND, p);
      return fs.readFile(fp, (e, data) => { if (e) return sendJson(res, 404, { error: 'notfound' }); res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'text/html' }); res.end(data); });
    }
    return sendJson(res, 404, { error: 'notfound' });
  } catch (e) { console.error('Fout bij ' + method + ' ' + url + ': ' + e.message); return sendJson(res, 500, { error: 'server' }); }
});
server.listen(PORT, '127.0.0.1', () => console.log('PVP API (node + postgres) op 127.0.0.1:' + PORT));
