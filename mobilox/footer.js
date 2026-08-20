const { chromium } = require('playwright');
const fs = require('fs');
function env(){ const o={}; for(const r of fs.readFileSync('/var/pvp/mobilox.env','utf8').split('\n')){
  const m=/^([A-Z_]+)=(.*)$/.exec(r.trim()); if(m)o[m[1]]=m[2]; } return o; }
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
    const c3 = j.filter(x => /citro/i.test((x.product&&x.product.title)||'') && /c3/i.test((x.product&&x.product.title)||''));
    console.log('Citroën C3-overeenkomsten gevonden: ' + c3.length + '\n');
    for (const x of c3) {
      const av = (x.product&&x.product.attributeValues)||{};
      console.log('===== overeenkomst ' + x.number + '  ·  ' + x.createdAt + '  ·  ' + (x.product.title||'') + ' =====');
      console.log('  kenteken ' + (av.LICEN||'—') + '   VIN ' + (av.VIN||'—') + '   aflever ' + (x.deliveryDate||'—'));
      console.log('  --- introductionText ---'); console.log(x.introductionText ? '  '+String(x.introductionText).split('\n').join('\n  ') : '  (leeg)');
      console.log('  --- footerText ---');       console.log(x.footerText       ? '  '+String(x.footerText).split('\n').join('\n  ')       : '  (leeg)');
      console.log('  --- comments ---');         console.log(x.comments         ? '  '+String(x.comments).split('\n').join('\n  ')         : '  (leeg)');
      console.log('  --- quotationLines (' + (x.quotationLines||[]).length + ') ---');
      (x.quotationLines||[]).forEach(l => console.log('   • ' + JSON.stringify(l).slice(0,180)));
      console.log();
    }
    // hoe vaak is footerText überhaupt gevuld?
    const metFooter = j.filter(x=>x.footerText && String(x.footerText).trim()).length;
    console.log(`van de ${j.length} overeenkomsten heeft ${metFooter} een gevulde footerText`);
  } catch (err) { console.error('MISLUKT:', err.message); }
  finally { await browser.close(); }
})();
