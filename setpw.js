// Account aanmaken/wijzigen voor PVP.
// Gebruik: node setpw.js <gebruikersnaam> <rol: team|foto> <wachtwoord> [weergavenaam]
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const DATA_DIR = process.env.PVP_DATA || '/var/pvp';
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const [, , username, role, password, ...nameParts] = process.argv;
if (!username || !role || !password) {
  console.log('Gebruik: node setpw.js <gebruikersnaam> <rol: team|foto> <wachtwoord> [weergavenaam]');
  process.exit(1);
}
if (role !== 'team' && role !== 'foto') { console.log("Rol moet 'team' of 'foto' zijn."); process.exit(1); }

const name = nameParts.join(' ') || username;
let users = [];
try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) {}

const u = username.toLowerCase();
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');

users = users.filter(x => x.username !== u);
users.push({ username: u, role, salt, hash, name });

fs.mkdirSync(DATA_DIR, { recursive: true });
const tmp = USERS_FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(users, null, 2));
fs.renameSync(tmp, USERS_FILE);

console.log('Account opgeslagen: ' + u + '  (rol: ' + role + ', naam: ' + name + ')');
