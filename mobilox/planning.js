// De afleverdatum uit Mobilox naar de werkbon van Carport.
//
// Apart van agent.js zodat dit te toetsen is zonder browser en zonder Mobilox: het is de enige plek
// waar een agent iets overschrijft dat een mens ook zelf kan hebben ingevuld, en juist dát wil je
// kunnen nakijken.
//
// Mobilox wint bewust van wat er in PVP staat: die datum is met de koper afgesproken en staat in de
// verkoopovereenkomst. Een verzetting komt wél als notitie op de bon, zodat het geen stille wijziging
// is. Wil je een andere datum, verzet hem dan in Mobilox.

// Alleen een afleverdatum die nog moet komen is planning; een aflevering uit april is geschiedenis en
// hoort niet in de lijst van Carport of in de agenda.
function toekomst(d, vandaag) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(d || ''));
  return !!m && Date.UTC(+m[3], +m[2] - 1, +m[1]) >= vandaag;
}

// Eén regel per auto: een factuur wint van een overeenkomst, want die is de laatste stand.
function perAutoBeste(raak, vandaag) {
  const uit = new Map();
  for (const { r, a } of raak) {
    if (!toekomst(r.afleverdatum, vandaag)) continue;
    const b = uit.get(a.id);
    if (!b || (r.soort === 'factuur' && b.r.soort !== 'factuur')) uit.set(a.id, { r, a });
  }
  return uit;
}

async function bijwerkenAfleverdata(pool, raak, vandaag, proef) {
  const regels = [];
  for (const { r, a } of perAutoBeste(raak, vandaag).values()) {
    const bon = (await pool.query(
      "SELECT id, afleverdatum FROM carport_bonnen WHERE vehicle_id=$1 AND status='open' ORDER BY id DESC LIMIT 1",
      [a.id])).rows[0];
    if (!bon || bon.afleverdatum === r.afleverdatum) continue;
    const was = bon.afleverdatum;
    if (!proef) await pool.query('UPDATE carport_bonnen SET afleverdatum=$2, updated_at=now() WHERE id=$1', [bon.id, r.afleverdatum]);
    if (was && !proef) await pool.query('UPDATE carport_bonnen SET notities = notities || $2::jsonb WHERE id=$1',
      [bon.id, JSON.stringify([{ ts: Date.now(), door: 'mobilox-agent', rol: 'prieva', soort: 'technisch',
        tekst: `Afleverdatum verzet van ${was} naar ${r.afleverdatum} volgens Mobilox.` }])]);
    regels.push(`  ${proef ? 'zou verzetten: ' : ''}afleverdatum ${was || '(leeg)'} -> ${r.afleverdatum} bij ${a.merk} ${a.model}`);
  }
  return regels;
}

module.exports = { toekomst, perAutoBeste, bijwerkenAfleverdata };
