// Opent de factuur zelf via de cel met klasse js-goto en beschrijft de opbouw. Alleen lezen: er
// wordt niets ingevuld, opgeslagen of verstuurd. Celinhoud gemaskeerd (9/A), labels wel leesbaar —
// die heb ik nodig om te weten welk veld waar staat.
const { chromium } = require('playwright');
const fs = require('fs');
function env(){ const o={}; for(const r of fs.readFileSync('/var/pvp/mobilox.env','utf8').split('\n')){
  const m=/^([A-Z_]+)=(.*)$/.exec(r.trim()); if(m)o[m[1]]=m[2]; } return o; }
const masker = s => String(s||'').replace(/[0-9]/g,'9').replace(/[a-z]/g,'a').replace(/[A-Z]/g,'A').slice(0,40);
(async () => {
  const e = env();
  const browser = await chromium.launch({ headless:true });
  const ctx = await browser.newContext({ storageState:'/var/pvp/mobilox-sessie.json' });
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  try {
    await page.goto(e.MOBILOX_URL, { waitUntil:'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(1500);
    const admin = await page.$('text="Administratie"'); if (admin){ await admin.click().catch(()=>{}); await page.waitForTimeout(1000); }
    await (await page.$('a[href="#invoices"]')).click(); await page.waitForTimeout(4500);

    const cel = await page.$('table:has(th:text-is("Nummer")) tbody tr td.js-goto');
    if (!cel) { console.log('geen js-goto-cel gevonden'); await browser.close(); return; }
    await cel.click(); await page.waitForTimeout(4000);
    console.log('adres van de factuur:', page.url());

    const tabellen = await page.$$eval('table', els => els.map(t => ({
      koppen: [...t.querySelectorAll('th')].map(h=>(h.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean),
      rijen: [...t.querySelectorAll('tbody tr')].map(tr=>[...tr.querySelectorAll('td')].map(td=>(td.innerText||'').replace(/\s+/g,' ').trim()))
    })));
    console.log('\ntabellen op de factuur:');
    tabellen.forEach((t,i)=>{
      if(!t.koppen.length && !t.rijen.length) return;
      console.log(`  tabel ${i+1}: ${t.rijen.length} rijen`);
      if(t.koppen.length) console.log('    koppen: ' + t.koppen.join(' | '));
      t.rijen.slice(0,6).forEach((r,j)=>console.log(`    regel ${j+1}: ` + r.map(masker).join(' | ')));
    });

    // Waar zit het woord "inruil" en wat staat eromheen?
    const rond = await page.evaluate(() => {
      const uit=[]; const w=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n; while((n=w.nextNode())){ const t=(n.nodeValue||'').trim();
        if(/inruil|meeneem|ingeruild/i.test(t)) uit.push({tekst:t.slice(0,70), ouder:n.parentElement?n.parentElement.tagName.toLowerCase()+'.'+String(n.parentElement.className||'').split(' ')[0]:''}); }
      return uit.slice(0,8);
    });
    console.log('\nwaar "inruil" voorkomt:');
    rond.length ? rond.forEach(r=>console.log(`  <${r.ouder}> "${r.tekst}"`)) : console.log('  (niet gevonden op deze factuur)');

    const tekst = await page.evaluate(()=> (document.body.innerText||'').replace(/\s+/g,' '));
    console.log('\nwoorden in beeld:');
    for (const w of ['Kenteken','Chassis','VIN','Inruil','Subtotaal','BTW','Totaal','Marge','Aanbetaling','Aflever'])
      console.log(`  ${w.padEnd(12)} ${new RegExp(w,'i').test(tekst)?'JA':'nee'}`);
  } catch (err) { console.error('MISLUKT:', err.message); }
  finally { await browser.close(); }
})();
