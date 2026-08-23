// Eenmalig: de auto's uit de RDW-bedrijfsvoorraad die PVP niet kent alsnog overnemen (23-08-2026).
//
// De bedrijfsvoorraad zegt: deze auto is NU van ons. Dat is in PVP niet 'komend' maar 'binnen' —
// dus ze worden aangemaakt en meteen als binnengekomen gemarkeerd, waarmee de regel in het Autoboek
// van Komende naar Lopende verhuist. Dat gaat via dezelfde weg als de app, niet met eigen SQL.
//
// De gegevens komen uit drie bronnen:
//   * de bedrijfsvoorraad zelf : kenteken, merk, model, sinds wanneer van ons
//   * RDW open data            : kleur, brandstof, datum eerste toelating  (officieel, gratis, geen inlog)
//   * de inruilregel in Mobilox: uitvoering, kilometerstand, inkoopprijs   (als de auto ingeruild is)
//
// Finnik is hier niet voor nodig: de uitvoering staat al in de omschrijving op de verkoopovereenkomst.
const pg = require('/opt/pvp-api/node_modules/pg');
const I = require('../mobilox/inruil.js');

const ECHT = process.argv.includes('--echt');
const PVP = process.env.PVP_API || 'http://127.0.0.1:3000';
const TOK = process.env.TOK || '';
const pool = new pg.Pool({ connectionString: process.env.PVP_PG });

// Welke auto's, en wat we uit de bedrijfsvoorraad weten. Met de hand overgenomen uit de lijst zodat
// deze eenmalige actie niet van een browsersessie afhangt en herhaalbaar is.
const AUTOS = [
  { kent: 'KV115L', sinds: '21-08-2026' },
  { kent: '9ZPF87', sinds: '21-08-2026' },
  { kent: 'V78RDJ', sinds: '20-08-2026' },
  { kent: '93XXX1', sinds: '05-08-2026' },
  { kent: '90GXX1', sinds: '02-07-2026' },
];

const titel = s => String(s || '').toLowerCase().replace(/(^|[\s-])(\w)/g, (m, a, b) => a + b.toUpperCase());
const datumUit = jjjjmmdd => { const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(jjjjmmdd || '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

async function rdw(kent) {
  const basis = await (await fetch('https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken=' + kent)).json();
  if (!basis.length) return null;
  const brandstof = await (await fetch('https://opendata.rdw.nl/resource/8ys7-d773.json?kenteken=' + kent)).json();
  return { ...basis[0], brandstof: brandstof.map(x => x.brandstof_omschrijving).join('/') || null };
}

(async () => {
  const merken = new Map();
  (await pool.query('SELECT DISTINCT merk FROM vehicles WHERE merk IS NOT NULL')).rows
    .forEach(r => merken.set(I.merkSleutel(r.merk), r.merk));
  const { rows: inruilen } = await pool.query('SELECT kenteken, omschrijving, prijs, km FROM mobilox_inruil');
  const perKent = new Map(); inruilen.forEach(r => perKent.set(I.plat(r.kenteken), r));

  for (const a of AUTOS) {
    const r = await rdw(a.kent);
    if (!r) { console.log(`${a.kent}: niet gevonden bij de RDW — overgeslagen`); continue; }
    const inr = perKent.get(a.kent) || null;

    const merk = merken.get(I.merkSleutel(r.merk)) || titel(r.merk);
    // Model en uitvoering komen bij voorkeur uit de omschrijving op de verkoopovereenkomst
    // ("Hyundai i10 I 1.1"): die is met de hand geschreven en leest beter dan de handelsbenaming van
    // de RDW, die er "I 10" van maakt. Zonder omschrijving valt hij terug op de RDW.
    let model, uitv = null;
    if (inr && inr.omschrijving) {
      const woorden = String(inr.omschrijving).trim().split(/\s+/);
      model = woorden[1] || titel(r.handelsbenaming);
      uitv = woorden.slice(2).join(' ') || null;
    } else {
      model = titel(String(r.handelsbenaming || '').replace(new RegExp('^' + r.merk, 'i'), '').trim()) || titel(r.handelsbenaming);
    }
    const auto = {
      kenteken: I.kentekenOpmaak(a.kent), vin: null, merk, model, uitv,
      // De RDW schrijft "Niet geregistreerd" of "N.v.t." als er geen kleur bekend is; dat is geen kleur.
      kleur: r.eerste_kleur && !/^(niet geregistreerd|n\.v\.t\.)$/i.test(r.eerste_kleur) ? titel(r.eerste_kleur) : null,
      brandstof: r.brandstof, reg: datumUit(r.datum_eerste_toelating),
      km: inr && inr.km != null ? Number(inr.km) : null,
      inkoopprijs: inr && inr.prijs != null ? Number(inr.prijs) : null,
      inkoopdatum: a.sinds, lev: inr ? 'Inruil' : null, importAuto: false,
      note: `Overgenomen uit de RDW-bedrijfsvoorraad op 23-08-2026; op naam van Prieva sinds ${a.sinds}.`,
    };
    console.log('\n' + JSON.stringify(auto));
    if (!ECHT) continue;

    const res = await fetch(PVP + '/api/vehicle', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK }, body: JSON.stringify(auto) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { console.log('  aanmaken mislukt:', res.status, j.error || ''); continue; }
    console.log('  aangemaakt als', j.id, '| Autoboek', (j.autoboek || {}).status, (j.autoboek || {}).rij || '');
  }
  if (!ECHT) console.log('\n>>> PROEFDRAAI — er is niets aangemaakt.');
  await pool.end();
})();
