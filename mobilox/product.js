const { chromium } = require('playwright');
const fs = require('fs');
function env(){ const o={}; for(const r of fs.readFileSync('/var/pvp/mobilox.env','utf8').split('\n')){
  const m=/^([A-Z_]+)=(.*)$/.exec(r.trim()); if(m)o[m[1]]=m[2]; } return o; }
const masker = v => v===null?null : typeof v!=='string'?'<'+typeof v+'>' :
  v.replace(/[0-9]/g,'9').replace(/[a-z]/g,'a').replace(/[A-Z]/g,'A').slice(0,30);
(async () => {
  const e = env();
  const browser = await chromium.launch({ headless:true });
  const ctx = await browser.newContext({ storageState:'/var/pvp/mobilox-sessie.json' });
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  try {
    await page.goto(e.MOBILOX_URL, { waitUntil:'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(1500);
    const j = await page.evaluate(async () => {
      const r = await fetch('https://api.mobilox.nl/api/v2/quotations?type=3&year=' + new Date().getFullYear(), { credentials:'include' });
      return r.ok ? await r.json() : null;
    });
    if (!j || !j.length) { console.log('geen gegevens'); await browser.close(); return; }
    const av = (j[0].product && j[0].product.attributeValues) || {};
    console.log('sleutels in product.attributeValues (' + Object.keys(av).length + '):');
    for (const [k,v] of Object.entries(av)) console.log('  ' + k.padEnd(26) + JSON.stringify(masker(v)));
    console.log('\nsleutels die op een identificatie lijken:');
    for (const k of Object.keys(av)) if (/vin|chassis|licen|kenteken|meldcode|plate/i.test(k)) console.log('  ' + k + ' = ' + JSON.stringify(masker(av[k])));
    // Hoeveel van de facturen hebben een inruil, en hoeveel een afleverdatum?
    const metInruil = j.filter(x=>x.tradeVehicleText||x.tradeVehicleLicense).length;
    const metAflever = j.filter(x=>x.deliveryDate).length;
    console.log(`\nvan de ${j.length} facturen dit jaar: ${metInruil} met inruil, ${metAflever} met afleverdatum`);
  } catch (err) { console.error('MISLUKT:', err.message); }
  finally { await browser.close(); }
})();
