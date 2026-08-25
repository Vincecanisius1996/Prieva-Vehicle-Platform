// Google Agenda vanaf de server, puur Node — geen npm-pakket. Het inloggen leent van autoboek/drive.js:
// hetzelfde service-account, dezelfde zelf ondertekende JWT, alleen een andere scope.
//
// Het service-account heeft geen eigen agenda die iemand gebruikt. De Prieva-agenda moet dus mét dat
// account gedeeld zijn ("Wijzigingen aan afspraken aanbrengen"), en het agenda-ID in /var/pvp/agenda.env.
const fs = require('fs');
const { token } = require('../autoboek/drive.js');

const SCOPE = 'https://www.googleapis.com/auth/calendar';
const BASIS = 'https://www.googleapis.com/calendar/v3';

// Het merkteken waaraan PVP zijn eigen afspraken herkent. Alles wat dit niet heeft, blijft ongemoeid —
// in een gedeelde agenda staan de afspraken van collega's, en die hoort een script nooit aan te raken.
const MERK = { sleutel: 'pvp', waarde: 'aflevering' };

function instellingen(pad) {
  const o = {};
  try {
    for (const r of fs.readFileSync(pad || '/var/pvp/agenda.env', 'utf8').split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(r.trim()); if (m) o[m[1]] = m[2].trim();
    }
  } catch (_) { /* geen bestand = koppeling uit */ }
  return o;
}

// Google-fouten in gewone taal; deze tekst komt in de database en op het scherm terecht.
function netteFout(status, body) {
  const detail = (body && body.error && body.error.message) || '';
  if (status === 404) return 'de agenda is niet gevonden — klopt AGENDA_ID?';
  if (status === 401) return 'inloggen bij Google werkt niet meer — controleer de sleutel';
  if (status === 403) return /has not been used|is disabled/i.test(detail)
    ? 'de Google Calendar API staat uit in het Google-project — zet hem aan'
    : 'geen toegang tot de agenda — deel hem met het service-account als "Wijzigingen aan afspraken aanbrengen"';
  if (status === 429 || status >= 500) return 'Google is nu niet bereikbaar — probeer het zo opnieuw';
  return 'Google gaf een fout terug (' + status + ')' + (detail ? ': ' + detail : '');
}

async function vraag(tok, pad, opties) {
  const r = await fetch(BASIS + pad, {
    ...opties,
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', ...(opties && opties.headers) },
  });
  if (r.status === 204) return null;
  const tekst = await r.text();
  let j = null; try { j = tekst ? JSON.parse(tekst) : null; } catch (_) {}
  if (!r.ok) { const e = new Error(netteFout(r.status, j)); e.status = r.status; throw e; }
  return j;
}

/* Twee manieren om bij de agenda te mogen:
   1. de agenda is met het service-account gedeeld als "Wijzigingen aan afspraken aanbrengen";
   2. AGENDA_ALS staat op het e-mailadres van een collega, en het account handelt namens die persoon.
   De tweede is nodig als het beheerbeleid geen schrijfrechten geeft aan een account van buiten het
   domein — dan is delen op elk niveau kansloos, hoe vaak je het ook instelt. */
const inloggen = () => token(SCOPE, (instellingen().AGENDA_ALS || '').trim() || undefined);

// Welke agenda's kan dit account zien? Alleen om het ID op te zoeken bij het inrichten.
//
// Let op: een agenda die mét het service-account gedeeld is, verschijnt hier NIET vanzelf. Google
// stuurt bij delen buiten het domein een uitnodiging per e-mail, en die kan een service-account niet
// aannemen. Werken doet het wel: het recht staat al op de agenda. Met aanmelden() zetten we hem
// alsnog in de lijst, zodat hij hier zichtbaar wordt.
const agendas = tok => vraag(tok, '/users/me/calendarList?maxResults=250').then(j => (j && j.items) || []);

// Bestaat deze agenda en mogen we erin schrijven?
const agenda = (tok, id) => vraag(tok, `/calendars/${encodeURIComponent(id)}`);

const aanmelden = (tok, id) => vraag(tok, '/users/me/calendarList', { method: 'POST', body: JSON.stringify({ id }) });

// Alleen onze eigen afspraken, vanaf een moment. Het filter op het merkteken gebeurt bij Google,
// dus de afspraken van collega's komen niet eens over de lijn.
async function onzeAfspraken(tok, agendaId, vanaf) {
  const uit = []; let pagina = null;
  do {
    const u = `/calendars/${encodeURIComponent(agendaId)}/events?maxResults=250&singleEvents=true` +
      `&privateExtendedProperty=${encodeURIComponent(MERK.sleutel + '=' + MERK.waarde)}` +
      (vanaf ? `&timeMin=${encodeURIComponent(vanaf)}` : '') + (pagina ? `&pageToken=${pagina}` : '');
    const j = await vraag(tok, u);
    (j.items || []).forEach(e => uit.push(e));
    pagina = j.nextPageToken || null;
  } while (pagina);
  return uit;
}

const maak = (tok, agendaId, ev) =>
  vraag(tok, `/calendars/${encodeURIComponent(agendaId)}/events`, { method: 'POST', body: JSON.stringify(ev) });

const wijzig = (tok, agendaId, id, ev) =>
  vraag(tok, `/calendars/${encodeURIComponent(agendaId)}/events/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(ev) });

// Een afspraak die er al niet meer is, is geen fout: iemand kan hem in de agenda hebben weggehaald.
async function verwijder(tok, agendaId, id) {
  try { await vraag(tok, `/calendars/${encodeURIComponent(agendaId)}/events/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
}

module.exports = { SCOPE, MERK, instellingen, inloggen, agendas, agenda, aanmelden, onzeAfspraken, maak, wijzig, verwijder, netteFout };
