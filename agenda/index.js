// Geplande afleveringen in de Prieva-agenda zetten.
//
// De agenda is een SPIEGEL van PVP, geen tweede administratie: PVP bepaalt wat erin staat en werkt
// het bij elke ronde bij. Wie een aflevering wil verzetten of laten vervallen, doet dat in PVP; een
// wijziging in de agenda zelf wordt de eerstvolgende ronde overschreven. Dat staat ook in de
// afspraak zelf, want anders is het een verrassing.
//
// Er wordt uitsluitend geraakt wat PVP zelf heeft aangemaakt — herkenbaar aan het merkteken uit
// kalender.js. De afspraken van collega's komen niet eens over de lijn.
const K = require('./kalender.js');

const MARGE_DAGEN = 2;              // gelijk aan CARPORT_MARGE_DAGEN in server.js
const TERUG_DAGEN = 90;             // zover kijken we terug om onze eigen afspraken terug te vinden
const MAX_VERWIJDEREN = 10;         // meer dan dit in één ronde is een fout, geen opruiming

const dag = ms => new Date(ms).toISOString().slice(0, 10);
const uitTekst = d => {             // 'dd-mm-jjjj' -> epoch ms (UTC, begin van de dag)
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(d || ''));
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null;
};
const kort = ms => { const d = new Date(ms); return `${String(d.getUTCDate()).padStart(2,'0')}-${String(d.getUTCMonth()+1).padStart(2,'0')}`; };
const POETSWERK = t => t.soort === 'poetsen';

function titelVan(b) {
  const naam = [b.merk, b.model].filter(Boolean).join(' ') || 'Auto';
  const kent = b.kenteken && b.kenteken !== '—' ? b.kenteken : (b.vin ? '…' + String(b.vin).slice(-6) : '');
  return `Aflevering — ${naam}${kent ? ' · ' + kent : ''}`;
}

function beschrijvingVan(b, taken, aflever) {
  const open = taken.filter(t => !t.klaar);
  const af = taken.length - open.length;
  const r = [];
  const lijst = (kop, wat, wanneer) => {
    if (!wat.length) return;
    r.push(`${kop} — uiterlijk ${kort(wanneer)}:`);
    wat.forEach(t => r.push(`• (${t.soort}) ${t.tekst}`));
    r.push('');
  };
  lijst('Bij Carport', open.filter(t => !POETSWERK(t)), aflever - MARGE_DAGEN * 86400000);
  lijst('Bij de poetser', open.filter(POETSWERK), aflever);
  if (!open.length) r.push('Er staat geen werk meer open.', '');
  if (af) r.push(`${af} van de ${taken.length} punten ${af === 1 ? 'is' : 'zijn'} al afgevinkt.`, '');
  r.push('Deze afspraak wordt door PVP bijgehouden (pvp.prieva.nl → Carport).');
  r.push('Wijzigen hier heeft geen zin: PVP schrijft hem bij de volgende ronde opnieuw.');
  return r.join('\n');
}

function afspraakVan(b, taken) {
  const aflever = uitTekst(b.afleverdatum);
  return {
    summary: titelVan(b),
    description: beschrijvingVan(b, taken, aflever),
    start: { date: dag(aflever) },
    end: { date: dag(aflever + 86400000) },      // Google rekent het einde exclusief
    transparency: 'transparent',                 // een aflevering hoort niemands dag als bezet te tonen
    extendedProperties: { private: { [K.MERK.sleutel]: K.MERK.waarde, bon: String(b.id), auto: String(b.vehicle_id) } },
  };
}

// Alleen bijwerken als er echt iets verandert — anders schrijven we vier keer per uur dezelfde
// afspraak opnieuw en staat de agenda vol met "gewijzigd door PVP".
const gelijk = (ev, wil) =>
  ev.summary === wil.summary && (ev.description || '') === wil.description &&
  ev.start && ev.start.date === wil.start.date && ev.end && ev.end.date === wil.end.date;

async function synchroniseer(pool, opties) {
  const o = opties || {};
  const inst = K.instellingen(o.envPad);
  const agendaId = o.agendaId || inst.AGENDA_ID || '';
  const uit = { aan: !!agendaId, aangemaakt: 0, bijgewerkt: 0, verwijderd: 0, ongewijzigd: 0, meldingen: [] };
  if (!agendaId) { uit.meldingen.push('koppeling staat uit (AGENDA_ID leeg)'); return uit; }

  const vandaag = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());

  // Wat hoort erin: open werkbonnen met een afleverdatum die nog moet komen. Een aflevering van
  // vorige week is geschiedenis; die hoort niet alsnog in de agenda te verschijnen.
  const { rows: bonnen } = await pool.query(
    `SELECT b.id, b.vehicle_id, b.afleverdatum, b.agenda_event_id, v.merk, v.model, v.kenteken, v.vin
       FROM carport_bonnen b LEFT JOIN vehicles v ON v.id = b.vehicle_id
      WHERE b.status = 'open' AND b.afleverdatum IS NOT NULL`);
  const { rows: taken } = await pool.query('SELECT bon_id, soort, tekst, klaar FROM carport_taken ORDER BY id');
  const perBon = {}; taken.forEach(t => (perBon[t.bon_id] ||= []).push(t));

  const wil = new Map();
  for (const b of bonnen) {
    const t = uitTekst(b.afleverdatum);
    if (t === null || t < vandaag) continue;
    wil.set(String(b.id), { bon: b, ev: afspraakVan(b, perBon[b.id] || []) });
  }

  const tok = await K.inloggen();
  const bestaand = await K.onzeAfspraken(tok, agendaId, new Date(vandaag - TERUG_DAGEN * 86400000).toISOString());
  const perBonId = new Map(), dubbel = [];
  for (const e of bestaand) {
    const id = ((e.extendedProperties || {}).private || {}).bon;
    if (!id) continue;
    if (perBonId.has(id)) dubbel.push(e); else perBonId.set(id, e);
  }

  // Weg: onze eigen afspraken die niet meer bij een geplande aflevering horen. Alleen vanaf vandaag —
  // wat geweest is, blijft staan; de agenda is ook een logboek van wat er gebeurd is.
  const weg = dubbel.slice();
  for (const [bonId, e] of perBonId) {
    if (wil.has(bonId)) continue;
    const d = e.start && e.start.date ? uitTekst(e.start.date.split('-').reverse().join('-')) : null;
    if (d !== null && d < vandaag) continue;
    weg.push(e);
  }
  if (weg.length > MAX_VERWIJDEREN && !o.forceer) {
    uit.meldingen.push(`${weg.length} afspraken zouden verdwijnen — dat is er te veel; er is niets gewijzigd`);
    uit.geweigerd = true;
    return uit;
  }

  for (const [bonId, w] of wil) {
    const bestaat = perBonId.get(bonId);
    if (bestaat) {
      if (gelijk(bestaat, w.ev)) { uit.ongewijzigd++; }
      else if (!o.proef) { await K.wijzig(tok, agendaId, bestaat.id, w.ev); uit.bijgewerkt++; }
      else uit.bijgewerkt++;
      if (!o.proef && w.bon.agenda_event_id !== bestaat.id)
        await pool.query('UPDATE carport_bonnen SET agenda_event_id=$2 WHERE id=$1', [w.bon.id, bestaat.id]);
    } else if (o.proef) { uit.aangemaakt++; }
    else {
      const ev = await K.maak(tok, agendaId, w.ev);
      await pool.query('UPDATE carport_bonnen SET agenda_event_id=$2 WHERE id=$1', [w.bon.id, ev.id]);
      uit.aangemaakt++;
    }
  }

  for (const e of weg) {
    if (!o.proef) {
      await K.verwijder(tok, agendaId, e.id);
      await pool.query('UPDATE carport_bonnen SET agenda_event_id=NULL WHERE agenda_event_id=$1', [e.id]);
    }
    uit.verwijderd++;
  }
  return uit;
}

module.exports = { synchroniseer, afspraakVan, titelVan, beschrijvingVan, MARGE_DAGEN, MAX_VERWIJDEREN };
