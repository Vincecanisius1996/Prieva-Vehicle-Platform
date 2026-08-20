// Kijkt hoe een factuurregel geopend wordt, ZONDER iets te wijzigen of te versturen. Alleen lezen:
// de opbouw van een regel, welke knoppen eraan hangen en welke attributen er op staan.
const { chromium } = require('playwright');
const fs = require('fs');
function env(){ const o={}; for(const r of fs.readFileSync('/var/pvp/mobilox.env','utf8').split('\n')){
  const m=/^([A-Z_]+)=(.*)$/.exec(r.trim()); if(m)o[m[1]]=m[2]; } return o; }
(async () => {
  const e = env();
  const browser = await chromium.launch({ headless:true });
  const ctx = await browser.newContext({ storageState:'/var/pvp/mobilox-sessie.json' });
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  try {
    await page.goto(e.MOBILOX_URL, { waitUntil:'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(1500);
    const admin = await page.$('text="Administratie"'); if (admin){ await admin.click().catch(()=>{}); await page.waitForTimeout(1000); }
    const link = await page.$('a[href="#invoices"]'); await link.click(); await page.waitForTimeout(4500);
    console.log('adres:', page.url());

    // De opbouw van de eerste factuurregel: attributen, geen tekst.
    const rij = await page.evaluate(() => {
      const t = [...document.querySelectorAll('table')].find(x => [...x.querySelectorAll('th')].some(h=>/Nummer/i.test(h.innerText)));
      if (!t) return null;
      const tr = t.querySelector('tbody tr'); if (!tr) return null;
      const attr = {}; for (const a of tr.attributes) attr[a.name] = a.value;
      const cellen = [...tr.querySelectorAll('td')].map(td => ({
        klasse: td.className || '',
        kinderen: [...td.children].map(c => c.tagName.toLowerCase() + (c.className?'.'+String(c.className).split(' ')[0]:'')).join(',')
      }));
      return { attr, cellen, kolommen: cellen.length };
    });
    console.log('\neerste regel — attributen:', JSON.stringify(rij && rij.attr));
    (rij ? rij.cellen : []).forEach((c,i)=>console.log(`  cel ${i}: klasse="${c.klasse}" kinderen=${c.kinderen||'(alleen tekst)'}`));

    // Welke knoppen zijn er, en zijn ze uitgeschakeld tot je een regel kiest?
    const knoppen = await page.$$eval('button, a.btn', els => els.map(b => ({
      tekst: (b.innerText||'').replace(/\s+/g,' ').trim().slice(0,28),
      uit: b.disabled || b.classList.contains('disabled'),
      klasse: String(b.className||'').split(' ').slice(0,2).join('.')
    })).filter(b=>b.tekst));
    console.log('\nknoppen (uit = uitgeschakeld):');
    [...new Map(knoppen.map(k=>[k.tekst,k])).values()].slice(0,18).forEach(k=>console.log(`  ${k.uit?'[uit] ':'      '}${k.tekst.padEnd(26)} ${k.klasse}`));

    // Wat gebeurt er bij het aanklikken van een regel: navigeert hij, of selecteert hij?
    const voorAdres = page.url();
    const tr = await page.$('table:has(th:text-is("Nummer")) tbody tr');
    if (tr) {
      await tr.click(); await page.waitForTimeout(3000);
      console.log('\nna klikken op een regel:');
      console.log('  adres:', page.url(), voorAdres===page.url()?'(ongewijzigd — selecteert dus)':'(genavigeerd)');
      const naKnoppen = await page.$$eval('button, a.btn', els => els.filter(b=>!(b.disabled||b.classList.contains('disabled')))
        .map(b=>(b.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean));
      console.log('  nu bruikbare knoppen:', [...new Set(naKnoppen)].slice(0,14).join(' | '));
    }
  } catch (err) { console.error('MISLUKT:', err.message); }
  finally { await browser.close(); }
})();
