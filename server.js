// PVP backend — opslag in PostgreSQL (database `pvp`). Enige externe afhankelijkheid: `pg`.
// De API-antwoorden zijn identiek aan de vorige JSON-versie; de frontend is ongewijzigd.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pg = require('pg');

pg.types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10))); // bigint -> number i.p.v. string

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
           status=EXCLUDED.status, klaar=EXCLUDED.klaar, route=EXCLUDED.route, owner=EXCLUDED.owner,
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
    if (method === 'GET' && url === '/api/me') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); return sendJson(res, 200, { name: u.n, role: u.r }); }

    if (method === 'GET' && url.indexOf('/uploads/') === 0) return serveUpload(req, res, url);

    if (url === '/api/state' && method === 'GET') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' }); return sendJson(res, 200, await getState()); }
    if (url === '/api/state' && method === 'PUT') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' }); const b = await readBody(req); if (b === null) return sendJson(res, 400, { error: 'bad' }); await putState(b); return sendJson(res, 200, { ok: true }); }
    if (url === '/api/photo' && method === 'POST') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' }); const b = await readBody(req) || {}; if (!b.id || !b.key || !b.dataUrl) return sendJson(res, 400, { error: 'missing' }); const up = saveDataUrl(b.dataUrl, b.id, String(b.key).replace(/[^A-Za-z0-9._-]/g, '_')); if (!up) return sendJson(res, 400, { error: 'format' }); return sendJson(res, 200, { url: up }); }

    if (url === '/api/status' && method === 'GET') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); const r = await pool.query('SELECT id,status FROM vehicles ORDER BY sort_order NULLS LAST, id'); const out = {}; for (const row of r.rows) out[row.id] = { status: row.status }; return sendJson(res, 200, { vehicles: out }); }

    // Catalogus (dezelfde vorm als de lijst V in index.html). Sinds Fase 2 laadt de frontend hier
    // zijn auto's uit; de lijst in index.html is nog slechts terugval.
    if (url === '/api/vehicles' && method === 'GET') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      const r = await pool.query('SELECT id,vin,kenteken,merk,model,uitv,kleur,brandstof,transm,reg,km,inkoopdatum,lev,import_auto,batch,note,status,factuurnr,inkoopprijs,verkoopdatum,docs FROM vehicles ORDER BY sort_order NULLS LAST, id');
      // inkoopprijs is numeric; die geeft pg als string terug. Hier omzetten en niet met een globale
      // type-parser, want dan raak je ook iedere toekomstige numeric elders in de app.
      return sendJson(res, 200, r.rows.map(v => ({ id: v.id, vin: v.vin, kenteken: v.kenteken, merk: v.merk, model: v.model, uitv: v.uitv, kleur: v.kleur, brandstof: v.brandstof, transm: v.transm, reg: v.reg, km: v.km, inkoopdatum: v.inkoopdatum, lev: v.lev, importAuto: v.import_auto, batch: v.batch, note: v.note, status: v.status, factuurnr: v.factuurnr, inkoopprijs: v.inkoopprijs === null ? null : Number(v.inkoopprijs), verkoopdatum: v.verkoopdatum, docs: Array.isArray(v.docs) ? v.docs : [] })));
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
      const getal = x => { const n = Number(String(x === undefined || x === null ? '' : x).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) && String(x).trim() !== '' ? n : null; };
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
      return sendJson(res, 200, { ok: true, id });
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
