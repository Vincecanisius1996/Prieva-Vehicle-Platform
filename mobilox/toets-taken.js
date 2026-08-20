const { chromium } = require('playwright');
const fs = require('fs');
const { takenUit } = require('./taken.js');
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
    const perSoort = {}; let metTaken = 0, totaal = 0;
    const voorbeeld = {};
    for (const x of j) {
      const t = takenUit(x);
      if (t.length) metTaken++;
      totaal += t.length;
      for (const y of t) { perSoort[y.soort] = (perSoort[y.soort]||0)+1; (voorbeeld[y.soort] ||= []).push(y.tekst); }
    }
    console.log(`${j.length} overeenkomsten, ${metTaken} met taken, ${totaal} taakregels totaal\n`);
    for (const [s,n] of Object.entries(perSoort).sort((a,b)=>b[1]-a[1])) {
      console.log(`${s.padEnd(10)} ${String(n).padStart(4)}`);
      [...new Set(voorbeeld[s])].slice(0,3).forEach(v=>console.log('             • '+v.slice(0,66)));
    }
    // controle: sluipt er nog een betaalregel doorheen?
    const alle = j.flatMap(takenUit).map(t=>t.tekst);
    // let op: "eur" zit óók in "bEURtje" en "poetsbEURt" — dat gaf eerst 90 valse treffers.
    const verdacht = alle.filter(t=>/€|\beuro\b|\d\s*,-|\bbetaal|\bbedrag\b/i.test(t));
    console.log('\nregels die tóch naar geld ruiken: ' + verdacht.length);
    verdacht.slice(0,6).forEach(v=>console.log('   ! '+v.slice(0,70)));
  } catch (err) { console.error('MISLUKT:', err.message); }
  finally { await browser.close(); }
})();
