// Eenmalig: foto's die als base64 data-URL in `vehicles.photos` staan alsnog als bestand wegschrijven.
//
//   node inhaalslag/base64-fotos-omzetten.js            proefdraai — toont alleen wat er zou gebeuren
//   node inhaalslag/base64-fotos-omzetten.js --echt     voert het uit
//
// Hoe ze daar terechtkwamen: `setPhotoData()` in index.html zette de data-URL eerst in beeld (voor de
// directe preview) en verving hem pas door het pad ná een geslaagde upload. Mislukte die upload, dan
// bleef de base64 in het geheugen staan en schreef de eerstvolgende PUT /api/state hem de database in
// — stilzwijgend. Dat is nu aan beide kanten dicht: de frontend zet de foto terug en meldt het, en
// putState weigert een data:-waarde. Dit script ruimt op wat er al lag.
//
// De omzetting spiegelt saveDataUrl() in server.js, inclusief HEIC->JPEG via heif-convert. Bewust
// een kopie en geen gedeelde module: dit is eenmalig werk in inhaalslag/, en de live uploadweg
// verbouwen voor vier foto's is meer risico dan het waard is.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const pg = require('/opt/pvp-api/node_modules/pg');

const ECHT = process.argv.includes('--echt');
const UPLOAD_DIR = path.join(process.env.PVP_DATA || '/var/pvp', 'uploads');
const HEIC_KWALITEIT = 90;
const BEELD_EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
                    'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heic' };

function ontleedDataUrl(dataUrl) {
  const m = /^data:([\w.+-]+\/[\w.+-]+)?;base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  let buf; try { buf = Buffer.from(m[2], 'base64'); } catch (e) { return null; }
  if (!buf.length) return null;
  return { mime: (m[1] || 'application/octet-stream').toLowerCase(), buf };
}
function isHeic(buf) {
  if (!buf || buf.length < 12) return false;
  if (buf.toString('latin1', 4, 8) !== 'ftyp') return false;
  return ['heic','heix','heim','heis','hevc','hevx','mif1','msf1','heif'].includes(buf.toString('latin1', 8, 12));
}
function heicNaarJpeg(buf) {
  return new Promise(klaar => {
    let map = null;
    const opruimen = () => { if (map) { try { fs.rmSync(map, { recursive: true, force: true }); } catch (e) {} } };
    try { map = fs.mkdtempSync(path.join(os.tmpdir(), 'pvp-heic-')); fs.writeFileSync(path.join(map, 'in.heic'), buf); }
    catch (e) { opruimen(); return klaar(null); }
    execFile('heif-convert', ['-q', String(HEIC_KWALITEIT), path.join(map, 'in.heic'), path.join(map, 'uit.jpg')],
      { timeout: 30000 }, () => {
        let uit = null;
        try {
          const naam = fs.readdirSync(map).filter(n => n !== 'in.heic').sort()[0];
          if (naam) { const b = fs.readFileSync(path.join(map, naam)); if (b.length > 2 && b[0] === 0xFF && b[1] === 0xD8) uit = b; }
        } catch (e) {}
        opruimen(); klaar(uit);
      });
  });
}
function schrijfUpload(buf, ext, id, prefix) {
  const safeId = String(id).replace(/[^A-Za-z0-9._-]/g, '_');
  const dir = path.join(UPLOAD_DIR, safeId);
  fs.mkdirSync(dir, { recursive: true });
  const fname = prefix + '_' + crypto.randomBytes(6).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(dir, fname), buf);
  return '/uploads/' + safeId + '/' + fname;
}

(async () => {
  if (!process.env.PVP_PG) { console.error('PVP_PG ontbreekt.'); process.exit(1); }
  const pool = new pg.Pool({ connectionString: process.env.PVP_PG });
  const { rows } = await pool.query(
    `SELECT id, key, value FROM vehicles, jsonb_each_text(photos) WHERE value LIKE 'data:%' ORDER BY id, key`);
  console.log((ECHT ? 'UITGEVOERD' : 'PROEFDRAAI (niets geschreven)') + ` — ${rows.length} foto('s) in de database:`);
  let goed = 0, mis = 0;
  for (const r of rows) {
    const d = ontleedDataUrl(r.value);
    if (!d) { console.log(`  ${r.id} ${r.key}: onleesbare data-URL — overgeslagen`); mis++; continue; }
    let mime = d.mime, buf = d.buf, omgezet = '';
    if (isHeic(buf)) {
      const jpeg = await heicNaarJpeg(buf);
      if (jpeg) { mime = 'image/jpeg'; buf = jpeg; omgezet = ' (heic -> jpeg)'; }
      else { mime = 'image/heic'; omgezet = ' (heic, omzetten mislukt — origineel bewaard)'; }
    }
    const ext = BEELD_EXT[mime];
    if (!ext) { console.log(`  ${r.id} ${r.key}: onbekend type ${mime} — overgeslagen`); mis++; continue; }
    const kb = Math.round(buf.length / 1024);
    if (!ECHT) { console.log(`  ${r.id} ${r.key}: ${mime}, ${kb} kB${omgezet}`); goed++; continue; }
    const url = schrijfUpload(buf, ext, r.id, String(r.key).replace(/[^A-Za-z0-9._-]/g, '_'));
    // Alleen vervangen als er nog steeds diezelfde data-URL staat: anders overschrijf je een foto
    // die iemand intussen opnieuw heeft geüpload.
    const up = await pool.query(
      `UPDATE vehicles SET photos = jsonb_set(photos, ARRAY[$2::text], to_jsonb($3::text)), updated_at=now()
        WHERE id=$1 AND photos->>$2 = $4`, [r.id, r.key, url, r.value]);
    if (up.rowCount) { console.log(`  ${r.id} ${r.key}: ${kb} kB${omgezet} -> ${url}`); goed++; }
    else { console.log(`  ${r.id} ${r.key}: intussen gewijzigd — niets gedaan, bestand blijft als wees liggen`); mis++; }
  }
  console.log(`  klaar: ${goed} omgezet, ${mis} overgeslagen`);
  if (ECHT) {
    const n = await pool.query(`SELECT count(*)::int AS n FROM vehicles, jsonb_each_text(photos) WHERE value LIKE 'data:%'`);
    console.log(`  nog in de database als base64: ${n.rows[0].n}`);
  }
  await pool.end();
})().catch(e => { console.error('FOUT:', e.message); process.exit(1); });
