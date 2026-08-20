// Beschrijft de administratieschermen. De celinhoud wordt gemaskeerd: cijfers -> 9, letters -> A.
// Zo zie ik het FORMAAT van een kolom (datum, bedrag, kenteken) zonder de klantgegevens te lezen.
const { chromium } = require('playwright');
const fs = require('fs');
function env(){ const o={}; for(const r of fs.readFileSync('/var/pvp/mobilox.env','utf8').split('\n')){
  const m=/^([A-Z_]+)=(.*)$/.exec(r.trim()); if(m)o[m[1]]=m[2]; } return o; }
const masker = s => String(s||'').replace(/[0-9]/g,'9').replace(/[a-z]/g,'a').replace(/[A-Z]/g,'A').slice(0,28);
(async () => {
  const e = env();
  const browser = await chromium.launch({ headless:true });
  const ctx = await browser.newContext({ storageState:'/var/pvp/mobilox-sessie.json' });
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  const uit = [];
  try {
    await page.goto(e.MOBILOX_URL, { waitUntil:'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(1500);
    // Deze omgeving is een SPA: bij een volledige paginalading met een hash val je terug op het
    // dashboard. Navigeren gaat dus door het menu open te klappen en op de link te klikken, en
    // daarna te wachten tot de inhoud écht verandert.
    const admin = await page.$('text="Administratie"');
    if (admin) { await admin.click().catch(()=>{}); await page.waitForTimeout(1200); }
    for (const route of ['#agreements','#invoices','#purchases']) {
      const link = await page.$(`a[href="${route}"]`);
      if (!link) { uit.push(`\n===== ${route} =====\n  link niet gevonden in het menu`); continue; }
      const voor = await page.$$eval('table tbody tr', r=>r.length).catch(()=>0);
      await link.click().catch(()=>{});
      // wachten tot het aantal rijen verandert of de tijd om is: netwerkstilte alleen is te vroeg,
      // de tabel wordt daarna nog opgebouwd.
      for (let i=0;i<20;i++){
        await page.waitForTimeout(500);
        const nu = await page.$$eval('table tbody tr', r=>r.length).catch(()=>0);
        if (nu !== voor) break;
      }
      await page.waitForTimeout(1500);
      uit.push(`\n===== ${route} =====`);
      uit.push('adres: ' + page.url());
      const tabellen = await page.$$eval('table', els => els.map(t => ({
        koppen: [...t.querySelectorAll('thead th, thead td')].map(h=>(h.innerText||'').replace(/\s+/g,' ').trim()),
        rijen: [...t.querySelectorAll('tbody tr')].map(tr =>
          [...tr.querySelectorAll('td')].map(td=>(td.innerText||'').replace(/\s+/g,' ').trim()))
      })));
      if (!tabellen.length) uit.push('  (geen tabel gevonden — laadt dit scherm zijn gegevens anders?)');
      tabellen.forEach((t,i)=>{
        uit.push(`  tabel ${i+1}: ${t.rijen.length} rijen, ${t.koppen.length} kolommen`);
        if (t.koppen.length) uit.push('    koppen : ' + t.koppen.join(' | '));
        if (t.rijen.length) {
          uit.push('    vorm   : ' + t.rijen[0].map(masker).join(' | '));
          if (t.rijen[1]) uit.push('    vorm 2 : ' + t.rijen[1].map(masker).join(' | '));
        }
      });
      // knoppen, filters en of er een detailpagina per regel is
      const knoppen = await page.$$eval('button,a.btn,input[type=submit]', els =>
        [...new Set(els.map(b=>(b.innerText||b.value||'').replace(/\s+/g,' ').trim()).filter(Boolean))].slice(0,20));
      if (knoppen.length) uit.push('  knoppen: ' + knoppen.join(' | '));
      const detail = await page.$$eval('tbody tr a[href]', els =>
        [...new Set(els.map(a=>(a.getAttribute('href')||'').replace(/\d+/g,'{nr}')))].slice(0,6));
      if (detail.length) uit.push('  detailadres per regel: ' + detail.join('  '));
      const velden = await page.$$eval('input,select', els => els.map(x=>`${x.tagName.toLowerCase()}[${x.type||''}] naam=${x.name||'-'}`).slice(0,12));
      if (velden.length) uit.push('  filters/velden: ' + velden.join(' , '));
    }
  } catch (err) { uit.push('MISLUKT: ' + err.message); }
  finally { await browser.close(); }
  const t = uit.join('\n');
  fs.writeFileSync('schermen.txt', t + '\n');
  console.log(t);
})();
