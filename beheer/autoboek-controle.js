// Legt het Autoboek naast PVP en meldt wat niet klopt. Leest alleen; schrijft nooit in het boek.
//
// Waarom dit bestaat: elk probleem van deze week — dubbele regels, een factuurnummer op twee auto's,
// een auto die op twee tabbladen stond — is gevonden doordat iemand het toevallig zag of doordat er
// een klacht kwam. Niets vergeleek de twee administraties met elkaar. Dit doet dat, elke nacht, en
// zet de uitkomst in agent_runs zodat een verschil op Vandaag verschijnt in plaats van in een logboek
// dat niemand leest.
//
//   node beheer/autoboek-controle.js            tonen
//   node beheer/autoboek-controle.js --stil     alleen de samenvatting vastleggen (voor de timer)
const pg = require('/opt/pvp-api/node_modules/pg');
const drive = require('/opt/pvp-api/autoboek/drive.js');
const xlsx = require('/opt/pvp-api/autoboek/xlsx-lees.js');
const { meld } = require('/opt/pvp-api/agentrun.js');

const STIL = process.argv.includes('--stil');
const ID = (process.env.AUTOBOEK_FILE_ID || '').trim();
const BLADEN = ['Komende Autos', 'Lopende Autos', 'Verkochte Autos'];
const HOORT = { komende: 'Komende Autos', lopende: 'Lopende Autos', 'gemeld verkocht': 'Lopende Autos', verkocht: 'Verkochte Autos' };
const P = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const nr = v => String(v === null || v === undefined ? '' : v).replace(/\.0$/, '').trim();
const leeg = x => x === null || x === undefined || String(x).trim() === '' || String(x).trim() === '—';

(async () => {
  if (!ID) { console.log('AUTOBOEK_FILE_ID ontbreekt — niets te controleren'); process.exit(1); }
  const pool = new pg.Pool({ connectionString: process.env.PVP_PG });
  const tok = await drive.token('https://www.googleapis.com/auth/drive');
  const boek = xlsx.lees(await drive.download(tok, ID));

  const rijen = [];
  for (const blad of BLADEN)
    for (const k of Object.keys(boek[blad])) {
      const c = boek[blad][k]; if (Number(k) < 2) continue;
      if (leeg(c[4]) && leeg(c[5])) continue;
      // De kolommen staan niet op alle bladen gelijk: op Komende is Q de verkoopdatum en R de
      // inkoopprijs, op Lopende en Verkochte is R de verkoopdatum en U de verkoopprijs. Wie dat door
      // elkaar haalt, ziet dertien inkoopprijzen aan voor verkoopdatums.
      const kVerkoopdatum = blad === 'Komende Autos' ? 16 : 17;
      const kVerkoopprijs = blad === 'Komende Autos' ? null : 20;
      rijen.push({ blad, rij: Number(k), vin: P(c[4]), kent: P(c[5]), fact: nr(c[3]),
        auto: ((c[6] || '') + ' ' + (c[7] || '')).trim(),
        verkoopdatum: c[kVerkoopdatum], verkoopprijs: kVerkoopprijs === null ? null : c[kVerkoopprijs] });
    }

  const { rows: pvp } = await pool.query('SELECT id,merk,model,kenteken,vin,status,verkoop_factuurnr,verkoop_bron FROM vehicles');
  const perVin = new Map(), perKent = new Map();
  pvp.forEach(v => { if (P(v.vin)) perVin.set(P(v.vin), v); if (P(v.kenteken)) perKent.set(P(v.kenteken), v); });
  const bijRij = r => (r.vin && perVin.get(r.vin)) || (r.kent && perKent.get(r.kent)) || null;

  const punten = [];
  const meldPunt = (soort, tekst) => punten.push({ soort, tekst });

  // 1. Eén factuurnummer op meer dan één regel.
  const perFact = {};
  rijen.filter(r => r.fact).forEach(r => (perFact[r.fact] ||= []).push(r));
  Object.entries(perFact).filter(([, l]) => l.length > 1).forEach(([f, l]) =>
    meldPunt('dubbel factuurnummer', `factuur ${f} staat op ${l.length} regels: ` +
      l.map(r => `${r.blad.split(' ')[0]} ${r.rij} (${r.auto})`).join(', ')));

  // 2. Dezelfde auto op meer dan één regel. Samenvoegen op VIN én kenteken, want een regel met alleen
  //    een VIN en een regel met alleen een kenteken zijn anders niet als dezelfde auto te zien.
  const ouder = {}; const vind = x => { while (ouder[x] && ouder[x] !== x) x = ouder[x]; return x; };
  const bind = (x, y) => { ouder[x] ||= x; ouder[y] ||= y; ouder[vind(x)] = vind(y); };
  rijen.forEach((r, i) => { const s = 'r' + i; ouder[s] = s; if (r.vin) bind(s, 'V' + r.vin); if (r.kent) bind(s, 'K' + r.kent); });
  const groepen = {};
  rijen.forEach((r, i) => (groepen[vind('r' + i)] ||= []).push(r));
  Object.values(groepen).filter(l => l.length > 1).forEach(l => {
    // Wat wél mag: een auto die eerder verkocht is en nu opnieuw wordt ingekocht. Die heeft één regel
    // per verkoop, elk met een eigen factuurnummer, plus hooguit één regel op Komende of Lopende voor
    // de nieuwe ronde. De Tesla Model Y KJB-99-J is daar het voorbeeld van: verkocht in mei, komt
    // terug als inruil.
    const verkocht = l.filter(r => r.blad === 'Verkochte Autos');
    const lopend = l.filter(r => r.blad !== 'Verkochte Autos');
    const nummers = verkocht.map(r => r.fact);
    const elkEigenNummer = nummers.every(Boolean) && new Set(nummers).size === nummers.length;
    const perBlad = new Set(lopend.map(r => r.blad));
    if (elkEigenNummer && lopend.length <= 1 && perBlad.size === lopend.length) return;
    meldPunt('auto meer dan één keer', `${l[0].auto} (${l[0].kent || l[0].vin}) staat op ` +
      l.map(r => `${r.blad.split(' ')[0]} ${r.rij}${r.fact ? ' fact ' + r.fact : ' zonder factuurnummer'}`).join(' en '));
  });

  // 3. PVP en het boek oneens over het tabblad.
  for (const v of pvp) {
    const eigen = rijen.filter(r => (P(v.vin) && r.vin === P(v.vin)) || (P(v.kenteken) && r.kent === P(v.kenteken)));
    if (!eigen.length) { if (v.status !== 'komende') meldPunt('niet in het boek', `${v.merk} ${v.model} (${v.kenteken !== '—' ? v.kenteken : v.vin}) staat in PVP als ${v.status} maar op geen enkel tabblad`); continue; }
    if (!eigen.some(r => r.blad === HOORT[v.status]))
      meldPunt('verkeerd tabblad', `${v.merk} ${v.model} (${v.kenteken !== '—' ? v.kenteken : v.vin}) is in PVP ${v.status}, in het boek ${eigen.map(r => r.blad.split(' ')[0]).join('/')}`);
  }

  // 4. Auto's die het boek kent en PVP niet.
  rijen.filter(r => r.blad !== 'Verkochte Autos' && !bijRij(r)).forEach(r =>
    meldPunt('niet in PVP', `${r.auto} (${r.kent || r.vin}) staat op ${r.blad.split(' ')[0]} ${r.rij} maar niet in PVP`));

  // 5. Verkoopgegevens waar ze niet horen. Op *Lopende* is een verkoopdatum en -prijs juist normaal:
  //    dat is een auto die verkocht is op een overeenkomst en waar nog aan gewerkt wordt. Staat er
  //    óók al een factuurnummer, dan had de regel naar Verkochte moeten verhuizen. Op *Komende* slaat
  //    een verkoopdatum nergens op — die auto is nog niet eens binnen.
  rijen.filter(r => r.blad === 'Komende Autos' && !leeg(r.verkoopdatum)).forEach(r =>
    meldPunt('verkoopdatum op Komende', `${r.auto} (${r.kent || r.vin}) op Komende ${r.rij} heeft een verkoopdatum`));
  rijen.filter(r => r.blad === 'Lopende Autos' && r.fact).forEach(r =>
    meldPunt('factuur op Lopende', `${r.auto} (${r.kent || r.vin}) op Lopende ${r.rij} heeft factuurnummer ${r.fact} — die regel hoort op Verkochte`));

  // 6. Verkochte regels zonder factuurnummer.
  const zonder = rijen.filter(r => r.blad === 'Verkochte Autos' && !r.fact);
  if (zonder.length) meldPunt('verkocht zonder factuurnummer',
    `${zonder.length} regel(s) op Verkochte hebben geen factuurnummer: ` + zonder.slice(0, 6).map(r => 'rij ' + r.rij).join(', ') + (zonder.length > 6 ? ' …' : ''));

  const perSoort = {};
  punten.forEach(p => (perSoort[p.soort] ||= []).push(p.tekst));
  if (!STIL) {
    console.log(`Autoboek: ${rijen.length} regels · PVP: ${pvp.length} auto's\n`);
    if (!punten.length) console.log('Geen verschillen gevonden.');
    for (const [soort, l] of Object.entries(perSoort)) {
      console.log(`=== ${soort} — ${l.length} ===`);
      l.forEach(x => console.log('  ' + x));
      console.log('');
    }
  }
  const samen = punten.length
    ? Object.entries(perSoort).map(([s, l]) => `${l.length} ${s}`).join(', ')
    : 'geen verschillen';
  console.log(samen);
  if (STIL) await meld(pool, 'autoboek-controle', punten.length === 0, samen, Date.now());
  await pool.end();
  process.exitCode = punten.length ? 1 : 0;
})();
