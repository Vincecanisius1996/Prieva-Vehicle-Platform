// Leest de administratie van Mobilox en legt hem naast PVP. Zonder --echt wordt er niets geschreven.
//
// Koppelen gaat op VIN. product.title is vrije tekst ("BMW 2-serie Active Tourer 218i Sport") en
// daar is geen auto mee terug te vinden; een chassisnummer wel.
//
// Wat er NIET wordt overgenomen: het blok `customer`. Naam, adres, telefoonnummer en e-mailadres van
// de koper horen niet in PVP — zelfde regel als in uitlezen/.
const { chromium } = require('playwright');
const fs = require('fs');
const pg = require('/opt/pvp-api/node_modules/pg');
const { takenUit } = require('./taken.js');
const { meld } = require('../agentrun.js');
const planning = require('./planning.js');
const inruil = require('./inruil.js');

const ECHT = process.argv.includes('--echt');
const SESSIE = '/var/pvp/mobilox-sessie.json';
const API = 'https://api.mobilox.nl/api/v2';
const SOORTEN = { 2: 'overeenkomst', 3: 'factuur' };
// Waar PVP draait. Instelbaar zodat een toets tegen een testserver kan praten en niet per ongeluk
// tegen de echte administratie.
const PVP = process.env.PVP_API || 'http://127.0.0.1:3000';

function env() {
  const o = {};
  for (const r of fs.readFileSync('/var/pvp/mobilox.env', 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(r.trim()); if (m) o[m[1]] = m[2];
  }
  if (!o.MOBILOX_URL) throw new Error('MOBILOX_URL ontbreekt in /var/pvp/mobilox.env');
  return o;
}
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const bedrag = x => { if (x == null) return null; const n = Number(String(x).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

// Ophalen met de bewaarde sessie. Is die verlopen, dan één keer opnieuw inloggen — daarna verder.
async function haal(page, e, type, jaar) {
  const doe = () => page.evaluate(async u => {
    const r = await fetch(u, { credentials: 'include' });
    return { status: r.status, json: r.ok ? await r.json().catch(() => null) : null };
  }, `${API}/quotations?type=${type}&year=${jaar}`);
  let r = await doe();
  if (r.status === 401 || r.status === 403 || (r.status === 200 && !r.json)) {
    await opnieuwInloggen(page, e);
    r = await doe();
  }
  if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`ophalen type=${type} mislukt (status ${r.status})`);
  return r.json;
}
async function opnieuwInloggen(page, e) {
  await page.goto(e.MOBILOX_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  const pw = await page.$('input[type=password]');
  if (!pw) return;                                  // sessie was toch nog goed
  if (!e.MOBILOX_GEBRUIKER || !e.MOBILOX_WACHTWOORD) throw new Error('sessie verlopen en geen inloggegevens');
  await (await page.$('#_username')).fill(e.MOBILOX_GEBRUIKER);
  await pw.fill(e.MOBILOX_WACHTWOORD);
  await pw.press('Enter');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3500);
  if (await page.$('input[type=password]')) throw new Error('opnieuw inloggen mislukt');
  await page.context().storageState({ path: SESSIE });
  fs.chmodSync(SESSIE, 0o600);
}

// Alleen de velden die PVP nodig heeft.
function uitRegel(r, soort) {
  const av = (r.product && r.product.attributeValues) || {};
  return {
    soort, externId: r.id, nummer: r.number,
    datum: r.createdAt || null,
    afleverdatum: r.deliveryDate || null,
    prijs: bedrag(r.price != null ? r.price : r.amountToPay),
    btwSoort: r.taxType || null,
    vin: (av.VIN || '').trim() || null,
    kenteken: (av.LICEN || '').trim() || null,
    omschrijving: (r.product && r.product.title) || null,
    taken: takenUit(r),
    inruil: (r.tradeVehicleText || r.tradeVehicleLicense || r.tradeVehicleVin) ? {
      omschrijving: r.tradeVehicleText || null, kenteken: r.tradeVehicleLicense || null,
      vin: r.tradeVehicleVin || null, prijs: bedrag(r.tradeVehiclePrice),
      km: r.tradeVehicleMilage != null ? Number(r.tradeVehicleMilage) : null,
      bpm: bedrag(r.tradeVehicleBpm),
    } : null,
  };
}

(async () => {
  const begonnen = Date.now();
  const e = env();
  const jaar = new Date().getUTCFullYear();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext(fs.existsSync(SESSIE) ? { storageState: SESSIE } : {});
  const page = await ctx.newPage(); page.setDefaultTimeout(45000);
  const pool = new pg.Pool({ connectionString: process.env.PVP_PG });
  try {
    if (!fs.existsSync(SESSIE)) await opnieuwInloggen(page, e);
    else { await page.goto(e.MOBILOX_URL, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1200); }

    // De voorraad zoals hij in Mobilox staat: dat zijn de advertenties. Hieruit halen we het
    // product-id, zodat PVP naar de advertentie kan doorlinken, plus de vraagprijs en of hij online
    // staat — de twee dingen die je op de autopagina wilt zien zonder over te schakelen.
    const producten = await page.evaluate(async () => {
      const r = await fetch('https://api.mobilox.nl/api/v2/products?page=1&limit=500&sort=id%3Adesc&category=VOERTUIGEN_AUTO&productStatus=all', { credentials: 'include' });
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      return (j && j.products) ? j.products.map(p => ({ id: p.id, prijs: p.price,
        online: p.publishedToWeb === true, vin: ((p.attributeValues || {}).VIN || '').trim(),
        kenteken: ((p.attributeValues || {}).LICEN || '').trim(), titel: p.title || '' })) : null;
    });
    console.log(producten ? `advertenties in Mobilox: ${producten.length}` : 'advertenties: niet op te halen');

    const regels = [];
    for (const type of [2, 3]) {
      const rauw = await haal(page, e, type, jaar);
      console.log(`${SOORTEN[type]}en opgehaald: ${rauw.length}`);
      rauw.forEach(r => regels.push(uitRegel(r, SOORTEN[type])));
    }

    const { rows: autos } = await pool.query('SELECT id, vin, kenteken, merk, model, status, klaar, route FROM vehicles');
    const perVin = new Map(), perKent = new Map();
    autos.forEach(a => { if (norm(a.vin)) perVin.set(norm(a.vin), a); if (norm(a.kenteken)) perKent.set(norm(a.kenteken), a); });
    // De schrijfwijze die PVP zelf al gebruikt, zodat een inruil geen tweede variant van een merk
    // introduceert (Mobilox schrijft "Citroen", PVP "Citroën").
    const merken = new Map();
    autos.forEach(a => { if (a.merk) merken.set(inruil.merkSleutel(a.merk), a.merk); });

    let opVin = 0, opKenteken = 0, geen = 0, zonderVin = 0;
    const raak = [], mis = [];
    for (const r of regels) {
      if (!r.vin) zonderVin++;
      const a = (r.vin && perVin.get(norm(r.vin))) || (r.kenteken && perKent.get(norm(r.kenteken))) || null;
      if (a) { (r.vin && perVin.get(norm(r.vin)) ? opVin++ : opKenteken++); raak.push({ r, a }); }
      else { geen++; mis.push(r); }
    }
    console.log(`\nregels totaal: ${regels.length}`);
    console.log(`  gekoppeld op VIN      : ${opVin}`);
    console.log(`  gekoppeld op kenteken : ${opKenteken}`);
    console.log(`  geen auto in PVP      : ${geen}`);
    console.log(`  regel zonder VIN      : ${zonderVin}`);

    const inruilen = regels.filter(r => r.inruil);
    const inruilBekend = inruilen.filter(r => r.inruil.vin && perVin.get(norm(r.inruil.vin))).length;
    console.log(`\ninruilen in de gegevens: ${inruilen.length}  (waarvan ${inruilBekend} al in PVP)`);
    console.log(`met afleverdatum        : ${regels.filter(r => r.afleverdatum).length}`);

    console.log('\n=== wat er zou gebeuren ===');
    const nogNietVerkocht = raak.filter(x => x.a.status !== 'verkocht' && x.a.status !== 'gemeld verkocht');
    console.log(`  ${nogNietVerkocht.length} auto('s) zouden als verkocht gemeld worden:`);
    for (const { r, a } of nogNietVerkocht.slice(0, 12))
      console.log(`     ${(a.merk + ' ' + a.model).padEnd(26)} ${String(a.kenteken).padEnd(11)} ${r.soort} ${r.nummer} · ${r.datum} · € ${r.prijs}` +
        (r.afleverdatum ? ` · aflever ${r.afleverdatum}` : ' · geen afleverdatum'));
    if (nogNietVerkocht.length > 12) console.log(`     … en nog ${nogNietVerkocht.length - 12}`);
    const alVerkocht = raak.length - nogNietVerkocht.length;
    if (alVerkocht) console.log(`  ${alVerkocht} regel(s) horen bij een auto die al verkocht of gemeld is — met rust laten.`);

    // ===== wat er per auto gebeurt =====
    // Een factuur wint van een overeenkomst: die heeft het definitieve nummer, de datum en het
    // bedrag. Staan ze allebei voor dezelfde auto, dan telt de factuur.
    const { rows: gezienRij } = await pool.query('SELECT soort, extern_id FROM mobilox_gezien');
    const gezien = new Set(gezienRij.map(r => r.soort + ':' + r.extern_id));
    const nieuw = raak.filter(x => !gezien.has(x.r.soort + ':' + x.r.externId));
    const perAuto = new Map();
    for (const x of nieuw) {
      const b = perAuto.get(x.a.id);
      if (!b || (x.r.soort === 'factuur' && b.r.soort !== 'factuur')) perAuto.set(x.a.id, x);
    }
    console.log(`\nnieuw sinds de vorige ronde: ${nieuw.length} regel(s) over ${perAuto.size} auto('s)`);

    const vandaag = new Date(); vandaag.setUTCHours(0,0,0,0);
    const toekomst = d => planning.toekomst(d, vandaag.getTime());
    const token = (fs.existsSync('/var/pvp/verkoop.env')
      ? (/^PVP_VERKOOP_TOKEN=(.*)$/m.exec(fs.readFileSync('/var/pvp/verkoop.env','utf8')) || [])[1] : '') || '';
    if (ECHT && !token) throw new Error('PVP_VERKOOP_TOKEN ontbreekt — zonder token weigert /api/verkocht terecht');

    const uitkomsten = { gemeld:0, verkocht:0, vervangen:0, ongewijzigd:0, botsing:0, 'geen-auto':0, mislukt:0, carport:0, inruil:0, advertentie:0, aangevuld:0 };
    for (const { r, a } of perAuto.values()) {
      const regel = `${(a.merk+' '+a.model).padEnd(24)} ${String(a.kenteken).padEnd(11)} ${r.soort} ${r.nummer}`;
      if (!ECHT) { console.log('  zou melden: ' + regel + `  € ${r.prijs} · ${r.datum}` + (r.afleverdatum?` · aflever ${r.afleverdatum}`:'')); continue; }
      let uit = 'mislukt';
      try {
        const res = await fetch(PVP + '/api/verkocht', { method:'POST',
          headers: { 'Content-Type':'application/json', Authorization: 'Bearer ' + token },
          // Een FACTUUR is een verkoop die rond is: die bevestigt meteen (definitief) en verhuist de
          // regel in het Autoboek. Een overeenkomst niet — die kan nog wijzigen of vervallen en
          // blijft 'gemeld verkocht' staan.
          // vervangt: een factuur mag een eerdere melding uit de overeenkomst overschrijven — die
          // heeft het definitieve nummer. Een overeenkomst nooit; die komt eerst.
          // De auto is hierboven al gevonden, dus sturen we het PVP-id en niet het VIN uit Mobilox.
          // Er staan auto's in PVP met een streepje in het VIN-veld (oude inruilers); die koppelen op
          // kenteken, en dan wijst het VIN uit Mobilox naar niets en kreeg de melding een 404.
          body: JSON.stringify({ voertuig: a.id, factuurnummer: String(r.nummer), soort: r.soort,
            vervangt: r.soort === 'factuur', definitief: r.soort === 'factuur',
            factuurdatum: r.datum, verkoopprijs: r.prijs, bron: 'mobilox-agent (' + r.soort + ')' }) });
        const j = await res.json().catch(()=>({}));
        // 404 is geen storing maar een feit: Mobilox verkoopt ook auto's die nooit in PVP hebben
        // gestaan (doorverkochte inruilers). Dat als "mislukt" tellen zou de koppeling elke ronde
        // als kapot laten zien, en dan kijkt niemand meer naar de melding die er wél toe doet.
        uit = res.status === 409 ? 'botsing' : res.status === 404 ? 'geen-auto'
            : (res.ok ? (j.bevestigd ? 'verkocht' : (j.vervangen ? 'vervangen' : (j.ongewijzigd ? 'ongewijzigd' : 'gemeld'))) : 'mislukt');
        // Ging de auto naar het Autoboek, dan hoort dat in beeld: mislukt dát, dan staat de verkoop
        // wél in PVP en niet in het boek, en dat is precies het verschil dat je wilt zien.
        if (j.autoboek && j.autoboek.status === 'fout') console.log('     !! Autoboek: ' + j.autoboek.fout);
        else if (j.autoboek && j.autoboek.rij) console.log('     -> Autoboek: rij ' + j.autoboek.rij + ' op Verkochte Autos');
        uitkomsten[uit] = (uitkomsten[uit]||0) + 1;
        console.log(`  ${uit.padEnd(12)} ${regel}` + (uit==='mislukt'||uit==='geen-auto' ? '  -> ' + (j.error||res.status) : ''));
      } catch (err) { console.log('  mislukt      ' + regel + '  -> ' + err.message); uitkomsten.mislukt++; }
      await pool.query(`INSERT INTO mobilox_gezien (soort,extern_id,nummer,vin,vehicle_id,uitkomst,verwerkt_ts)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (soort,extern_id) DO UPDATE SET uitkomst=EXCLUDED.uitkomst, verwerkt_ts=EXCLUDED.verwerkt_ts`,
        [r.soort, r.externId, r.nummer, r.vin, a.id, uit, Date.now()]);

      // Een auto zonder werkbon op de planning zetten. Bewust alleen hier, bij een regel die we voor
      // het eerst zien: een auto die Carport al heeft afgemeld heeft geen open bon meer, en die mag
      // niet elke ronde opnieuw op de planning verschijnen. Het bijhouden van de datum gebeurt
      // verderop, over álle regels.
      if (toekomst(r.afleverdatum)) {
        const bon = await pool.query("SELECT id FROM carport_bonnen WHERE vehicle_id=$1 AND status='open'", [a.id]);
        if (!bon.rows.length) {
          await pool.query(`INSERT INTO carport_bonnen (vehicle_id, afleverdatum, aangemaakt_ts, aangemaakt_door)
                            VALUES ($1,$2,$3,'mobilox-agent')`, [a.id, r.afleverdatum, Date.now()]);
          uitkomsten.carport++;
          console.log(`     -> op de Carport-planning gezet, aflevering ${r.afleverdatum}`);
        }
      }
    }

    // Ook de regels die het aflegden tegen een factuur als gezien vastleggen. Deden we dat niet, dan
    // bleef zo'n overeenkomst elke ronde "nieuw" en botste hij tegen het factuurnummer dat er al
    // stond — elke nacht opnieuw dezelfde valse melding.
    if (ECHT) for (const { r, a } of nieuw) {
      if (perAuto.get(a.id) && perAuto.get(a.id).r.externId === r.externId) continue;   // de winnaar
      await pool.query(`INSERT INTO mobilox_gezien (soort,extern_id,nummer,vin,vehicle_id,uitkomst,verwerkt_ts)
        VALUES ($1,$2,$3,$4,$5,'overgeslagen',$6) ON CONFLICT (soort,extern_id) DO NOTHING`,
        [r.soort, r.externId, r.nummer, r.vin, a.id, Date.now()]);
    }

    // De advertentie aan de auto hangen. Elke ronde, want een prijs verandert en een auto gaat online
    // en weer offline. Alleen schrijven als er iets verandert, anders staat updated_at elke ronde te
    // schuiven op auto's waar niets mee gebeurt.
    if (ECHT && producten) {
      let bij = 0;
      const { rows: nu } = await pool.query('SELECT id, mobilox_id, mobilox_prijs, mobilox_online FROM vehicles');
      const stand = new Map(nu.map(r => [r.id, r]));
      for (const p of producten) {
        const a = (p.vin && perVin.get(norm(p.vin))) || (p.kenteken && perKent.get(norm(p.kenteken))) || null;
        if (!a) continue;
        const s = stand.get(a.id) || {};
        const prijs = p.prijs == null ? null : Number(p.prijs);
        const gelijk = Number(s.mobilox_id) === Number(p.id)
          && (s.mobilox_prijs === null ? null : Number(s.mobilox_prijs)) === prijs
          && s.mobilox_online === p.online;
        if (gelijk) continue;
        await pool.query('UPDATE vehicles SET mobilox_id=$2, mobilox_prijs=$3, mobilox_online=$4, mobilox_ts=$5 WHERE id=$1',
          [a.id, p.id, prijs, p.online, Date.now()]);
        bij++;
      }
      if (bij) { uitkomsten.advertentie = bij; console.log(`  ${bij} advertentie(s) gekoppeld of bijgewerkt`); }

      // Lege velden aanvullen uit de advertentie. Mobilox weet van elke auto die te koop staat de
      // kleur, de brandstof en of het een automaat is; PVP hoeft dat niet nog eens te laten intikken.
      //
      // Alleen wat in PVP LEEG is. Wat er staat is met de hand gezet of uit de inkoopstukken gelezen,
      // en dat overschrijven met een advertentietekst is geen aanvullen maar overrulen. Het gaat via
      // PUT /api/vehicle en niet met eigen SQL: daar zitten de controle op dubbele kentekens en de
      // regel naar het Autoboek al in.
      // Datums uit Mobilox komen als 2017-07-18; PVP schrijft dd-mm-jjjj.
      const isoNaarNl = x => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x || '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
      // Een importauto heeft nog geen Nederlandse toelatingsdatum, wél een buitenlandse — en dát is
      // voor die auto de eerste toelating. Zonder die terugval blijft 1e reg. leeg bij precies de
      // auto's die het langst in het traject zitten.
      const VULBAAR = [['kleur','COLOR'], ['brandstof','FUEL'], ['transm','TRANS'], ['uitv','TYPE'],
                       ['merk','BRAND'], ['model','MODEL'], ['vin','VIN'], ['kenteken','LICEN'],
                       ['reg','RDW_DATUM_EERSTE_TOELATING_NATIONAAL', isoNaarNl],
                       ['reg','RDW_DATUM_EERSTE_TOELATING_INTERNATIONAAL', isoNaarNl],
                       ['km','KILOM']];
      const leegIn = x => x === null || x === undefined || String(x).trim() === '' || String(x).trim() === '—';
      const rauw = await page.evaluate(async () => {
        const r = await fetch('https://api.mobilox.nl/api/v2/products?page=1&limit=500&sort=id%3Adesc&category=VOERTUIGEN_AUTO&productStatus=all', { credentials: 'include' });
        const j = r.ok ? await r.json().catch(() => null) : null;
        return (j && j.products) ? j.products.map(p => ({ id: p.id, av: p.attributeValues || {} })) : [];
      });
      const { rows: volledig } = await pool.query('SELECT * FROM vehicles');
      const perPvpId = new Map(volledig.map(r => [r.id, r]));
      const bezet = new Set(volledig.map(r => norm(r.kenteken)).filter(Boolean));
      let gevuld = 0;
      for (const p of rauw) {
        const a = (p.av.VIN && perVin.get(norm(p.av.VIN))) || (p.av.LICEN && perKent.get(norm(p.av.LICEN))) || null;
        if (!a) continue;
        const v = perPvpId.get(a.id); if (!v) continue;
        const body = { id: v.id };
        for (const [veld, attr, omzet] of VULBAAR) {
          if (body[veld] !== undefined) continue;              // een eerdere bron won al
          if (!leegIn(v[veld]) || leegIn(p.av[attr])) continue;
          const w = omzet ? omzet(p.av[attr]) : String(p.av[attr]).trim();
          if (w === null || w === '') continue;
          // Een kenteken dat al bij een andere auto staat nooit invullen: dan maak je een dubbele.
          if (veld === 'kenteken' && bezet.has(norm(w))) continue;
          body[veld] = w;
        }
        if (Object.keys(body).length === 1) continue;
        try {
          const res = await fetch(PVP + '/api/vehicle', { method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify(body) });
          const j = await res.json().catch(() => ({}));
          if (res.ok && (j.gewijzigd || []).length) {
            gevuld++;
            console.log(`  aangevuld uit de advertentie: ${a.merk} ${a.model} ${v.kenteken || v.vin} -> ${j.gewijzigd.join(', ')}` +
              ((j.autoboek || {}).status === 'fout' ? '  !! Autoboek: ' + j.autoboek.fout : ''));
            if (body.kenteken) bezet.add(norm(body.kenteken));
          } else if (!res.ok) console.log(`  aanvullen mislukt voor ${v.id}: ${j.error || res.status}`);
        } catch (err) { console.log(`  aanvullen mislukt voor ${v.id}: ${err.message}`); }
      }
      if (gevuld) uitkomsten.aangevuld = gevuld;
    }

    // De afleverdatum bijhouden, elke ronde en over álle gekoppelde regels — niet alleen bij een
    // regel die we voor het eerst zien. Wordt een aflevering in Mobilox verzet, dan is dat precies
    // wat Carport en de poetser moeten weten, en de agenda hangt eraan. Zie planning.js.
    {
      const regels = await planning.bijwerkenAfleverdata(pool, raak, vandaag.getTime(), !ECHT);
      regels.forEach(x => console.log(x));
      if (ECHT) uitkomsten.carport += regels.length;
    }

    // Afspraken uit de overeenkomst als regels op de werkbon. Dit gebeurt elke ronde over álle
    // gekoppelde auto's, niet alleen bij een nieuw verwerkte regel: wordt er later in Mobilox een
    // afspraak bijgeschreven, dan komt die er alsnog bij. Dubbelen worden voorkomen door de tekst te
    // vergelijken, niet door te onthouden wat we al gedaan hebben.
    if (ECHT) for (const { r, a } of raak) {
      if (!r.taken.length) continue;
      const bon = (await pool.query("SELECT id FROM carport_bonnen WHERE vehicle_id=$1 AND status='open' ORDER BY id DESC LIMIT 1", [a.id])).rows[0];
      if (!bon) continue;
      const { rows: al } = await pool.query('SELECT lower(tekst) t FROM carport_taken WHERE bon_id=$1', [bon.id]);
      const bestaat = new Set(al.map(x => x.t));
      const { rows: [bn] } = await pool.query('SELECT notities::text n FROM carport_bonnen WHERE id=$1', [bon.id]);
      let bij = 0;
      for (const t of r.taken) {
        if (bestaat.has(t.tekst.toLowerCase())) continue;
        if (t.soort === 'notitie') {
          if (bn && bn.n && bn.n.toLowerCase().includes(t.tekst.toLowerCase())) continue;
          await pool.query('UPDATE carport_bonnen SET notities = notities || $2::jsonb, updated_at=now() WHERE id=$1',
            [bon.id, JSON.stringify([{ ts: Date.now(), door: 'mobilox-agent', rol: 'prieva', soort: 'technisch', tekst: t.tekst }])]);
        } else {
          await pool.query("INSERT INTO carport_taken (bon_id, soort, tekst, door, aangemaakt_ts) VALUES ($1,$2,$3,'mobilox',$4)",
            [bon.id, t.soort, t.tekst, Date.now()]);
          bestaat.add(t.tekst.toLowerCase());
          uitkomsten.taken = (uitkomsten.taken || 0) + 1; bij++;
        }
      }
      if (bij) console.log(`  ${bij} afspraak/afspraken op de werkbon van ${a.merk} ${a.model}`);
    }

    // Een inruil op een verkoopovereenkomst is een FEIT: die auto komt bij de aflevering binnen.
    // Hij wordt dus aangemaakt bij Komende, precies wat "komend" betekent — afgesproken, nog niet er.
    //
    // Alleen voor een inruil die we nog niet eerder gezien hebben. De regels die er al liggen zijn
    // geschiedenis: die auto's zijn allang binnengekomen of alweer weg, en die alsnog aanmaken zou
    // de catalogus vullen met auto's die er niet meer zijn.
    if (ECHT) for (const r of regels.filter(x => x.inruil)) {
      const i = r.inruil;
      if ((await pool.query('SELECT id FROM mobilox_inruil WHERE extern_id=$1', [r.externId])).rows.length) continue;
      const auto = inruil.autoUit(i, r, merken);
      let status = 'geen sleutel', pvpId = null, melding = null;
      if (auto) {
        try {
          const res = await fetch(PVP + '/api/vehicle', { method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify(auto) });
          const j = await res.json().catch(() => ({}));
          if (res.status === 409) { status = 'bestond al'; pvpId = j.id || null; }
          else if (res.ok) {
            status = 'overgenomen'; pvpId = j.id || null;
            uitkomsten.inruil++;
            console.log(`  inruil overgenomen: ${auto.merk || '?'} ${auto.model || ''} ${auto.kenteken || ''} (bij ${r.soort} ${r.nummer})`);
            if (j.autoboek && j.autoboek.status === 'fout') console.log('     !! Autoboek: ' + j.autoboek.fout);
          } else { status = 'mislukt'; melding = j.error || String(res.status); }
        } catch (err) { status = 'mislukt'; melding = err.message; }
      }
      await pool.query(`INSERT INTO mobilox_inruil (extern_id,vin,kenteken,omschrijving,prijs,km,bpm,gezien_ts,status,pvp_id,melding)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [r.externId, i.vin, i.kenteken, i.omschrijving, i.prijs, i.km, i.bpm, Date.now(), status, pvpId, melding]);
      if (status === 'mislukt') { console.log(`  inruil MISLUKT: ${i.omschrijving || i.kenteken} -> ${melding}`); uitkomsten.mislukt++; }
    }

    if (ECHT) {
      const samen = Object.entries(uitkomsten).filter(([,n])=>n).map(([k,n])=>`${n} ${k}`).join(', ') || 'niets te doen';
      console.log('\nuitkomst: ' + samen);
      await meld(pool, 'mobilox', !uitkomsten.mislukt, samen, begonnen);
      if (uitkomsten.mislukt) process.exitCode = 1;      // luid falen, niet stil
    } else console.log('\n>>> PROEFDRAAI — er is niets geschreven.');
  } catch (err) {
    console.error('MISLUKT:', err.message);
    if (ECHT) await meld(pool, 'mobilox', false, err.message, begonnen);
    process.exitCode = 1;
  } finally {
    await browser.close(); await pool.end();
  }
})();
