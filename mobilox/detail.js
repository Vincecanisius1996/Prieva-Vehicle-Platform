// Opent één verkoopovereenkomst en beschrijft de detailweergave. Inhoud gemaskeerd (9/A), behalve
// labels: die heb ik nodig om te weten welk veld waar staat.
const { chromium } = require('playwright');
const fs = require('fs');
function env(){ const o={}; for(const r of fs.readFileSync('/var/pvp/mobilox.env','utf8').split('\n')){
  const m=/^([A-Z_]+)=(.*)$/.exec(r.trim()); if(m)o[m[1]]=m[2]; } return o; }
const masker = s => String(s||'').replace(/[0-9]/g,'9').replace(/[a-z]/g,'a').replace(/[A-Z]/g,'A').slice(0,34);
(async () => {
  const e = env();
  const browser = await chromium.launch({ headless:true });
  const ctx = await browser.newContext({ storageState:'/var/pvp/mobilox-sessie.json' });
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  try {
    await page.goto(e.MOBILOX_URL, { waitUntil:'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(1500);
    const admin = await page.$('text="Administratie"'); if (admin){ await admin.click().catch(()=>{}); await page.waitForTimeout(1000); }
    const link = await page.$('a[href="#agreements"]'); await link.click(); await page.waitForTimeout(4000);

    // de eerste regel van de overeenkomstentabel openen
    const rij = await page.$('table:has(th:text-is("Nummer")) tbody tr');
    if (!rij) { console.log('geen regel gevonden'); await browser.close(); return; }
    await rij.click(); await page.waitForTimeout(3500);
    console.log('adres na openen:', page.url());

    // labels met hun waarde-vorm
    const paren = await page.evaluate(() => {
      const uit = [];
      document.querySelectorAll('label, dt, th, .label, strong, b').forEach(l => {
        const t = (l.innerText||'').replace(/\s+/g,' ').trim();
        if (!t || t.length > 40) return;
        let w = '';
        const n = l.nextElementSibling; if (n) w = (n.innerText||'').replace(/\s+/g,' ').trim();
        uit.push([t, w]);
      });
      return uit.slice(0, 60);
    });
    console.log('\nlabels en de vorm van hun waarde:');
    for (const [l, w] of paren) if (l) console.log('  ' + l.padEnd(30) + (w ? masker(w) : ''));

    const tab = await page.$$eval('table', els => els.map(t => ({
      koppen: [...t.querySelectorAll('th')].map(h=>(h.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean),
      rijen: t.querySelectorAll('tbody tr').length })));
    console.log('\ntabellen in de detailweergave:');
    tab.forEach((t,i)=>{ if(t.koppen.length) console.log(`  ${i+1}: ${t.rijen} rijen — ${t.koppen.join(' | ')}`); });

    const tekst = await page.evaluate(()=> (document.body.innerText||'').replace(/\s+/g,' '));
    for (const woord of ['Kenteken','Chassis','VIN','Inruil','Meeneem','Aflever','Handelsnaam','BPM'])
      console.log(`  woord "${woord}" in beeld: ${new RegExp(woord,'i').test(tekst) ? 'JA' : 'nee'}`);
  } catch (err) { console.error('MISLUKT:', err.message); }
  finally { await browser.close(); }
})();
