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
const naArg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };

(async () => {
  if (arg('--agendas')) {
    const tok = await K.inloggen();
    const lijst = await K.agendas(tok);
    if (!lijst.length) console.log('Dit account ziet geen enkele agenda. Deel de Prieva-agenda met het service-account.');
    lijst.forEach(a => console.log(`${a.accessRole.padEnd(8)} ${a.id}   ${a.summary || ''}`));
    return;
  }

  // Toetsen én aanmelden in één stap: een gedeelde agenda verschijnt niet vanzelf in de lijst van
  // een service-account, en zonder die stap blijft --agendas leeg terwijl alles werkt.
  const toets = naArg('--toets');
  if (toets) {
    const tok = await K.inloggen();
    let a;
    // Een nette regel in plaats van een stapel regels uit node: dit is de stap waar iemand die de
    // koppeling inricht op vastloopt, en die heeft aan een foutmelding met bestandsnaam niets.
    try { a = await K.agenda(tok, toets); }
    catch (e) {
      console.log('lukt niet: ' + e.message);
      if (e.status === 404) console.log(
        'Het service-account heeft nu geen enkele toegang tot deze agenda.\n' +
        'Deel hem met prieva-vehicle-platform-autobo@prieva-vehicle-platform.iam.gserviceaccount.com,\n' +
        'recht "Wijzigingen aan afspraken aanbrengen". Blijft dit staan, kijk dan in de Google-\n' +
        'beheerconsole bij Agenda > Opties voor extern delen: staat die op alleen vrij/bezet, dan kan\n' +
        'een account van buiten het domein dit recht niet krijgen.');
      process.exitCode = 1; return;
    }
    console.log(`gevonden: ${a.summary}  (tijdzone ${a.timeZone})`);
    try { const l = await K.aanmelden(tok, toets); console.log(`aangemeld in de lijst, recht: ${l.accessRole}`);
      if (l.accessRole !== 'writer' && l.accessRole !== 'owner')
        console.log('LET OP: dit recht is niet genoeg om afspraken te schrijven — deel de agenda als "Wijzigingen aan afspraken aanbrengen".');
    } catch (e) { console.log('aanmelden in de lijst lukte niet: ' + e.message); }
    return;
  }

  const begonnen = Date.now();
  const pool = new pg.Pool({ connectionString: process.env.PVP_PG });
  try {
    const r = await synchroniseer(pool, { proef: !arg('--echt'), forceer: arg('--forceer'), agendaId: naArg('--agenda') });
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
