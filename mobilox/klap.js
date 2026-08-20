// Klapt de menu's open die geen eigen adres hebben en kijkt welke routes daaronder verschijnen.
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
    await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(2000);
    const hrefs = async () => new Set(await page.$$eval('a[href^="#"]', els => els.map(a=>a.getAttribute('href'))));
    const voor = await hrefs();
    for (const kop of ['Administratie','Voorraadbeheer','Dashboard','Voertuigen']) {
      const el = await page.$(`text="${kop}"`);
      if (!el) { console.log(`menu "${kop}": niet gevonden`); continue; }
      await el.click({ timeout:5000 }).catch(()=>{});
      await page.waitForTimeout(1500);
      const na = await hrefs();
      const nieuw = [...na].filter(h=>!voor.has(h));
      console.log(`menu "${kop}": ${nieuw.length} nieuwe route(s)` + (nieuw.length?'  -> '+nieuw.join('  '):''));
      nieuw.forEach(h=>voor.add(h));
    }
    // Ook kijken of het adres verandert bij het openen van Administratie
    console.log('\nadres na het klikken:', page.url());
    const zichtbaar = await page.$$eval('a[href^="#"]', els => els.filter(a=>a.offsetParent!==null)
      .map(a=>a.getAttribute('href')+'  '+(a.textContent||'').replace(/\s+/g,' ').trim().slice(0,40)));
    console.log('\nzichtbare routes na openklappen ('+zichtbaar.length+'):');
    zichtbaar.slice(0,50).forEach(z=>console.log('  '+z));
  } catch (err) { console.error('MISLUKT:', err.message); }
  finally { await browser.close(); }
})();
