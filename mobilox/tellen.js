const { chromium } = require('playwright');
const fs = require('fs');
function env(){ const o={}; for(const r of fs.readFileSync('/var/pvp/mobilox.env','utf8').split('\n')){
  const m=/^([A-Z_]+)=(.*)$/.exec(r.trim()); if(m)o[m[1]]=m[2]; } return o; }
const isAanbetaling = r => /aanbetal|vooruitbetal|overmaken op|rekeningnummer|meldcode|iban|betaal/i.test(r);
(async () => {
  const e = env();
  const browser = await chromium.launch({ headless:true });
  const ctx = await browser.newContext({ storageState:'/var/pvp/mobilox-sessie.json' });
  const page = await ctx.newPage(); page.setDefaultTimeout(45000);
  try {
    await page.goto(e.MOBILOX_URL, { waitUntil:'domcontentloaded' }); await page.waitForTimeout(1500);
    const j = await page.evaluate(async () => {
      const r = await fetch('https://api.mobilox.nl/api/v2/quotations?type=2&year=' + new Date().getFullYear(), { credentials:'include' });
      return r.ok ? await r.json() : null;
    });
    const regels = t => String(t||'').split('\n').map(x=>x.trim()).filter(Boolean);
    let fT=0, cT=0, fTaken=0, cTaken=0, fAanb=0, cAanb=0;
    for (const x of j) {
      const f = regels(x.footerText), c = regels(x.comments);
      if (f.length) fT++; if (c.length) cT++;
      fTaken += f.filter(r=>!isAanbetaling(r)).length; fAanb += f.filter(isAanbetaling).length;
      cTaken += c.filter(r=>!isAanbetaling(r)).length; cAanb += c.filter(isAanbetaling).length;
    }
    console.log(`overeenkomsten: ${j.length}\n`);
    console.log('              gevuld   regels over aanbetaling   regels die een taak zijn');
    console.log(`footerText    ${String(fT).padStart(6)}   ${String(fAanb).padStart(22)}   ${String(fTaken).padStart(22)}`);
    console.log(`comments      ${String(cT).padStart(6)}   ${String(cAanb).padStart(22)}   ${String(cTaken).padStart(22)}`);
    console.log('\nvoorbeelden van taakregels uit comments:');
    const alle = [];
    j.forEach(x => regels(x.comments).filter(r=>!isAanbetaling(r)).forEach(r=>alle.push(r)));
    [...new Set(alle)].slice(0,18).forEach(r=>console.log('   • '+r.slice(0,64)));
  } catch (err) { console.error('MISLUKT:', err.message); }
  finally { await browser.close(); }
})();
