// Account aanmaken/wijzigen voor PVP (opslag: PostgreSQL, tabel `users`).
// Gebruik: set -a; . /var/pvp/pg.env; set +a
//          node setpw.js <gebruikersnaam> <rol: team|admin|foto|taxateur|carport> <wachtwoord> [weergavenaam]
const crypto = require('crypto');
const pg = require('pg');

const [, , username, role, password, ...nameParts] = process.argv;
if (!username || !role || !password) {
  console.log('Gebruik: node setpw.js <gebruikersnaam> <rol: team|admin|foto|taxateur|carport> <wachtwoord> [weergavenaam]');
  process.exit(1);
}
if (!['team','admin','foto','taxateur','carport'].includes(role)) { console.log("Rol moet 'team', 'admin', 'foto', 'taxateur' of 'carport' zijn."); process.exit(1); }
if (!process.env.PVP_PG) { console.log('PVP_PG ontbreekt. Doe eerst: set -a; . /var/pvp/pg.env; set +a'); process.exit(1); }

const name = nameParts.join(' ') || username;
const u = username.toLowerCase();
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');

(async () => {
  const client = new pg.Client({ connectionString: process.env.PVP_PG });
  try {
    await client.connect();
    await client.query(
      `INSERT INTO users (username,role,salt,hash,name) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (username) DO UPDATE SET role=EXCLUDED.role, salt=EXCLUDED.salt, hash=EXCLUDED.hash, name=EXCLUDED.name`,
      [u, role, salt, hash, name]);
    console.log('Account opgeslagen: ' + u + '  (rol: ' + role + ', naam: ' + name + ')');
  } catch (e) {
    console.log('Opslaan mislukt: ' + e.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
