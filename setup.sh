#!/usr/bin/env bash
# PVP backend-installatie. Draai als root op de server:  bash setup.sh
set -e

echo "==> 1/5  Node.js controleren/installeren"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node-versie: $(node -v)"

echo "==> 2/5  App-map en bestanden klaarzetten"
mkdir -p /opt/pvp-api /var/pvp/uploads

cat > /opt/pvp-api/package.json <<'JSON'
{
  "name": "pvp-api",
  "version": "1.0.0",
  "private": true,
  "dependencies": { "express": "^4.19.2" }
}
JSON

cat > /opt/pvp-api/server.js <<'SERVERJS'
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_DIR = '/var/pvp';
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '30mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

app.get('/api/state', (req, res) => {
  try {
    if (fs.existsSync(STATE_FILE)) return res.type('application/json').send(fs.readFileSync(STATE_FILE));
    return res.json({ vehicles: {}, subUid: 1 });
  } catch (e) {
    return res.status(500).json({ error: 'read' });
  }
});

app.put('/api/state', (req, res) => {
  try {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(req.body || {}));
    fs.renameSync(tmp, STATE_FILE);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'write' });
  }
});

app.post('/api/photo', (req, res) => {
  try {
    const { id, key, dataUrl } = req.body || {};
    if (!id || !key || !dataUrl) return res.status(400).json({ error: 'missing' });
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
    if (!m) return res.status(400).json({ error: 'format' });
    const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    const buf = Buffer.from(m[2], 'base64');
    const safeId = String(id).replace(/[^A-Za-z0-9._-]/g, '_');
    const safeKey = String(key).replace(/[^A-Za-z0-9._-]/g, '_');
    const dir = path.join(UPLOAD_DIR, safeId);
    fs.mkdirSync(dir, { recursive: true });
    const fname = safeKey + '.' + ext;
    fs.writeFileSync(path.join(dir, fname), buf);
    return res.json({ url: '/uploads/' + safeId + '/' + fname });
  } catch (e) {
    return res.status(500).json({ error: 'save' });
  }
});

app.listen(3000, '127.0.0.1', () => console.log('PVP API luistert op 127.0.0.1:3000'));
SERVERJS

echo "==> 3/5  npm-pakketten installeren"
cd /opt/pvp-api && npm install --omit=dev

echo "==> 4/5  Service (systemd) instellen en starten"
cat > /etc/systemd/system/pvp-api.service <<'UNIT'
[Unit]
Description=PVP API
After=network.target

[Service]
WorkingDirectory=/opt/pvp-api
ExecStart=/usr/bin/node /opt/pvp-api/server.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable pvp-api
systemctl restart pvp-api

echo "==> 5/5  nginx bijwerken (login blijft, /api en /uploads erbij)"
cat > /etc/nginx/sites-available/default <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    root /var/www/html;
    index index.html;
    client_max_body_size 30m;

    auth_basic "Prieva Vehicle Platform";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        try_files $uri $uri/ =404;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /uploads/ {
        alias /var/pvp/uploads/;
    }
}
NGINX
nginx -t
systemctl reload nginx

echo ""
echo "======================================================"
echo " Klaar! Backend draait. Test met de curl-regel eronder."
echo "======================================================"
