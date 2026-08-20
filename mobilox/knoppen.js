// Welke knoppen hangen er aan één factuurregel, en waar wijzen ze heen? Alleen kijken.
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
    await (await page.$('a[href="#invoices"]')).click(); await page.waitForTimeout(4500);

    const knoppen = await page.evaluate(() => {
      const t = [...document.querySelectorAll('table')].find(x => [...x.querySelectorAll('th')].some(h=>/Nummer/i.test(h.innerText)));
      const tr = t && t.querySelector('tbody tr'); if (!tr) return null;
      return [...tr.querySelectorAll('a,button')].map(a => ({
        tag: a.tagName.toLowerCase(),
        href: (a.getAttribute('href')||'').replace(/\d{3,}/g,'{id}'),
        klasse: String(a.className||''),
        titel: a.getAttribute('title') || a.getAttribute('data-original-title') || '',
        icoon: (a.querySelector('i,span[class*=icon],svg')||{}).className || '',
        data: Object.fromEntries([...a.attributes].filter(x=>x.name.startsWith('data-')).map(x=>[x.name, String(x.value).replace(/\d{3,}/g,'{id}')]))
      }));
    });
    console.log('knoppen op één factuurregel:');
    (knoppen||[]).forEach((k,i)=>console.log(`  ${i+1}. <${k.tag}> href="${k.href}" klasse="${k.klasse}" titel="${k.titel}" icoon="${k.icoon}" data=${JSON.stringify(k.data)}`));

    // Netwerkverkeer meekijken: wat vraagt de pagina op als je de lijst opent? Daar zit vaak een
    // json-endpoint achter dat veel steviger is dan het scherm uitlezen.
    const calls = [];
    page.on('request', r => { const u=r.url(); if(/ajax|json|api|admin/i.test(u) && !/\.(css|js|png|jpg|woff)/i.test(u)) calls.push(r.method()+' '+u.replace(/\d{4,}/g,'{id}')); });
    await (await page.$('a[href="#agreements"]')).click(); await page.waitForTimeout(3500);
    await (await page.$('a[href="#invoices"]')).click(); await page.waitForTimeout(3500);
    console.log('\nverzoeken die de pagina zelf doet:');
    [...new Set(calls)].slice(0,15).forEach(c=>console.log('  '+c));
  } catch (err) { console.error('MISLUKT:', err.message); }
  finally { await browser.close(); }
})();
