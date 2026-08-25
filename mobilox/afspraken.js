// De afspraken uit de verkoopovereenkomst bijhouden op de werkbon van Carport.
//
// Apart van agent.js zodat dit te toetsen is zonder browser en zonder Mobilox — net als planning.js.
// Het is ook de enige plek waar de agent iets van een werkbon AFHAALT, en juist dat wil je kunnen
// nakijken.
//
// Wat de agent elke ronde doet:
//   * een regel die erbij is gekomen  -> als taak toevoegen
//   * een regel die is weggehaald     -> de taak weghalen, mét een notitie op de bon
//   * een regel die is gewijzigd      -> dat is het bovenstaande na elkaar: de oude tekst staat niet
//                                        meer in de overeenkomst en de nieuwe wel
//
// Twee dingen worden nooit aangeraakt:
//   * werk dat Carport of Prieva zelf heeft toegevoegd (`door` is dan niet 'mobilox');
//   * een taak die al is afgevinkt. Dat werk ís gedaan; dat uit de administratie halen omdat de
//     verkoper de tekst heeft aangepast, wist geschiedenis. Die blijft staan met een notitie erbij.

const sleutel = t => String(t || '').trim().toLowerCase();

// Meer dan dit in één ronde weghalen is geen wijziging maar een fout — een regressie in het uitlezen
// zou anders in één klap alle afspraken van alle auto's van de werkbonnen halen. Zelfde gedachte als
// MAX_WISSEN in putState() en de grens in de agenda-koppeling: bij twijfel niets doen en het melden.
const MAX_WEG = 10;

/**
 * @param {object} pool          postgres-pool
 * @param {Array}  raak          [{r, a}] — de Mobilox-regels met de PVP-auto waar ze bij horen
 * @param {object} opties        {proef:boolean}
 * @returns {Promise<{bij:number, weg:number, notities:number, regels:string[]}>}
 */
async function bijwerken(pool, raak, opties) {
  const proef = !!(opties && opties.proef);
  const uit = { bij: 0, weg: 0, soort: 0, notities: 0, regels: [] };

  // Alle afspraken per auto bij elkaar: een auto kan zowel een overeenkomst als een factuur hebben,
  // en allebei kunnen regels bevatten. Wat op één van beide staat, geldt.
  const perAuto = new Map();
  for (const { r, a } of raak) {
    if (!r.taken || !r.taken.length) continue;
    const b = perAuto.get(a.id) || { auto: a, taken: [] };
    b.taken.push(...r.taken);
    perAuto.set(a.id, b);
  }
  // Ook auto's zónder afspraken meenemen: als de laatste regel uit de overeenkomst is gehaald, moet
  // de bijbehorende taak óók verdwijnen. Zonder dit blijft precies die ene taak eeuwig staan.
  for (const { a } of raak) if (!perAuto.has(a.id)) perAuto.set(a.id, { auto: a, taken: [] });

  // Eerst kijken wat er wég zou gaan. Is dat er te veel, dan wordt er in deze ronde niets verwijderd
  // — toevoegen mag wel, dat maakt niets stuk.
  let zouWeg = 0;
  for (const [id, b] of perAuto) {
    const bon = (await pool.query(
      "SELECT id FROM carport_bonnen WHERE vehicle_id=$1 AND status='open' ORDER BY id DESC LIMIT 1", [id])).rows[0];
    if (!bon) continue;
    const wil = new Set(b.taken.filter(t => t.soort !== 'notitie').map(t => sleutel(t.tekst)));
    const { rows } = await pool.query("SELECT tekst FROM carport_taken WHERE bon_id=$1 AND door='mobilox' AND NOT klaar", [bon.id]);
    zouWeg += rows.filter(t => !wil.has(sleutel(t.tekst))).length;
  }
  const teVeel = zouWeg > MAX_WEG;
  if (teVeel) uit.regels.push(`  ! ${zouWeg} afspraken zouden verdwijnen — dat is er te veel; er is er deze ronde geen enkele weggehaald`);
  uit.geweigerd = teVeel;

  for (const { auto, taken } of perAuto.values()) {
    const bon = (await pool.query(
      "SELECT id FROM carport_bonnen WHERE vehicle_id=$1 AND status='open' ORDER BY id DESC LIMIT 1", [auto.id])).rows[0];
    if (!bon) continue;

    const wil = new Map();                       // wat de overeenkomst nú zegt
    for (const t of taken) if (t.soort !== 'notitie') wil.set(sleutel(t.tekst), t);
    const notities = taken.filter(t => t.soort === 'notitie');

    const { rows: staat } = await pool.query(
      'SELECT id, soort, tekst, door, klaar, soort_hand FROM carport_taken WHERE bon_id=$1', [bon.id]);
    const bestaat = new Set(staat.map(x => sleutel(x.tekst)));
    const naam = `${auto.merk} ${auto.model}`.trim();

    // 1. erbij
    for (const [k, t] of wil) {
      if (bestaat.has(k)) continue;
      if (!proef) await pool.query(
        "INSERT INTO carport_taken (bon_id, soort, tekst, door, aangemaakt_ts) VALUES ($1,$2,$3,'mobilox',$4)",
        [bon.id, t.soort, t.tekst, Date.now()]);
      bestaat.add(k); uit.bij++;
      uit.regels.push(`  + ${naam}: ${t.tekst.slice(0, 70)}`);
    }

    // 1b. de soort bijstellen als het uitlezen slimmer is geworden. Niet bij een regel die iemand met
    //     de hand naar de poetser of naar Carport heeft gesleept: dat is een oordeel van een mens en
    //     dat hoort een patroon in een reguliere expressie niet elke ronde terug te draaien.
    for (const t of staat) {
      if (t.door !== 'mobilox' || t.soort_hand) continue;
      const wilT = wil.get(sleutel(t.tekst));
      if (!wilT || wilT.soort === t.soort || wilT.soort === 'notitie') continue;
      if (!proef) await pool.query('UPDATE carport_taken SET soort=$2 WHERE id=$1', [t.id, wilT.soort]);
      uit.soort = (uit.soort || 0) + 1;
      uit.regels.push(`  ~ ${naam}: "${t.tekst.slice(0, 50)}" van ${t.soort} naar ${wilT.soort}`);
    }

    // 2. eraf — alleen wat van Mobilox kwam en nog niet is afgevinkt
    for (const t of staat) {
      if (t.door !== 'mobilox' || t.klaar) continue;
      if (wil.has(sleutel(t.tekst))) continue;
      if (teVeel) continue;
      if (!proef) {
        await pool.query('DELETE FROM carport_taken WHERE id=$1', [t.id]);
        await pool.query('UPDATE carport_bonnen SET notities = notities || $2::jsonb, updated_at=now() WHERE id=$1',
          [bon.id, JSON.stringify([{ ts: Date.now(), door: 'mobilox-agent', rol: 'prieva', soort: 'technisch',
            tekst: `Vervallen: deze afspraak staat niet meer op de verkoopovereenkomst — "${t.tekst}"` }])]);
      }
      uit.weg++;
      uit.regels.push(`  − ${naam}: ${t.tekst.slice(0, 70)}`);
    }

    // 3. een afgevinkte taak die uit de overeenkomst is gehaald: laten staan, wél melden. Het werk is
    //    gedaan; dat weggooien omdat de tekst is aangepast, wist wat er gebeurd is.
    for (const t of staat) {
      if (t.door !== 'mobilox' || !t.klaar) continue;
      if (wil.has(sleutel(t.tekst))) continue;
      uit.regels.push(`  ! ${naam}: "${t.tekst.slice(0, 60)}" is van de overeenkomst gehaald maar was al afgevinkt — blijft staan`);
    }

    // 4. notities uit de overeenkomst (ontkenningen: "hoeft niet gewassen te worden")
    if (notities.length) {
      const { rows: [bn] } = await pool.query('SELECT notities::text n FROM carport_bonnen WHERE id=$1', [bon.id]);
      for (const t of notities) {
        if (bn && bn.n && bn.n.toLowerCase().includes(sleutel(t.tekst))) continue;
        if (!proef) await pool.query('UPDATE carport_bonnen SET notities = notities || $2::jsonb, updated_at=now() WHERE id=$1',
          [bon.id, JSON.stringify([{ ts: Date.now(), door: 'mobilox-agent', rol: 'prieva', soort: 'technisch', tekst: t.tekst }])]);
        uit.notities++;
      }
    }
  }
  return uit;
}

module.exports = { bijwerken, sleutel };
