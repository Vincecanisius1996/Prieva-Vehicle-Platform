// Vastleggen hoe een achtergrondtaak afliep, in de tabel agent_runs — één regel per taak.
//
// Waarom in de database en niet alleen in het journaal: een koppeling die stil faalt is erger dan
// geen koppeling, want dan denk je dat het beeld op het scherm klopt. Dit staat in de database,
// dus PVP kan het tonen aan de mensen die ernaar kijken, in plaats van te wachten tot iemand
// journalctl draait.
async function meld(pool, naam, ok, melding, begonnen) {
  const nu = Date.now();
  try {
    // gelukt_ts wordt hier uitgerekend en niet in SQL: een CASE over dezelfde parameter laat
    // PostgreSQL het type van die parameter niet meer afleiden, en dan mislukt de hele regel.
    await pool.query(
      `INSERT INTO agent_runs (naam, ts, ok, melding, duur_ms, gelukt_ts)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (naam) DO UPDATE SET ts=EXCLUDED.ts, ok=EXCLUDED.ok, melding=EXCLUDED.melding,
         duur_ms=EXCLUDED.duur_ms,
         gelukt_ts = coalesce(EXCLUDED.gelukt_ts, agent_runs.gelukt_ts)`,
      [naam, nu, !!ok, melding ? String(melding).slice(0, 500) : null,
       begonnen ? nu - begonnen : null, ok ? nu : null]);
  } catch (e) {
    // Het vastleggen mag de taak zelf nooit laten mislukken.
    console.error('draaiverslag niet opgeslagen:', e.message);
  }
}

module.exports = { meld };
