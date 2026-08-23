// PVP backend — opslag in PostgreSQL (database `pvp`). Enige externe afhankelijkheid: `pg`.
// De API-antwoorden zijn identiek aan de vorige JSON-versie; de frontend is ongewijzigd.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
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
// Taxatierapporten uitlezen (VIN + datum fysieke opname). Ontbreekt de module of pdftotext, dan
// werkt uploaden gewoon door — alleen het automatisch sorteren en de geldigheidsteller vallen weg.
let bpmlezen = null;
try { bpmlezen = require('./bpmlezen'); } catch (e) { console.error('bpmlezen niet geladen:', e.message); }

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
/* HEIC is het standaardformaat van iPhone en Mac. Chrome en Firefox kunnen het niet tónen, dus een
   foto die vanaf een Mac werd geüpload bleef in de app een leeg vak, en het uitlezen sloeg het bestand
   over — de Claude API kent alleen jpeg/png/gif/webp. Op Windows speelt het niet (die camera's leveren
   jpeg) en in Safari ook niet (die kan HEIC wél decoderen, waardoor verkleinFoto in de browser er al
   jpeg van maakt). Vandaar dat het per computer verschilde en niemand er een patroon in zag.
   We zetten HEIC daarom bij binnenkomst om naar JPEG, met heif-convert (libheif + libde265, systeem-
   pakketten, geen npm). Mislukt dat, dan bewaren we het origineel onder .heic: net als bij het
   verkleinen in de browser mag omzetten nooit een upload kosten.
   Er wordt bewust niet verkleind — heif-convert kan dat niet en libvips ervoor installeren sleept
   poppler en librsvg mee. Een omgezette foto is daardoor groter dan FOTO_MAX in index.html toestaat
   (ruwweg 3 MB bij 4032 px), maar wel leesbaar, en juist bij kentekenbewijzen leest het model er
   chassisnummers uit. */
const HEIC_KWALITEIT = 90;

// Op de inhoud kijken en niet op het opgegeven type: Firefox op de Mac geeft een .heic mee als
// application/octet-stream, en dan mist een controle op de mime-tekst het bestand.
function isHeic(buf) {
  if (!buf || buf.length < 12) return false;
  if (buf.toString('latin1', 4, 8) !== 'ftyp') return false;
  return ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'heif'].includes(buf.toString('latin1', 8, 12));
}

function heicNaarJpeg(buf) {
  return new Promise(klaar => {
    let map = null;
    const opruimen = () => { if (map) { try { fs.rmSync(map, { recursive: true, force: true }); } catch (e) {} } };
    try {
      map = fs.mkdtempSync(path.join(os.tmpdir(), 'pvp-heic-'));
      fs.writeFileSync(path.join(map, 'in.heic'), buf);
    } catch (e) { opruimen(); return klaar(null); }
    execFile('heif-convert', ['-q', String(HEIC_KWALITEIT), path.join(map, 'in.heic'), path.join(map, 'uit.jpg')],
      { timeout: 30000 }, () => {
        let uit = null;
        try {
          // Bij een bestand met meerdere beelden schrijft heif-convert 'uit-1.jpg' i.p.v. 'uit.jpg',
          // dus we kijken wat er ligt in plaats van de naam aan te nemen.
          const naam = fs.readdirSync(map).filter(n => n !== 'in.heic').sort()[0];
          if (naam) {
            const b = fs.readFileSync(path.join(map, naam));
            if (b.length > 2 && b[0] === 0xFF && b[1] === 0xD8) uit = b;   // echt een jpeg
          }
        } catch (e) {}
        opruimen(); klaar(uit);
      });
  });
}

// Een lege mime hoort erbij: bij een onbekend type levert FileReader `data:application/octet-stream`
// of zelfs `data:;base64,`, en dat is precies het geval waar HEIC in valt.
function ontleedDataUrl(dataUrl) {
  const m = /^data:([\w.+-]+\/[\w.+-]+)?;base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  let buf; try { buf = Buffer.from(m[2], 'base64'); } catch (e) { return null; }
  if (!buf.length) return null;
  return { mime: (m[1] || 'application/octet-stream').toLowerCase(), buf };
}

async function heicEruit(d) {
  if (!isHeic(d.buf)) return d;
  const jpeg = await heicNaarJpeg(d.buf);
  if (jpeg) return { mime: 'image/jpeg', buf: jpeg };
  console.error('heic: omzetten mislukt, origineel bewaard');
  return { mime: 'image/heic', buf: d.buf };
}

const BEELD_EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heic' };

function schrijfUpload(buf, ext, id, prefix) {
  const safeId = String(id).replace(/[^A-Za-z0-9._-]/g, '_');
  const dir = path.join(UPLOAD_DIR, safeId);
  fs.mkdirSync(dir, { recursive: true });
  const fname = prefix + '_' + crypto.randomBytes(6).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(dir, fname), buf);
  return '/uploads/' + safeId + '/' + fname;
}

async function saveDataUrl(dataUrl, id, prefix) {
  const d = ontleedDataUrl(dataUrl); if (!d) return null;
  const g = await heicEruit(d);
  const ext = BEELD_EXT[g.mime]; if (!ext) return null;    // alleen afbeeldingen, geen svg
  return schrijfUpload(g.buf, ext, id, prefix);
}

async function saveFile(dataUrl, id, prefix) {
  const d = ontleedDataUrl(dataUrl); if (!d) return null;
  const g = await heicEruit(d);
  const ext = g.mime === 'application/pdf' ? 'pdf' : BEELD_EXT[g.mime]; if (!ext) return null;
  return schrijfUpload(g.buf, ext, id, prefix);
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
  const [veh, todos, log, meta, runs] = await Promise.all([
    pool.query('SELECT id,status,klaar,route,owner,subtasks,photos,arrived_at,tax_at FROM vehicles ORDER BY sort_order NULLS LAST, id'),
    pool.query('SELECT id,text,owner,vehicle_id,done,created_at,done_at,done_by FROM global_todos ORDER BY id'),
    pool.query('SELECT ts,by_name,action,text,vehicle_id FROM activity_log ORDER BY id'),
    pool.query('SELECT key,value FROM meta'),
    pool.query('SELECT naam,ts,ok,melding,gelukt_ts FROM agent_runs')
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
    activityLog: log.rows.map(r => ({ ts: r.ts, by: r.by_name, action: r.action, text: r.text, vehicleId: r.vehicle_id })),
    // Hoe de achtergrondtaken erbij staan. Hoort hier omdat het scherm de plek is waar iemand het
    // ziet: als de Mobilox-agent al uren stilstaat, is de lijst met afleveringen ouder dan hij lijkt.
    agents: runs.rows.map(r => ({ naam: r.naam, ts: r.ts, ok: r.ok, melding: r.melding, geluktTs: r.gelukt_ts }))
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
// Vangrail tegen een massale wissing. De frontend stuurt bij elke opslag zijn hele geheugen op; is
// dat geheugen leeggelopen, dan wist één klik de administratie van álle auto's. Op 20-08-2026 gebeurde
// dat: 64 auto's verloren hun fase, foto's, subtaken en eigenaar doordat loadVehicles() ergens zonder
// loadState() werd aangeroepen. Die fout is gerepareerd, maar de server hoort er niet van afhankelijk
// te zijn dat de frontend het goed doet.
//
// De regel: een auto die in de database een traject heeft (klaar>0 of een route) en in deze opslag
// helemaal leeg terugkomt, telt als 'gewist'. Bij meer dan MAX_WISSEN daarvan tegelijk klopt er iets
// niet — dat is geen handeling die iemand met de hand doet — en schrijven we niets.
const MAX_WISSEN = 3;
async function controleerWissing(client, vs) {
  const ids = Object.keys(vs);
  if (!ids.length) return null;
  const { rows } = await client.query(
    'SELECT id, klaar, route FROM vehicles WHERE id = ANY($1) AND (klaar > 0 OR route IS NOT NULL)', [ids]);
  const gewist = rows.filter(r => {
    const v = vs[r.id] || {};
    return (Number(v.klaar) || 0) === 0 && !v.route;
  });
  return gewist.length > MAX_WISSEN ? gewist : null;
}

async function putState(b) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const vs = (b && b.vehicles) || {};
    const gewist = await controleerWissing(client, vs);
    if (gewist) {
      await client.query('ROLLBACK');
      console.error('putState GEWEIGERD: ' + gewist.length + ' auto\'s zouden hun traject verliezen ('
        + gewist.slice(0, 5).map(r => r.id).join(', ') + (gewist.length > 5 ? ', …' : '') + ')');
      const fout = new Error('geweigerd: dit zou het traject van ' + gewist.length + " auto's wissen");
      fout.code = 'wissing';
      throw fout;
    }
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
    pool.query('SELECT vehicle_id,url,name,ts,by_name,opname_datum,taxateur FROM bpm_reports ORDER BY id'),
    pool.query('SELECT vehicle_id,name,ts,by_name,seen FROM bpm_notifs ORDER BY id')
  ]);
  const vehicles = {};
  for (const r of rep.rows) { if (!vehicles[r.vehicle_id]) vehicles[r.vehicle_id] = []; vehicles[r.vehicle_id].push({ url: r.url, name: r.name, ts: r.ts, by: r.by_name, opname: r.opname_datum, taxateur: r.taxateur }); }
  return { vehicles, notifs: nf.rows.map(n => ({ id: n.vehicle_id, name: n.name, ts: n.ts, by: n.by_name, seen: n.seen })) };
}

// Het rapport uitlezen vóór het opslaan. Mislukt dat — geen pdftotext, een scan zonder tekstlaag,
// een ander formulier — dan gaat het uploaden gewoon door met lege velden. Zelfde regel als bij het
// verkleinen van foto's: een upload mag er nooit door verloren gaan.
async function leesRapport(dataUrl) {
  const leeg = { vin: null, opname: null, taxateur: null };
  if (!bpmlezen) return leeg;
  const m = /^data:([\w.+-]+\/[\w.+-]+)?;base64,(.+)$/.exec(dataUrl || '');
  if (!m || (m[1] || '').toLowerCase() !== 'application/pdf') return leeg;
  try { return await bpmlezen.lees(Buffer.from(m[2], 'base64')); }
  catch (e) { console.error('bpmlezen:', e.message); return leeg; }
}

// Rapport en melding horen bij elkaar: of allebei, of geen van beide. Anders krijgt het team een
// melding over een rapport dat er niet is, of andersom.
async function bewaarRapport(vehicleId, url, naam, u, gelezen) {
  const rec = { naam: String(naam || 'BPM-rapport').slice(0, 120), ts: Date.now(), door: u.n || u.u };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO bpm_reports (vehicle_id,url,name,ts,by_name,opname_datum,taxateur) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [vehicleId, url, rec.naam, rec.ts, rec.door, gelezen.opname || null, gelezen.taxateur || null]);
    await client.query('INSERT INTO bpm_notifs (vehicle_id,name,ts,by_name,seen) VALUES ($1,$2,$3,$4,false)',
      [vehicleId, rec.naam, rec.ts, rec.door]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
  return rec;
}

/* ===== Carport: werkbonnen en planning =====
   De deadline is de gewenste afleverdatum min CARPORT_MARGE_DAGEN, zodat de auto daarna nog naar de
   poetser kan. Eén plek, zodat die marge niet verspreid in de code komt te staan. */
const CARPORT_MARGE_DAGEN = 2;

function dagUitTekst(d) {                       // 'dd-mm-jjjj' -> epoch ms (UTC, begin van de dag)
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(d || ''));
  return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}
// Vandaag als 'dd-mm-jjjj', in Nederlandse tijd. De server draait op UTC; tussen middernacht en
// twee uur 's nachts zou dat anders de dag ervoor opleveren.
function vandaagTekst() {
  const d = new Date().toLocaleDateString('nl-NL', { timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric' });
  return d.replace(/\//g, '-');
}

function deadlineVan(afleverdatum) {
  const t = dagUitTekst(afleverdatum);
  return t === null ? null : t - CARPORT_MARGE_DAGEN * 86400000;
}

// Sorteren: een eigen volgorde van Carport gaat vóór, daarna op deadline. Een bon zonder
// afleverdatum zakt naar onderen — die kun je nog niet plannen, maar hij mag niet onzichtbaar zijn.
function sorteerBonnen(a, b) {
  if (a.volgorde !== null && b.volgorde !== null) return a.volgorde - b.volgorde;
  if (a.volgorde !== null) return -1;
  if (b.volgorde !== null) return 1;
  const da = deadlineVan(a.afleverdatum), db = deadlineVan(b.afleverdatum);
  if (da === null && db === null) return a.id - b.id;
  if (da === null) return 1;
  if (db === null) return -1;
  return da - db || a.id - b.id;
}

async function getCarport() {
  const [bon, taak] = await Promise.all([
    pool.query(`SELECT b.*, v.merk, v.model, v.kenteken, v.vin, v.kleur, v.km, v.uitv
                  FROM carport_bonnen b LEFT JOIN vehicles v ON v.id = b.vehicle_id`),
    pool.query('SELECT * FROM carport_taken ORDER BY id')
  ]);
  const perBon = {};
  for (const t of taak.rows) (perBon[t.bon_id] ||= []).push({
    id: t.id, soort: t.soort, tekst: t.tekst, door: t.door,
    klaar: t.klaar, klaarTs: t.klaar_ts, klaarDoor: t.klaar_door, ts: t.aangemaakt_ts });
  const maak = r => ({
    id: r.id, vehicleId: r.vehicle_id, afleverdatum: r.afleverdatum, deadline: deadlineVan(r.afleverdatum),
    volgorde: r.volgorde, status: r.status, klaarTs: r.klaar_ts, klaarDoor: r.klaar_door,
    afgeleverdTs: r.afgeleverd_ts, afgeleverdDoor: r.afgeleverd_door, afgeleverdDatum: r.afgeleverd_datum,
    ts: r.aangemaakt_ts, door: r.aangemaakt_door, notities: r.notities || [], taken: perBon[r.id] || [],
    auto: { merk: r.merk, model: r.model, kenteken: r.kenteken, vin: r.vin, kleur: r.kleur, km: r.km, uitv: r.uitv }
  });
  const alles = bon.rows.map(maak);
  const geleverd = b => b.afgeleverdTs !== null && b.afgeleverdTs !== undefined;
  return {
    marge: CARPORT_MARGE_DAGEN,
    // Drie bakken, want afmelden en afleveren zijn twee verschillende dingen:
    //   planning   — Carport is nog bezig
    //   afgemeld   — Carport is klaar, de auto moet nog de deur uit
    //   afgeleverd — de auto staat bij de klant; hier stopt het traject
    planning: alles.filter(b => b.status === 'open' && !geleverd(b)).sort(sorteerBonnen),
    afgemeld: alles.filter(b => b.status !== 'open' && !geleverd(b)).sort((a, b) => (b.klaarTs || 0) - (a.klaarTs || 0)),
    // Nieuwste bovenaan. Dit is het logboek waar beide partijen op terugkijken, dus er wordt niets
    // weggegooid — ook niet na een maand.
    afgeleverd: alles.filter(geleverd).sort((a, b) => (b.afgeleverdTs || 0) - (a.afgeleverdTs || 0))
  };
}

// Wie mag wat: Carport werkt de planning af en mag werk toevoegen; alleen Prieva zet een auto op de
// planning of haalt hem eraf.
const magCarport = u => u && (u.r === 'carport' || u.r === 'team' || u.r === 'admin');
const magPlannen = u => u && (u.r === 'team' || u.r === 'admin');

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
    if (url === '/api/state' && method === 'PUT') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' }); const b = await readBody(req); if (b === null) return sendJson(res, 400, { error: 'bad' });
      try { await putState(b); } catch (e) { if (e.code === 'wissing') return sendJson(res, 409, { error: 'wissing', melding: e.message }); throw e; }
      return sendJson(res, 200, { ok: true }); }
    if (url === '/api/photo' && method === 'POST') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' }); const b = await readBody(req) || {}; if (!b.id || !b.key || !b.dataUrl) return sendJson(res, 400, { error: 'missing' }); const up = await saveDataUrl(b.dataUrl, b.id, String(b.key).replace(/[^A-Za-z0-9._-]/g, '_')); if (!up) return sendJson(res, 400, { error: 'format' }); return sendJson(res, 200, { url: up }); }

    if (url === '/api/status' && method === 'GET') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); const r = await pool.query('SELECT id,status FROM vehicles ORDER BY sort_order NULLS LAST, id'); const out = {}; for (const row of r.rows) out[row.id] = { status: row.status }; return sendJson(res, 200, { vehicles: out }); }

    // Catalogus (dezelfde vorm als de lijst V in index.html). Sinds Fase 2 laadt de frontend hier
    // zijn auto's uit; de lijst in index.html is nog slechts terugval.
    if (url === '/api/vehicles' && method === 'GET') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      // Carport krijgt alleen de auto's die op hun eigen planning staan. Zelfde gedachte als bij de
      // taxateur: een afgeschermde rol hoort de catalogus niet te kunnen ophalen.
      const kolommen = 'id,vin,kenteken,merk,model,uitv,kleur,brandstof,transm,reg,km,inkoopdatum,lev,import_auto,batch,note,status,factuurnr,inkoopprijs,verkoopdatum,docs,autoboek_status,autoboek_rij,autoboek_fout,verkoop_factuurnr,verkoop_factuurdatum,verkoopprijs,verkocht_gemeld_ts,verkocht_bevestigd_door';
      const r = u.r === 'carport'
        ? await pool.query(`SELECT ${kolommen} FROM vehicles WHERE id IN (SELECT vehicle_id FROM carport_bonnen) ORDER BY sort_order NULLS LAST, id`)
        : await pool.query(`SELECT ${kolommen} FROM vehicles ORDER BY sort_order NULLS LAST, id`);
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
      // Twee manieren binnen, net als bij /api/verkocht: een ingelogde collega, of de koppeling met
      // het bearer-token. Bewust hetzelfde endpoint — een auto aanmaken hoort op één plek te
      // gebeuren, met dezelfde controles en dezelfde regel naar het Autoboek.
      const u = userFromReq(req);
      const viaApp = u && (u.r === 'team' || u.r === 'admin');
      if (!viaApp) {
        const token = (process.env.PVP_VERKOOP_TOKEN || '').trim();
        if (!token) return sendJson(res, u ? 403 : 401, { error: u ? 'forbidden' : 'auth' });
        const kop = String(req.headers.authorization || '');
        const gegeven = kop.startsWith('Bearer ') ? kop.slice(7).trim() : '';
        const a = Buffer.from(gegeven), bb = Buffer.from(token);
        if (a.length !== bb.length || !crypto.timingSafeEqual(a, bb)) return sendJson(res, u ? 403 : 401, { error: u ? 'forbidden' : 'auth' });
      }
      const b = await readBody(req) || {};
      const tekst = x => { const s = (x === undefined || x === null) ? '' : String(x).trim(); return s === '' ? null : s; };
      const vin = tekst(b.vin), kent = tekst(b.kenteken);
      // De sleutel is de VIN bij import en anders het kenteken — precies zoals de bestaande rijen.
      const id = vin || kent;
      if (!id) return sendJson(res, 400, { error: 'geen vin of kenteken' });
      // Zoeken op de genormaliseerde vorm en niet alleen op het id: Mobilox schrijft een kenteken
      // zonder streepjes, PVP mét. Op het oog verschillende sleutels, dezelfde auto — en een dubbele
      // regel in de catalogus werkt door naar het Autoboek en naar de rapportage.
      const platVin = String(vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const platKent = String(kent || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const bestaat = await pool.query(
        `SELECT id FROM vehicles WHERE id=$1
            OR ($2 <> '' AND upper(regexp_replace(coalesce(vin,''),      '[^A-Za-z0-9]', '', 'g')) = $2)
            OR ($3 <> '' AND upper(regexp_replace(coalesce(kenteken,''), '[^A-Za-z0-9]', '', 'g')) = $3)
          LIMIT 1`, [id, platVin, platKent]);
      if (bestaat.rowCount) return sendJson(res, 409, { error: 'bestaat al', id: bestaat.rows[0].id });
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

    // Een bestaande auto corrigeren. Tot 23-08-2026 kon dat alleen in de database, terwijl PVP wél
    // het invoerpunt is — een tikfout in een kenteken werkte door naar het Autoboek en de rapportage.
    //
    // Het ID verandert nooit. Dat is de sleutel waar werkbonnen, taxatierapporten, to-do's, garantie-
    // gevallen en verkoopmeldingen aan hangen; hem meeveranderen zou al die verwijzingen moeten
    // bijwerken, en één vergeten tabel is een auto die stilletjes zijn geschiedenis kwijt is. Het VIN
    // en het kenteken zijn dus gewoon te corrigeren, de sleutel blijft wat hij was.
    if (url === '/api/vehicle' && method === 'PUT') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
      const b = await readBody(req) || {};
      if (!b.id) return sendJson(res, 400, { error: 'missing' });
      const r0 = await pool.query('SELECT * FROM vehicles WHERE id=$1', [b.id]);
      if (!r0.rowCount) return sendJson(res, 404, { error: 'onbekende auto' });
      const oud = r0.rows[0];

      const tekst = x => { const t = (x === undefined || x === null) ? '' : String(x).trim(); return t === '' ? null : t; };
      const getal = x => { if (x === undefined || x === null || String(x).trim() === '') return null; const n = bedrag(x); return Number.isFinite(n) ? n : NaN; };
      // Niet alleen de vorm maar ook of de dag bestaat: 31-31-2026 heeft de goede vorm en is geen datum.
      const datum = x => {
        const t = tekst(x); if (t === null) return null;
        const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t); if (!m) return NaN;
        const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
        return (d.getUTCDate() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCFullYear() === +m[3]) ? t : NaN;
      };

      // Wat mag er gewijzigd worden. Alles wat hier niet staat is procesgegeven (status, fase, foto's,
      // eigenaar, verkoopvelden) en hoort via zijn eigen weg te lopen, niet via een correctieformulier.
      const VELDEN = {
        vin: tekst, kenteken: tekst, merk: tekst, model: tekst, uitv: tekst, kleur: tekst,
        brandstof: tekst, transm: tekst, reg: datum, km: getal, inkoopdatum: datum, lev: tekst,
        batch: tekst, note: tekst, factuurnr: tekst, inkoopprijs: getal,
      };
      const KOLOM = { importAuto: 'import_auto' };
      const nieuw = {}, fouten = [];
      for (const [veld, omzet] of Object.entries(VELDEN)) {
        if (!Object.prototype.hasOwnProperty.call(b, veld)) continue;
        const w = omzet(b[veld]);
        if (Number.isNaN(w)) { fouten.push(veld); continue; }
        nieuw[veld] = w;
      }
      if (Object.prototype.hasOwnProperty.call(b, 'importAuto')) nieuw.importAuto = b.importAuto === true;
      if (fouten.length) return sendJson(res, 400, { error: 'ongeldige waarde', velden: fouten });

      const naVin = Object.prototype.hasOwnProperty.call(nieuw, 'vin') ? nieuw.vin : oud.vin;
      const naKent = Object.prototype.hasOwnProperty.call(nieuw, 'kenteken') ? nieuw.kenteken : oud.kenteken;
      const plat = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!plat(naVin) && !plat(naKent)) return sendJson(res, 400, { error: 'een auto moet een VIN of een kenteken houden' });
      // Zelfde controle als bij het aanmaken: op de genormaliseerde vorm, en tegen de ándere auto's.
      const bots = await pool.query(
        `SELECT id FROM vehicles WHERE id <> $1
            AND ( ($2 <> '' AND upper(regexp_replace(coalesce(vin,''),      '[^A-Za-z0-9]', '', 'g')) = $2)
               OR ($3 <> '' AND upper(regexp_replace(coalesce(kenteken,''), '[^A-Za-z0-9]', '', 'g')) = $3) )
          LIMIT 1`, [oud.id, plat(naVin), plat(naKent)]);
      if (bots.rowCount) return sendJson(res, 409, { error: 'een andere auto heeft dit VIN of kenteken al', id: bots.rows[0].id });

      // Alleen wat écht verandert. Zo blijft in het Autoboek staan wat niemand heeft aangeraakt.
      const gewijzigd = {};
      for (const [veld, w] of Object.entries(nieuw)) {
        const kol = KOLOM[veld] || veld;
        const was = oud[kol];
        const gelijk = (was === null || was === undefined ? null : (typeof w === 'number' ? Number(was) : String(was)))
                     === (w === null ? null : (typeof w === 'number' ? Number(w) : String(w)));
        if (!gelijk) gewijzigd[veld] = w;
      }
      if (!Object.keys(gewijzigd).length) return sendJson(res, 200, { ok: true, id: oud.id, gewijzigd: [], autoboek: { status: 'overgeslagen' } });

      const zetten = Object.keys(gewijzigd).map((veld, i) => `${KOLOM[veld] || veld}=$${i + 2}`);
      await pool.query(`UPDATE vehicles SET ${zetten.join(', ')}, updated_at=now() WHERE id=$1`,
        [oud.id, ...Object.keys(gewijzigd).map(v => gewijzigd[v])]);
      console.log('auto gewijzigd:', oud.id, 'door', u.u, '->', Object.keys(gewijzigd).join(', '));

      // Het Autoboek is een aparte stap en mag de correctie in PVP nooit tegenhouden. Mislukt hij, dan
      // staat dat bij de auto en is hij opnieuw te proberen — zelfde patroon als bij het aanmaken.
      let ab = { status: 'uit', rij: null, fout: null };
      if (autoboek && autoboek.aan()) {
        try {
          const uit = await autoboek.wijzigAuto({ vin: oud.vin, kenteken: oud.kenteken }, gewijzigd);
          ab = { status: uit.status, rij: uit.rij, blad: uit.blad, kolommen: uit.kolommen, fout: null };
          if (uit.status === 'ok') await pool.query('UPDATE vehicles SET autoboek_status=$2, autoboek_rij=$3, autoboek_ts=$4, autoboek_fout=NULL WHERE id=$1',
            [oud.id, 'ok', uit.rij, Date.now()]);
        } catch (e) {
          console.error('autoboek wijzigen:', oud.id, e.message);
          ab = { status: 'fout', rij: null, fout: String(e.message).slice(0, 400) };
          await pool.query('UPDATE vehicles SET autoboek_status=$2, autoboek_ts=$3, autoboek_fout=$4 WHERE id=$1',
            [oud.id, 'fout', Date.now(), ab.fout]);
        }
      }
      return sendJson(res, 200, { ok: true, id: oud.id, gewijzigd: Object.keys(gewijzigd), autoboek: ab });
    }

    /* ===== Inruilauto's uit Mobilox =====
       De agent legt elke inruil vast die hij tegenkomt. Sinds 23-08 maakt hij een nieuwe inruil zelf
       aan bij Komende, maar de 128 regels van vóór die datum liggen er nog — en een enkele mislukt.
       Zonder scherm zaten die in een tabel waar niemand bij kon. */
    if (url === '/api/inruil' && method === 'GET') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
      const { rows } = await pool.query(
        `SELECT i.id, i.extern_id, i.vin, i.kenteken, i.omschrijving, i.prijs, i.km, i.bpm,
                i.status, i.pvp_id, i.melding, i.gezien_ts,
                v.merk, v.model, v.status AS auto_status
           FROM mobilox_inruil i
           LEFT JOIN vehicles v ON v.id = i.pvp_id
          ORDER BY i.gezien_ts DESC NULLS LAST, i.id DESC`);
      // Staat de auto inmiddels toch in PVP, ook al is deze regel nooit overgenomen? Dan is er niets
      // te doen. Op het kenteken zoeken, genormaliseerd — Mobilox schrijft het zonder streepjes.
      const { rows: bekend } = await pool.query(
        `SELECT id, upper(regexp_replace(coalesce(kenteken,''), '[^A-Za-z0-9]', '', 'g')) k FROM vehicles`);
      const perKent = new Map(bekend.filter(r => r.k).map(r => [r.k, r.id]));
      return sendJson(res, 200, { gevallen: rows.map(r => {
        const plat = String(r.kenteken || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const alIn = r.pvp_id || perKent.get(plat) || null;
        return { id: r.id, externId: r.extern_id, vin: r.vin, kenteken: r.kenteken, omschrijving: r.omschrijving,
          prijs: r.prijs === null ? null : Number(r.prijs), km: r.km, bpm: r.bpm === null ? null : Number(r.bpm),
          status: r.status, melding: r.melding, ts: r.gezien_ts, pvpId: alIn,
          auto: alIn ? { merk: r.merk, model: r.model, status: r.auto_status } : null };
      }) });
    }

    if (url === '/api/inruil' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
      const b = await readBody(req) || {};
      const acties = { overgenomen: 'overgenomen', genegeerd: 'genegeerd', voorstel: 'voorstel' };
      if (!b.id || !acties[b.actie]) return sendJson(res, 400, { error: 'missing' });
      const r = await pool.query(
        'UPDATE mobilox_inruil SET status=$2, pvp_id=COALESCE($3, pvp_id) WHERE id=$1 RETURNING id',
        [b.id, acties[b.actie], b.pvpId || null]);
      if (!r.rowCount) return sendJson(res, 404, { error: 'onbekende regel' });
      console.log('inruil:', u.u, acties[b.actie], b.id, b.pvpId || '');
      return sendJson(res, 200, { ok: true });
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

      // Definitief: de melder zegt dat dit een FACTUUR is, en dan is de verkoop een feit — de auto
      // gaat meteen op 'verkocht' en de regel verhuist in het Autoboek van Lopende naar Verkochte.
      // Een verkoopovereenkomst doet dit niet: die kan nog wijzigen of vervallen, dus die blijft
      // 'gemeld verkocht' tot er een factuur of een beheerder achteraan komt.
      //
      // Terugdraaien kan met /api/verkoop-terug (alleen admin), dat de regel ook in het boek terugzet.
      const definitief = body.definitief === true;
      // Bevestigen blijft voorbehouden aan een beheerder of aan de koppeling met een token. Een
      // gewone collega die in de app op "Verkocht melden" drukt, meldt — bevestigen is een andere
      // handeling, met een andere verantwoordelijkheid.
      if (definitief && viaApp && sessie.r !== 'admin') {
        await spoor(v.id, 'geweigerd');
        return sendJson(res, 403, { error: 'alleen een beheerder of de koppeling kan een verkoop bevestigen' });
      }
      const bevestig = async (nietOpnieuwNaarBoek) => {
        if (v.status !== 'verkocht') {
          await pool.query(`UPDATE vehicles SET status='verkocht', verkocht_bevestigd_ts=$2,
                              verkocht_bevestigd_door=$3, updated_at=now() WHERE id=$1`,
            [v.id, Date.now(), tekst(body.bron) || (viaApp ? 'app: ' + (sessie.u || '?') : 'melding met token')]);
        }
        // Nooit twee keer verplaatsen: staat de auto al op 'verkocht', dan staat zijn regel al op
        // het blad Verkochte en zou een tweede poging hem daar niet meer vinden — of erger, een
        // tweede regel opleveren.
        return nietOpnieuwNaarBoek ? { status: 'overgeslagen', rij: null, fout: null } : await verkoopNaarAutoboek(v.id);
      };

      // Idempotent: dezelfde melding nog eens is goed, een andere melding op dezelfde auto niet.
      if (v.status === 'gemeld verkocht' || v.status === 'verkocht') {
        if ((v.verkoop_factuurnr || '') === factuurnr) {
          // Zelfde nummer, maar nu als factuur: dan is dit de bevestiging die er nog niet was.
          if (definitief && v.status === 'gemeld verkocht') {
            const ab = await bevestig(false);
            await spoor(v.id, 'bevestigd');
            console.log('verkoop bevestigd:', v.id, 'factuur', factuurnr);
            return sendJson(res, 200, { ok: true, bevestigd: true, id: v.id, status: 'verkocht', autoboek: ab });
          }
          await spoor(v.id, 'ongewijzigd');
          return sendJson(res, 200, { ok: true, ongewijzigd: true, id: v.id, status: v.status });
        }
        // Een factuur volgt op een verkoopovereenkomst en draagt het definitieve nummer. Zolang de
        // verkoop nog niet bevestigd is, mag die de eerdere melding vervangen — maar alleen als de
        // melder dat uitdrukkelijk zegt (vervangt:true), zodat het geen stille overschrijving is.
        // Een BEVESTIGDE verkoop blijft geweigerd: die regel staat al in het Autoboek met dit
        // nummer, en PVP en het boek uit elkaar laten lopen is erger dan een verouderd nummer.
        if (v.status === 'gemeld verkocht' && body.vervangt === true) {
          await pool.query(`UPDATE vehicles SET verkoop_factuurnr=$2, verkoop_factuurdatum=coalesce($3,verkoop_factuurdatum),
                              verkoopprijs=coalesce($4,verkoopprijs), verkocht_gemeld_ts=$5 WHERE id=$1`,
            [v.id, factuurnr, factuurdatum, Number.isFinite(prijs) ? prijs : null, Date.now()]);
          // Eerst het nummer bijwerken, dán bevestigen: het Autoboek leest die velden uit de database,
          // dus andersom zou het definitieve factuurnummer net te laat komen.
          const ab = definitief ? await bevestig(false) : null;
          await spoor(v.id, definitief ? 'vervangen en bevestigd' : 'vervangen');
          return sendJson(res, 200, { ok: true, vervangen: true, bevestigd: definitief, id: v.id,
            status: definitief ? 'verkocht' : v.status, was: v.verkoop_factuurnr, autoboek: ab });
        }
        await spoor(v.id, 'conflict');
        return sendJson(res, 409, { error: 'auto staat al op een andere verkoop', id: v.id, status: v.status, bestaand: v.verkoop_factuurnr, gemeld: factuurnr });
      }

      await pool.query(
        `UPDATE vehicles SET status='gemeld verkocht', verkoop_factuurnr=$2, verkoop_factuurdatum=$3,
                verkoopprijs=$4, verkocht_gemeld_ts=$5, updated_at=now() WHERE id=$1`,
        [v.id, factuurnr, factuurdatum, prijs, Date.now()]);
      if (definitief) {
        const ab = await bevestig(false);
        await spoor(v.id, 'gemeld en bevestigd');
        console.log('verkoop gemeld en bevestigd:', v.id, 'factuur', factuurnr);
        return sendJson(res, 200, { ok: true, bevestigd: true, id: v.id, status: 'verkocht', autoboek: ab });
      }
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
      // De stukken komen hier rechtstreeks uit de browser, niet van schijf, dus de omzetting bij het
      // opslaan helpt hier niet. Een HEIC-bestand kent de Claude API niet en zou stil overgeslagen
      // worden — precies het geval van een foto van een kentekenbewijs, gemaakt met een iPhone.
      const docs = [];
      for (const doc of b.docs) {
        const d = ontleedDataUrl(doc && doc.dataUrl);
        if (d && isHeic(d.buf)) {
          const g = await heicEruit(d);
          if (g.mime === 'image/jpeg') {
            docs.push({ name: String(doc.name || 'foto').replace(/\.hei[cf]$/i, '') + '.jpg',
                        dataUrl: 'data:image/jpeg;base64,' + g.buf.toString('base64') });
            continue;
          }
        }
        docs.push(doc);
      }
      try {
        const r = await uitlezen.lees(docs);
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
      const up = await saveFile(b.dataUrl, b.id, 'doc'); if (!up) return sendJson(res, 400, { error: 'format' });
      const naam = String(b.name || 'document').slice(0, 200);
      await pool.query(
        `INSERT INTO vehicles (id, docs) VALUES ($1, jsonb_build_array($2::jsonb))
         ON CONFLICT (id) DO UPDATE SET docs = vehicles.docs || jsonb_build_array($2::jsonb), updated_at=now()`,
        [b.id, JSON.stringify({ url: up, name: naam, ts: Date.now() })]);
      return sendJson(res, 200, { url: up });
    }

    if (url === '/api/adphotos' && method === 'GET') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); const r = await pool.query(`SELECT id, ad_photos FROM vehicles WHERE ad_photos <> '[]'::jsonb ORDER BY sort_order NULLS LAST, id`); const out = {}; for (const row of r.rows) out[row.id] = row.ad_photos; return sendJson(res, 200, out); }
    if (url === '/api/adphoto' && method === 'POST') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); const b = await readBody(req) || {}; if (!b.id || !b.dataUrl) return sendJson(res, 400, { error: 'missing' }); const up = await saveDataUrl(b.dataUrl, b.id, 'ad'); if (!up) return sendJson(res, 400, { error: 'format' }); await pool.query(`INSERT INTO vehicles (id, ad_photos) VALUES ($1, jsonb_build_array($2::text)) ON CONFLICT (id) DO UPDATE SET ad_photos = vehicles.ad_photos || jsonb_build_array($2::text), updated_at=now()`, [b.id, up]); return sendJson(res, 200, { url: up }); }
    if (url === '/api/adphotos-set' && method === 'POST') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); const b = await readBody(req) || {}; if (!b.id || !Array.isArray(b.urls)) return sendJson(res, 400, { error: 'missing' }); await pool.query(`INSERT INTO vehicles (id, ad_photos) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO UPDATE SET ad_photos=EXCLUDED.ad_photos, updated_at=now()`, [b.id, JSON.stringify(b.urls)]); return sendJson(res, 200, { ok: true }); }

    // Een auto met een kenteken is niet meer te taxeren: het kenteken bestaat pas na RDW-goedkeuring
    // en BIN, en dan is de BPM afgehandeld. Zulke auto's horen niet in de omgeving van de taxateur,
    // en ze gaan er ook niet meer naartoe. Alleen in beeld verbergen zou de foto's nog steeds over
    // de lijn sturen; een taxateur hoort de stukken van een afgeronde auto niet te kunnen ophalen.
    if (url === '/api/taxstate' && method === 'GET') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'taxateur' && u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
      const r = u.r === 'taxateur'
        ? await pool.query(`SELECT id,status,route,photos FROM vehicles
             WHERE status='lopende' AND route='JA'
               AND (kenteken IS NULL OR btrim(kenteken) IN ('', '-', '—'))
             ORDER BY sort_order NULLS LAST, id`)
        : await pool.query('SELECT id,status,route,photos FROM vehicles ORDER BY sort_order NULLS LAST, id');
      const out = {};
      for (const row of r.rows) out[row.id] = { status: row.status, route: row.route || null, photos: row.photos || {} };
      return sendJson(res, 200, { vehicles: out });
    }
    /* ===== Garantiegevallen ===== */
    if (url === '/api/garantie' && method === 'GET') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
      const r = await pool.query(`SELECT g.*, v.merk, v.model FROM garantie_gevallen g
                                   LEFT JOIN vehicles v ON v.id = g.vehicle_id ORDER BY g.id DESC`);
      return sendJson(res, 200, {
        gevallen: r.rows.map(x => ({
          id: x.id, vehicleId: x.vehicle_id, kenteken: x.kenteken, omschrijving: x.omschrijving,
          melding: x.melding, status: x.status, owner: x.owner, ts: x.aangemaakt_ts, door: x.aangemaakt_door,
          afTs: x.afgehandeld_ts, afDoor: x.afgehandeld_door, notities: x.notities || [],
          auto: x.merk ? { merk: x.merk, model: x.model } : null }))
      });
    }

    if (url === '/api/garantie' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
      const b = await readBody(req) || {};

      if (b.actie === 'nieuw') {
        if (!String(b.omschrijving || '').trim()) return sendJson(res, 400, { error: 'missing', melding: 'omschrijving is verplicht' });
        const kent = String(b.kenteken || '').toUpperCase().trim() || null;
        // De auto erbij zoeken op kenteken of VIN, maar niet eisen: een garantiegeval gaat vaak over
        // een auto die allang verkocht is en niet meer in de lijst staat.
        let vid = null;
        if (kent) {
          const sleutel = kent.replace(/[^A-Z0-9]/g, '');
          const r = await pool.query(`SELECT id FROM vehicles WHERE upper(regexp_replace(coalesce(kenteken,''),'[^A-Za-z0-9]','','g'))=$1 OR upper(id)=$1`, [sleutel]);
          if (r.rows.length) vid = r.rows[0].id;
        }
        const r = await pool.query(
          `INSERT INTO garantie_gevallen (vehicle_id,kenteken,omschrijving,melding,owner,aangemaakt_ts,aangemaakt_door)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [vid, kent, String(b.omschrijving).trim().slice(0, 500), String(b.melding || '').slice(0, 20000) || null,
           b.owner || null, Date.now(), u.n || u.u]);
        console.log('garantie:', u.u, 'nieuw geval', r.rows[0].id, kent || '(geen kenteken)', vid ? '-> ' + vid : '(auto niet gevonden)');
        return sendJson(res, 200, { ok: true, id: r.rows[0].id, gekoppeld: !!vid });
      }
      if (!b.id) return sendJson(res, 400, { error: 'missing' });
      if (b.actie === 'toewijzen') {
        await pool.query('UPDATE garantie_gevallen SET owner=$2, updated_at=now() WHERE id=$1', [b.id, b.owner || null]);
        return sendJson(res, 200, { ok: true });
      }
      if (b.actie === 'afhandelen') {
        const af = b.af !== false;
        await pool.query(`UPDATE garantie_gevallen SET status=$2, afgehandeld_ts=$3, afgehandeld_door=$4, updated_at=now() WHERE id=$1`,
          [b.id, af ? 'afgehandeld' : 'open', af ? Date.now() : null, af ? (u.n || u.u) : null]);
        return sendJson(res, 200, { ok: true });
      }
      if (b.actie === 'notitie') {
        if (!String(b.tekst || '').trim()) return sendJson(res, 400, { error: 'missing' });
        const n = { ts: Date.now(), door: u.n || u.u, tekst: String(b.tekst).trim().slice(0, 2000) };
        await pool.query('UPDATE garantie_gevallen SET notities = notities || $2::jsonb, updated_at=now() WHERE id=$1',
          [b.id, JSON.stringify([n])]);
        return sendJson(res, 200, { ok: true, notitie: n });
      }
      if (b.actie === 'weg') {
        if (u.r !== 'admin') return sendJson(res, 403, { error: 'alleen admin' });
        await pool.query('DELETE FROM garantie_gevallen WHERE id=$1', [b.id]);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 400, { error: 'actie' });
    }

    /* ===== Carport ===== */
    if (url === '/api/carport' && method === 'GET') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (!magCarport(u)) return sendJson(res, 403, { error: 'forbidden' });
      return sendJson(res, 200, await getCarport());
    }

    // Auto op de planning zetten of de afleverdatum wijzigen. Alleen Prieva.
    if (url === '/api/carport-bon' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (!magPlannen(u)) return sendJson(res, 403, { error: 'forbidden' });
      const b = await readBody(req) || {};
      const datum = b.afleverdatum ? String(b.afleverdatum).trim() : null;
      if (datum && dagUitTekst(datum) === null) return sendJson(res, 400, { error: 'datum', melding: 'afleverdatum moet dd-mm-jjjj zijn' });
      if (b.id) {
        await pool.query('UPDATE carport_bonnen SET afleverdatum=$2, updated_at=now() WHERE id=$1', [b.id, datum]);
        return sendJson(res, 200, { ok: true, id: Number(b.id) });
      }
      if (!b.vehicleId) return sendJson(res, 400, { error: 'missing' });
      const auto = await pool.query('SELECT id FROM vehicles WHERE id=$1', [b.vehicleId]);
      if (!auto.rows.length) return sendJson(res, 404, { error: 'onbekende auto' });
      const al = await pool.query("SELECT id FROM carport_bonnen WHERE vehicle_id=$1 AND status='open'", [b.vehicleId]);
      if (al.rows.length) return sendJson(res, 200, { ok: true, id: al.rows[0].id, alGepland: true });
      const r = await pool.query(
        `INSERT INTO carport_bonnen (vehicle_id, afleverdatum, aangemaakt_ts, aangemaakt_door)
         VALUES ($1,$2,$3,$4) RETURNING id`, [b.vehicleId, datum, Date.now(), u.n || u.u]);
      return sendJson(res, 200, { ok: true, id: r.rows[0].id });
    }

    // Een regel op de bon: toevoegen, afvinken of weghalen. Carport mag dit ook — zij vinden
    // onderweg werk dat niet op de bon stond.
    if (url === '/api/carport-taak' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (!magCarport(u)) return sendJson(res, 403, { error: 'forbidden' });
      const b = await readBody(req) || {};
      const wie = u.r === 'carport' ? 'carport' : 'prieva';
      if (b.actie === 'toevoegen') {
        if (!b.bonId || !String(b.tekst || '').trim()) return sendJson(res, 400, { error: 'missing' });
        const soort = ['reparatie', 'apk', 'beurt', 'onderdeel', 'poetsen'].includes(b.soort) ? b.soort : 'reparatie';
        const r = await pool.query(
          `INSERT INTO carport_taken (bon_id, soort, tekst, door, aangemaakt_ts) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [b.bonId, soort, String(b.tekst).trim().slice(0, 400), wie, Date.now()]);
        return sendJson(res, 200, { ok: true, id: r.rows[0].id });
      }
      if (b.actie === 'afvinken') {
        if (!b.id) return sendJson(res, 400, { error: 'missing' });
        await pool.query('UPDATE carport_taken SET klaar=$2, klaar_ts=$3, klaar_door=$4 WHERE id=$1',
          [b.id, !!b.klaar, b.klaar ? Date.now() : null, b.klaar ? (u.n || u.u) : null]);
        return sendJson(res, 200, { ok: true });
      }
      if (b.actie === 'weg') {
        if (!b.id) return sendJson(res, 400, { error: 'missing' });
        // Alleen weghalen wat je zelf hebt gezet: Carport mag geen werk van Prieva laten verdwijnen.
        const r = await pool.query('SELECT door FROM carport_taken WHERE id=$1', [b.id]);
        if (!r.rows.length) return sendJson(res, 404, { error: 'onbekend' });
        if (u.r === 'carport' && r.rows[0].door !== 'carport') return sendJson(res, 403, { error: 'niet van jou' });
        await pool.query('DELETE FROM carport_taken WHERE id=$1', [b.id]);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 400, { error: 'actie' });
    }

    // Notitie erbij. 'technisch' is de onderbouwing van Carport, 'klant' de vertaling van Prieva.
    if (url === '/api/carport-notitie' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (!magCarport(u)) return sendJson(res, 403, { error: 'forbidden' });
      const b = await readBody(req) || {};
      if (!b.bonId || !String(b.tekst || '').trim()) return sendJson(res, 400, { error: 'missing' });
      // Een klantnotitie is een vertaling die Prieva maakt; Carport schrijft de techniek.
      const soort = u.r === 'carport' ? 'technisch' : (b.soort === 'technisch' ? 'technisch' : 'klant');
      const notitie = { ts: Date.now(), door: u.n || u.u, rol: u.r === 'carport' ? 'carport' : 'prieva',
                        soort, tekst: String(b.tekst).trim().slice(0, 2000) };
      const r = await pool.query(
        `UPDATE carport_bonnen SET notities = notities || $2::jsonb, updated_at=now() WHERE id=$1 RETURNING id`,
        [b.bonId, JSON.stringify([notitie])]);
      if (!r.rows.length) return sendJson(res, 404, { error: 'onbekende bon' });
      return sendJson(res, 200, { ok: true, notitie });
    }

    // Eigen volgorde van Carport. De hele lijst komt mee, zodat er geen gaten of dubbele nummers
    // kunnen ontstaan; een lege lijst zet alles terug op de deadlinevolgorde.
    if (url === '/api/carport-volgorde' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (!magCarport(u)) return sendJson(res, 403, { error: 'forbidden' });
      const b = await readBody(req) || {};
      if (!Array.isArray(b.ids)) return sendJson(res, 400, { error: 'missing' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (!b.ids.length) await client.query("UPDATE carport_bonnen SET volgorde=NULL WHERE status='open'");
        else for (let i = 0; i < b.ids.length; i++)
          await client.query('UPDATE carport_bonnen SET volgorde=$2, updated_at=now() WHERE id=$1', [b.ids[i], i]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
      finally { client.release(); }
      return sendJson(res, 200, { ok: true });
    }

    // Afmelden als de auto klaarstaat — door Carport of door Prieva. Terugzetten kan ook, want een
    // vergissing hier laat een auto uit de planning verdwijnen.
    if (url === '/api/carport-klaar' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (!magCarport(u)) return sendJson(res, 403, { error: 'forbidden' });
      const b = await readBody(req) || {};
      if (!b.id) return sendJson(res, 400, { error: 'missing' });
      const klaar = b.klaar !== false;
      const r = await pool.query(
        `UPDATE carport_bonnen SET status=$2, klaar_ts=$3, klaar_door=$4, volgorde=NULL, updated_at=now()
         WHERE id=$1 RETURNING vehicle_id`,
        [b.id, klaar ? 'klaar' : 'open', klaar ? Date.now() : null, klaar ? (u.n || u.u) : null]);
      if (!r.rows.length) return sendJson(res, 404, { error: 'onbekende bon' });
      console.log('carport:', u.u, klaar ? 'afgemeld' : 'teruggezet', r.rows[0].vehicle_id);
      return sendJson(res, 200, { ok: true });
    }

    // Afgeleverd: de auto staat bij de klant. Bewust een andere handeling dan afmelden — Carport
    // meldt af als het werk klaar is, Prieva vinkt af als de auto de deur uit is. Daarom ook alleen
    // team en admin: Carport kan niet weten of de klant is geweest.
    if (url === '/api/carport-afgeleverd' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (!magPlannen(u)) return sendJson(res, 403, { error: 'alleen Prieva kan een auto afleveren' });
      const b = await readBody(req) || {};
      if (!b.id) return sendJson(res, 400, { error: 'missing' });
      const af = b.afgeleverd !== false;
      const datum = (b.datum && /^\d{2}-\d{2}-\d{4}$/.test(String(b.datum).trim())) ? String(b.datum).trim() : vandaagTekst();
      const r = await pool.query(
        `UPDATE carport_bonnen SET afgeleverd_ts=$2, afgeleverd_door=$3, afgeleverd_datum=$4,
                volgorde=NULL, updated_at=now() WHERE id=$1 RETURNING vehicle_id`,
        [b.id, af ? Date.now() : null, af ? (u.n || u.u) : null, af ? datum : null]);
      if (!r.rows.length) return sendJson(res, 404, { error: 'onbekende bon' });
      console.log('aflevering:', u.u, af ? 'afgeleverd ' + datum : 'teruggezet', r.rows[0].vehicle_id);
      return sendJson(res, 200, { ok: true, datum: af ? datum : null });
    }

    // De afleverdatum verzetten kan al via /api/carport-bon; dit endpoint gaat alleen over de
    // vraag of de auto de deur uit is.

    if (url === '/api/bpmreports' && method === 'GET') { const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' }); if (u.r === 'carport') return sendJson(res, 403, { error: 'forbidden' }); return sendJson(res, 200, await getBpm()); }
    // Eén rapport bij één auto (de bestaande weg: je zit al op de pagina van die auto).
    if (url === '/api/bpmreport' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'taxateur' && u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
      const b = await readBody(req) || {};
      if (!b.id || !b.dataUrl) return sendJson(res, 400, { error: 'missing' });
      const gelezen = await leesRapport(b.dataUrl);
      const up = await saveFile(b.dataUrl, b.id, 'bpm'); if (!up) return sendJson(res, 400, { error: 'format' });
      await bewaarRapport(b.id, up, b.name, u, gelezen);
      return sendJson(res, 200, { url: up, opname: gelezen.opname, vin: gelezen.vin });
    }

    // Sleepbak: één rapport zonder dat erbij staat over welke auto het gaat. PVP leest het VIN uit
    // veld 1a en zoekt de auto er zelf bij. De browser stuurt ze stuk voor stuk — zes rapporten van
    // 10 MB in één verzoek loopt tegen de 30 MB van nginx aan.
    if (url === '/api/bpmreport-sorteer' && method === 'POST') {
      const u = userFromReq(req); if (!u) return sendJson(res, 401, { error: 'auth' });
      if (u.r !== 'taxateur' && u.r !== 'team' && u.r !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
      if (!bpmlezen) return sendJson(res, 200, { uitkomst: 'onleesbaar', reden: 'rapporten uitlezen staat uit' });
      const b = await readBody(req) || {};
      if (!b.dataUrl) return sendJson(res, 400, { error: 'missing' });
      const naam = String(b.name || 'BPM-rapport').slice(0, 120);
      const gelezen = await leesRapport(b.dataUrl);
      if (!gelezen.vin) {
        console.log('bpm-sorteer:', u.u, naam, '-> geen VIN gevonden');
        return sendJson(res, 200, { uitkomst: 'geen-vin', naam });
      }
      const sleutel = gelezen.vin.toUpperCase();
      const r = await pool.query('SELECT id, merk, model, kenteken FROM vehicles WHERE upper(id)=$1 OR upper(vin)=$1', [sleutel]);
      if (!r.rows.length) {
        console.log('bpm-sorteer:', u.u, naam, '-> VIN', sleutel, 'onbekend in PVP');
        return sendJson(res, 200, { uitkomst: 'onbekende-auto', naam, vin: gelezen.vin });
      }
      const v = r.rows[0];
      // Bewust géén controle op status of route: een rapport dat binnenkomt hoort bij de auto waar
      // het VIN naar wijst, ook als iemand de route intussen op NEE heeft gezet. Weigeren zou het
      // rapport laten verdwijnen en dat is erger dan een rapport bij een auto die het niet verwachtte.
      const up = await saveFile(b.dataUrl, v.id, 'bpm'); if (!up) return sendJson(res, 400, { error: 'format' });
      await bewaarRapport(v.id, up, naam, u, gelezen);
      console.log('bpm-sorteer:', u.u, naam, '->', v.id, gelezen.opname ? '| opname ' + gelezen.opname : '| GEEN opnamedatum');
      return sendJson(res, 200, { uitkomst: 'geplaatst', naam, vin: gelezen.vin, opname: gelezen.opname,
        auto: { id: v.id, merk: v.merk, model: v.model, kenteken: v.kenteken }, url: up });
    }

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
// Bij het opstarten één keer nagaan of heif-convert er is. Ontbreekt het — bijvoorbeeld op een
// verse server waar libheif-examples en libheif-plugin-libde265 nog niet geïnstalleerd zijn — dan
// vallen HEIC-uploads terug op het oude gedrag: onzichtbaar in Chrome en overgeslagen bij het
// uitlezen. Dat is precies het soort stille terugval waar niemand aan denkt, dus staat het in het log.
execFile('pdftotext', ['-v'], { timeout: 5000 }, err => {
  if (err) console.error('LET OP: pdftotext ontbreekt — taxatierapporten worden niet uitgelezen, dus '
    + 'geen automatisch sorteren en geen geldigheidsteller. Herstellen met: apt-get install -y poppler-utils');
});
execFile('heif-convert', ['--version'], { timeout: 5000 }, err => {
  if (err) console.error('LET OP: heif-convert ontbreekt — HEIC-foto\'s (Mac, iPhone) worden niet omgezet. '
    + 'Herstellen met: apt-get install -y libheif-examples libheif-plugin-libde265');
});

server.listen(PORT, '127.0.0.1', () => console.log('PVP API (node + postgres) op 127.0.0.1:' + PORT));
