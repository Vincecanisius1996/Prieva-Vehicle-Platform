// Zet de geplande afleveringen in de Prieva-agenda. Zonder --echt wordt er niets geschreven.
//
//   node agenda/sync.js                 proefdraai: wat zou er gebeuren
//   node agenda/sync.js --echt          doen
//   node agenda/sync.js --agendas       welke agenda's ziet het service-account (bij het inrichten)
//   node agenda/sync.js --echt --forceer  ook als er meer dan MAX_VERWIJDEREN afspraken weg zouden gaan
const pg = require('/opt/pvp-api/node_modules/pg');
const K = require('./kalender.js');
const { synchroniseer } = require('./index.js');
const { meld } = require('../agentrun.js');

const arg = n => process.argv.includes(n);

(async () => {
  if (arg('--agendas')) {
    const tok = await K.inloggen();
    const lijst = await K.agendas(tok);
    if (!lijst.length) console.log('Dit account ziet geen enkele agenda. Deel de Prieva-agenda met het service-account.');
    lijst.forEach(a => console.log(`${a.accessRole.padEnd(8)} ${a.id}   ${a.summary || ''}`));
    return;
  }

  const begonnen = Date.now();
  const pool = new pg.Pool({ connectionString: process.env.PVP_PG });
  try {
    const r = await synchroniseer(pool, { proef: !arg('--echt'), forceer: arg('--forceer') });
    if (!r.aan) { console.log('agenda-koppeling staat uit (AGENDA_ID leeg in /var/pvp/agenda.env)'); return; }
    const samen = `${r.aangemaakt} nieuw, ${r.bijgewerkt} bijgewerkt, ${r.verwijderd} weg, ${r.ongewijzigd} ongewijzigd`;
    console.log(samen);
    r.meldingen.forEach(m => console.log('  ! ' + m));
    if (arg('--echt')) await meld(pool, 'agenda', !r.geweigerd, r.geweigerd ? r.meldingen.join('; ') : samen, begonnen);
    if (r.geweigerd) process.exitCode = 1;
    if (!arg('--echt')) console.log('\n>>> PROEFDRAAI — er is niets geschreven.');
  } catch (e) {
    console.error('MISLUKT:', e.message);
    if (arg('--echt')) await meld(pool, 'agenda', false, e.message, begonnen);
    process.exitCode = 1;
  } finally { await pool.end(); }
})();
