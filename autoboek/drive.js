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

// Google-fouten in gewone taal. Deze tekst belandt in de database en op het scherm van collega's;
// daar heeft niemand iets aan een stuk JSON met "reason":"notFound".
function netteFout(status, body) {
  const detail = (body && body.error && body.error.message) || '';
  if (status === 404) return 'het Autoboek is niet gevonden — is het bestand met PVP gedeeld, en klopt het bestands-ID?';
  if (status === 401) return 'inloggen bij Google werkt niet meer — controleer de sleutel';
  if (status === 403) return /storageQuota|quota/i.test(detail)
    ? 'Google weigert de opslag (quota) — probeer het later opnieuw'
    : 'geen toegang tot het Autoboek — deel het bestand als Bewerker met PVP';
  if (status === 429 || status >= 500) return 'Google is nu niet bereikbaar — probeer het zo opnieuw';
  return 'Google gaf een fout terug (' + status + ')' + (detail ? ': ' + detail : '');
}

async function lijst(tok, q) {
  const u = `https://www.googleapis.com/drive/v3/files?${GEDEELD}&q=${encodeURIComponent(q || '')}` +
            `&fields=${encodeURIComponent('files(id,name,mimeType,size,modifiedTime,owners(emailAddress))')}&pageSize=100`;
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json();
  if (!r.ok) throw new Error(netteFout(r.status, j));
  return j.files || [];
}

async function meta(tok, id) {
  const u = `https://www.googleapis.com/drive/v3/files/${id}?${GEDEELD}&fields=${encodeURIComponent('id,name,mimeType,size,modifiedTime,headRevisionId,capabilities(canEdit)')}`;
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json();
  if (!r.ok) throw new Error(netteFout(r.status, j));
  return j;
}

async function download(tok, id) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&${GEDEELD}`, { headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) { let j = null; try { j = JSON.parse(await r.text()); } catch (_) {} throw new Error('ophalen mislukt — ' + netteFout(r.status, j)); }
  return Buffer.from(await r.arrayBuffer());
}

async function upload(tok, id, buf) {
  const u = `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&${GEDEELD}&fields=id,headRevisionId,size`;
  const r = await fetch(u, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    body: buf,
  });
  const j = await r.json();
  if (!r.ok) throw new Error('terugzetten mislukt — ' + netteFout(r.status, j));
  return j;
}

module.exports = { token, lijst, meta, download, upload };
