// Eenmalige inhaalslag: de auto's die wel in het Autoboek en in Drive staan, maar niet in PVP.
// Bron per auto is de regel in het Autoboek (die is door Prieva zelf gecureerd); de mappen in Drive
// bevestigen dat de auto bestaat en leveren de stukken. Draait tegen de TESTOMGEVING.
const BASIS = process.env.BASIS || 'http://127.0.0.1:3001';
const GEBRUIKER = process.env.GEBRUIKER || 'testteam';
const WW = process.env.WW || 'testpw';

// Excel-serienummer -> dd-mm-jjjj
const datum = n => {
  if (n === undefined || n === null || n === '') return '';
  const d = new Date(Date.UTC(1899, 11, 30) + Number(n) * 86400000);
  return isNaN(d) ? '' : `${String(d.getUTCDate()).padStart(2,'0')}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${d.getUTCFullYear()}`;
};
const trans = t => ({ Aut: 'Automaat', aut: 'Automaat', Hand: 'Handgeschakeld', Handgeschakeld: 'Handgeschakeld' }[t] || t || '');

// --- 7 auto's uit "Komende Autos" (partij TX, 12-08-2026) ---
const KOMEND = [
  { vin:'VSSZZZKMZNR080328', merk:'Cupra',      model:'Formentor', uitv:'VZ 1.4 e-Hybrid 245pk',      kleur:'Grijs', brandstof:'PHEV',       transm:'Aut', reg:'08-07-2022', km:87097,  inkoopdatum:'12-08-2026', lev:'TX', inkoopprijs:14960,
    note:'DEKRA-rapport: schadeverleden hersteld (€ 3.816 excl.), middelmatige staat, velgen bekrast' },
  { vin:'VSSZZZKM3PR052924', merk:'Cupra',      model:'Formentor', uitv:'1.4 e-Hybrid 204pk',         kleur:'Grijs', brandstof:'PHEV',       transm:'Aut', reg:'06-07-2023', km:92372,  inkoopdatum:'12-08-2026', lev:'TX', inkoopprijs:15250, note:'' },
  { vin:'WVWZZZCDZNW304970', merk:'Volkswagen', model:'Golf',      uitv:'GTE 1.4 eHybrid 245pk',      kleur:'Zwart', brandstof:'PHEV',       transm:'Aut', reg:'16-02-2022', km:60888,  inkoopdatum:'12-08-2026', lev:'TX', inkoopprijs:16093, note:'' },
  { vin:'WVWZZZCD0PW308373', merk:'Volkswagen', model:'Golf',      uitv:'GTE 1.4 eHybrid 245pk',      kleur:'Zwart', brandstof:'PHEV',       transm:'Aut', reg:'03-05-2023', km:80821,  inkoopdatum:'12-08-2026', lev:'TX', inkoopprijs:15996, note:'' },
  { vin:'WVGZZZ5NZNW409142', merk:'Volkswagen', model:'Tiguan',    uitv:'R-Line 1.4 e-Hybrid 245pk',  kleur:'Wit',   brandstof:'PHEV',       transm:'Aut', reg:'21-07-2022', km:114438, inkoopdatum:'12-08-2026', lev:'TX', inkoopprijs:17688, note:'' },
  { vin:'ZFAEFAG47PX190407', merk:'Fiat',       model:'500e',      uitv:'Cabrio 42 kWh',              kleur:'Wit',   brandstof:'Elektrisch', transm:'Aut', reg:'13-05-2024', km:32065,  inkoopdatum:'12-08-2026', lev:'TX', inkoopprijs:12783, note:'' },
  { vin:'ZFAEFAG46PX183545', merk:'Fiat',       model:'500e',      uitv:'Cabrio 42 kWh',              kleur:'Zwart', brandstof:'Elektrisch', transm:'Aut', reg:'04-10-2024', km:26395,  inkoopdatum:'12-08-2026', lev:'TX', inkoopprijs:12478, note:'' },
].map(v => ({ ...v, kenteken:'', importAuto:true, batch:'', status:'komende' }));

// --- 3 auto's die in "Lopende Autos" staan: al binnen, PVP kent ze niet ---
const LOPEND = [
  { vin:'WBATA610X09R21534', kenteken:'',         merk:'BMW',    model:'X5',     uitv:'45e M-Sport xDrive', kleur:'Blauw', brandstof:'PHEV',       transm:'Aut', reg:datum(45040), km:136691, inkoopdatum:datum(46237), lev:'OL',             inkoopprijs:31100, importAuto:true,  note:'Stond al in Lopende Autos van het Autoboek' },
  { vin:'WMWWJ3103L3L78563', kenteken:'J-763-PG', merk:'MINI',   model:'Cooper', uitv:'1.5 Cooper Cabrio',  kleur:'Grijs', brandstof:'Benzine',    transm:'Aut', reg:datum(43896), km:23500,  inkoopdatum:datum(46244), lev:'DD',             inkoopprijs:18000, importAuto:false, note:'Marge. Stond al in Lopende Autos van het Autoboek' },
  { vin:'SJNFAAZE0U6044728', kenteken:'JJ285K',   merk:'Nissan', model:'Leaf',   uitv:'Accenta 30 kWh',     kleur:'Wit',   brandstof:'Elektrisch', transm:'Aut', reg:datum(42460), km:146500, inkoopdatum:datum(46246), lev:'Justo Rijnders', inkoopprijs:2100,  importAuto:false, note:'Advertentie staat klaar. Stond al in Lopende Autos van het Autoboek' },
].map(v => ({ ...v, batch:'', status:'lopende' }));

(async () => {
  const lr = await fetch(BASIS + '/api/login', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ username: GEBRUIKER, password: WW }) });
  if (!lr.ok) { console.error('inloggen mislukt:', lr.status); process.exit(1); }
  const cookie = (lr.headers.get('set-cookie') || '').split(';')[0];

  // GROEP=komend | lopend | alles. Standaard alleen de komende auto's: de drie uit Lopende Autos
  // zijn al binnen, en die als "komende" in productie zetten zou collega's een auto laten verwachten
  // die er allang staat.
  const groep = (process.env.GROEP || 'komend').toLowerCase();
  const lijst = groep === 'alles' ? [...KOMEND, ...LOPEND] : groep === 'lopend' ? LOPEND : KOMEND;
  console.log(`groep: ${groep} (${lijst.length} auto's)\n`);

  let ok = 0, over = 0, fout = 0;
  for (const v of lijst) {
    const body = { ...v, transm: trans(v.transm) };
    delete body.status;
    const r = await fetch(BASIS + '/api/vehicle', { method:'POST', headers:{'Content-Type':'application/json', cookie}, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409) { over++; console.log(`  = ${v.vin}  stond er al`); continue; }
    if (!r.ok) { fout++; console.log(`  ! ${v.vin}  MISLUKT: ${JSON.stringify(j)}`); continue; }
    ok++;
    console.log(`  + ${j.id}  ${v.merk} ${v.model}  (${v.status})`);
  }
  console.log(`\ntoegevoegd: ${ok}, stond er al: ${over}, mislukt: ${fout}`);
  console.log('LET OP: de drie uit Lopende Autos zijn aangemaakt als "komende" — de status moet nog gezet worden.');
})();
