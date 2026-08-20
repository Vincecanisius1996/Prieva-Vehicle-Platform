// Haalt de volledige navigatieboom op. De omgeving werkt met hash-routes en ingeklapte menu's, dus
// zichtbare links tellen niet: we lezen alle href-waarden uit de opmaak, ook van wat dichtgeklapt is.
const { chromium } = require('playwright');
const fs = require('fs');
function env(){ const o={}; for(const r of fs.readFileSync('/var/pvp/mobilox.env','utf8').split('\n')){
  const m=/^([A-Z_]+)=(.*)$/.exec(r.trim()); if(m)o[m[1]]=m[2]; } return o; }
(async () => {
  const e = env();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext(fs.existsSync('/var/pvp/mobilox-sessie.json') ? { storageState:'/var/pvp/mobilox-sessie.json' } : {});
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  try {
    await page.goto(e.MOBILOX_URL, { waitUntil:'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(()=>{});
    await page.waitForTimeout(1500);
    const pw = await page.$('input[type=password]');
    if (pw) {
      await (await page.$('#_username')).fill(e.MOBILOX_GEBRUIKER);
      await pw.fill(e.MOBILOX_WACHTWOORD);
      await pw.press('Enter');
      await page.waitForLoadState('networkidle').catch(()=>{});
      await page.waitForTimeout(3500);
      await ctx.storageState({ path:'/var/pvp/mobilox-sessie.json' }); fs.chmodSync('/var/pvp/mobilox-sessie.json',0o600);
    }
    // Alle href-waarden uit de hele opmaak, ook uit ingeklapte menu's.
    const alles = await page.$$eval('a[href]', els => els.map(a => ({
      h: a.getAttribute('href') || '',
      t: (a.textContent||'').replace(/\s+/g,' ').trim().slice(0,50)
    })));
    const routes = [...new Map(alles.filter(x=>x.h.startsWith('#')).map(x=>[x.h,x])).values()];
    console.log('=== hash-routes in het menu ('+routes.length+') ===');
    for (const r of routes) console.log('  '+r.h.padEnd(38)+r.t);
    const leeg = alles.filter(x=>!x.h||x.h==='javascript:void(0);'||x.h==='javascript:void(0)');
    console.log('\n=== menukoppen zonder eigen adres (klapmenu\'s) ===');
    console.log('  '+[...new Set(leeg.map(x=>x.t).filter(Boolean))].join(' | '));
    fs.writeFileSync('menu.txt', JSON.stringify({routes,leeg:[...new Set(leeg.map(x=>x.t))]},null,1));
  } catch (err) { console.error('MISLUKT:', err.message); }
  finally { await browser.close(); }
})();
