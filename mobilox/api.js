// Roept het interne endpoint aan dat de webomgeving zelf gebruikt. Toont de SLEUTELS en de vorm van
// de waarden (cijfers -> 9, letters -> A), niet de klantgegevens.
const { chromium } = require('playwright');
const fs = require('fs');
function env(){ const o={}; for(const r of fs.readFileSync('/var/pvp/mobilox.env','utf8').split('\n')){
  const m=/^([A-Z_]+)=(.*)$/.exec(r.trim()); if(m)o[m[1]]=m[2]; } return o; }
const masker = v => v===null?null : typeof v==='number'?'<getal>' : typeof v==='boolean'?v :
  String(v).replace(/[0-9]/g,'9').replace(/[a-z]/g,'a').replace(/[A-Z]/g,'A').slice(0,34);
function vorm(o, diepte=0){
  if (Array.isArray(o)) return o.length ? [`<lijst van ${o.length}>`, vorm(o[0], diepte+1)] : ['<lege lijst>'];
  if (o && typeof o==='object') { const u={}; for(const [k,v] of Object.entries(o)) u[k] = (v&&typeof v==='object')? (diepte<2?vorm(v,diepte+1):'<object>') : masker(v); return u; }
  return masker(o);
}
(async () => {
  const e = env();
  const browser = await chromium.launch({ headless:true });
  const ctx = await browser.newContext({ storageState:'/var/pvp/mobilox-sessie.json' });
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  try {
    await page.goto(e.MOBILOX_URL, { waitUntil:'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(1500);
    const jaar = new Date().getUTCFullYear();
    for (const [naam, pad] of [
      ['overeenkomsten (type=2)', `/api/v2/quotations?type=2&year=${jaar}`],
      ['facturen (type=3)',       `/api/v2/quotations?type=3&year=${jaar}`],
      ['offertes (type=1)',       `/api/v2/quotations?type=1&year=${jaar}`],
    ]) {
      const r = await page.evaluate(async p => {
        try { const res = await fetch('https://api.mobilox.nl'+p, { credentials:'include' });
              return { status: res.status, json: await res.json().catch(()=>null) }; }
        catch (err) { return { status: 0, json: null, fout: String(err) }; }
      }, pad);
      console.log(`\n===== ${naam} =====`);
      console.log('  status:', r.status);
      if (r.status !== 200 || !r.json) { console.log('  geen bruikbaar antwoord:', r.status, r.fout||''); continue; }
      const j = r.json;
      const lijst = Array.isArray(j) ? j : (j.data || j.items || j.results || j);
      console.log('  aantal:', Array.isArray(lijst) ? lijst.length : '(geen lijst)');
      if (Array.isArray(lijst) && lijst.length) {
        console.log('  velden van één regel:');
        const v = vorm(lijst[0]);
        for (const [k, w] of Object.entries(v)) console.log(`    ${k.padEnd(26)} ${JSON.stringify(w)}`.slice(0,150));
      } else { console.log('  vorm:', JSON.stringify(vorm(j)).slice(0,400)); }
    }
  } catch (err) { console.error('MISLUKT:', err.message); }
  finally { await browser.close(); }
})();
