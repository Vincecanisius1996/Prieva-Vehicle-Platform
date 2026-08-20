// Verkenner: logt in op Mobilox en beschrijft de STRUCTUUR van de pagina's — adressen, formulieren,
// knoppen, tabelkoppen. Bewust geen celinhoud: om selectors te schrijven heb ik de vorm nodig, geen
// klantgegevens. Wat er wel uit komt is een kaart van de omgeving, waarmee de echte agent gebouwd
// kan worden.
//
// Inloggegevens komen uit /var/pvp/mobilox.env — nooit uit de code, nooit via de chat.
//   MOBILOX_URL=https://...
//   MOBILOX_GEBRUIKER=...
//   MOBILOX_WACHTWOORD=...
// Draaien:  node verken.js                (headless, slaat de sessie op)
//           node verken.js --zichtbaar    (met venster, voor de eerste keer bij tweestapsverificatie)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ZICHTBAAR = process.argv.includes('--zichtbaar');
const SESSIE = '/var/pvp/mobilox-sessie.json';
const UIT = path.join(__dirname, 'verkenning.txt');

function env() {
  const pad = '/var/pvp/mobilox.env';
  if (!fs.existsSync(pad)) throw new Error(pad + ' bestaat niet — zet daar MOBILOX_URL, MOBILOX_GEBRUIKER en MOBILOX_WACHTWOORD in (chmod 600).');
  const o = {};
  for (const r of fs.readFileSync(pad, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(r.trim()); if (m) o[m[1]] = m[2];
  }
  if (!o.MOBILOX_URL) throw new Error('MOBILOX_URL ontbreekt in ' + pad);
  return o;
}

// Wachten tot de pagina klaar is met doorsturen. members.mobilox.nl stuurt na het laden door naar
// het inlogscherm; beschrijf je te vroeg, dan wordt de context onder je vandaan gehaald.
async function bedaard(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
}

// Beschrijf een pagina zonder de inhoud prijs te geven. Wordt er tijdens het kijken alsnog
// genavigeerd, dan is dat geen fout maar een herkansing waard.
async function beschrijf(page, naam, poging = 1) {
  try { return await beschrijfEcht(page, naam); }
  catch (e) {
    if (poging < 3 && /context was destroyed|Execution context/i.test(e.message)) {
      await bedaard(page); return beschrijf(page, naam, poging + 1);
    }
    return `\n===== ${naam} =====\nadres: ${page.url()}\nBESCHRIJVEN MISLUKT: ${e.message}`;
  }
}
async function beschrijfEcht(page, naam) {
  const uit = [`\n===== ${naam} =====`, 'adres: ' + page.url(), 'titel: ' + await page.title()];
  const velden = await page.$$eval('input,select,textarea', els => els.map(e => ({
    tag: e.tagName.toLowerCase(), type: e.type || '', naam: e.name || '', id: e.id || '',
    plh: e.getAttribute('placeholder') || '', label: (e.labels && e.labels[0] && e.labels[0].innerText || '').trim().slice(0, 40)
  })));
  if (velden.length) { uit.push('invoervelden:'); velden.slice(0, 40).forEach(v =>
    uit.push(`   <${v.tag}${v.type ? ' type=' + v.type : ''}> naam=${v.naam || '-'} id=${v.id || '-'} ${v.label ? 'label="' + v.label + '"' : ''} ${v.plh ? 'plh="' + v.plh + '"' : ''}`)); }
  const links = await page.$$eval('a', els => els.map(a => ({ tekst: (a.innerText || '').trim().slice(0, 44), href: a.getAttribute('href') || '' }))
    .filter(x => x.tekst));
  const uniek = [...new Map(links.map(l => [l.tekst + '|' + l.href, l])).values()];
  if (uniek.length) { uit.push(`links (${uniek.length}, eerste 40):`); uniek.slice(0, 40).forEach(l => uit.push(`   "${l.tekst}"  ->  ${l.href}`)); }
  const knoppen = await page.$$eval('button,[role=button],input[type=submit]', els =>
    [...new Set(els.map(b => (b.innerText || b.value || '').trim()).filter(Boolean))].slice(0, 30));
  if (knoppen.length) uit.push('knoppen: ' + knoppen.join(' | '));
  // Tabellen: alleen de koppen en het aantal rijen. Cellen blijven buiten beeld.
  const tabellen = await page.$$eval('table', els => els.map(t => ({
    koppen: [...t.querySelectorAll('th')].map(h => (h.innerText || '').trim()).filter(Boolean).slice(0, 25),
    rijen: t.querySelectorAll('tbody tr').length })).filter(t => t.koppen.length || t.rijen));
  tabellen.forEach((t, i) => uit.push(`tabel ${i + 1}: ${t.rijen} rijen — koppen: ${t.koppen.join(' | ') || '(geen th)'}`));
  return uit.join('\n');
}

(async () => {
  const e = env();
  const browser = await chromium.launch({ headless: !ZICHTBAAR });
  const context = await browser.newContext(
    fs.existsSync(SESSIE) ? { storageState: SESSIE } : {});
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const stukken = [];
  try {
    await page.goto(e.MOBILOX_URL, { waitUntil: 'domcontentloaded' });
    await bedaard(page);
    stukken.push(await beschrijf(page, 'startpagina (voor inloggen)'));

    // Inloggen als er een wachtwoordveld staat. Staat het er niet, dan werkte de bewaarde sessie nog.
    const pw = await page.$('input[type=password]');
    if (pw) {
      if (!e.MOBILOX_GEBRUIKER || !e.MOBILOX_WACHTWOORD) throw new Error('inloggen nodig, maar MOBILOX_GEBRUIKER/MOBILOX_WACHTWOORD ontbreken');
      const gb = await page.$('input[type=text],input[type=email],input[name*=user i],input[name*=gebruik i]');
      if (gb) await gb.fill(e.MOBILOX_GEBRUIKER);
      await pw.fill(e.MOBILOX_WACHTWOORD);
      await Promise.all([
        page.waitForLoadState('networkidle').catch(() => {}),
        pw.press('Enter'),
      ]);
      await bedaard(page);
      await page.waitForTimeout(2500);
      stukken.push(await beschrijf(page, 'na inloggen'));
      if (await page.$('input[type=password]'))
        stukken.push('\nLET OP: er staat nog een wachtwoordveld. Inloggen is niet gelukt, of er is een tweede stap (code).');
    } else {
      // Geen wachtwoordveld betekent niet automatisch "ingelogd" — op een reclamepagina staat er ook
      // geen. Daarom eerst kijken of we werkelijk binnen zijn: een uitlogknop of een menu.
      const binnen = await page.$('a[href*=logout i], a[href*=uitlog i], [class*=dashboard i], nav[class*=menu i]');
      stukken.push(binnen
        ? '\n(al ingelogd: de bewaarde sessie werkte nog)'
        : '\nLET OP: geen inlogformulier en geen teken dat we ingelogd zijn. Wijst MOBILOX_URL wel naar de inlogomgeving?');
    }
    await context.storageState({ path: SESSIE });
    fs.chmodSync(SESSIE, 0o600);
  } catch (err) {
    stukken.push('\nMISLUKT: ' + err.message);
  } finally {
    fs.writeFileSync(UIT, stukken.join('\n') + '\n');
    await browser.close();
  }
  console.log(fs.readFileSync(UIT, 'utf8'));
  console.log('\nOpgeslagen in ' + UIT);
})();
