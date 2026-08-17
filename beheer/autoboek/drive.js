// Google Drive vanaf de server, puur Node — geen npm-pakket. Een service account logt in met een
// zelf ondertekend JWT (RS256), en dat kan de ingebouwde crypto-module prima.
const fs = require('fs');
const crypto = require('crypto');

const SLEUTEL = process.env.AUTOBOEK_SLEUTEL || '/var/pvp/autoboek-sleutel.json';
const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function token(scope) {
  const k = JSON.parse(fs.readFileSync(SLEUTEL, 'utf8'));
  const nu = Math.floor(Date.now() / 1000);
  const kop = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const eis = b64url(JSON.stringify({
    iss: k.client_email, scope, aud: 'https://oauth2.googleapis.com/token',
    iat: nu, exp: nu + 3600,
  }));
  const handtekening = b64url(crypto.createSign('RSA-SHA256').update(kop + '.' + eis).sign(k.private_key));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${kop}.${eis}.${handtekening}` }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('inloggen mislukt: ' + JSON.stringify(j));
  return j.access_token;
}

// Gedeelde drives moeten expliciet aangezet worden, anders ziet een service account daar niets.
const GEDEELD = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

async function lijst(tok, q) {
  const u = `https://www.googleapis.com/drive/v3/files?${GEDEELD}&q=${encodeURIComponent(q || '')}` +
            `&fields=${encodeURIComponent('files(id,name,mimeType,size,modifiedTime,owners(emailAddress))')}&pageSize=100`;
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json();
  if (!r.ok) throw new Error('lijst mislukt: ' + JSON.stringify(j));
  return j.files || [];
}

async function meta(tok, id) {
  const u = `https://www.googleapis.com/drive/v3/files/${id}?${GEDEELD}&fields=${encodeURIComponent('id,name,mimeType,size,modifiedTime,headRevisionId,capabilities(canEdit)')}`;
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json();
  if (!r.ok) throw new Error('metagegevens mislukt: ' + JSON.stringify(j));
  return j;
}

async function download(tok, id) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&${GEDEELD}`, { headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) throw new Error('download mislukt: ' + r.status + ' ' + await r.text());
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { token, lijst, meta, download };
