// PVP — het importdossier: wat de RDW van een importauto wil zien, en of het er is.
//
// De lijst is gelijk aan PHOTO_GROUPS in index.html ("conform Mobilox"), met twee toevoegingen die
// een controle aan de serverkant nodig heeft:
//   - `bron`  : niet elk stuk staat in vehicles.photos. Het taxatierapport staat in bpm_reports.
//   - `req`   : mag een functie zijn. Een auto op route NEE heeft geen BPM-taxatierapport nodig;
//               die als onvolledig tellen maakt de check waardeloos.
//
// LET OP: deze lijst staat ook in index.html als PHOTO_GROUPS. Wijzig je hier een sleutel of een
// verplichting, wijzig het daar dan mee — net als BPM_GELDIG_DAGEN. Het endpoint stuurt de lijst
// mee in zijn antwoord, zodat de frontend hem later kan overnemen en de kopie kan verdwijnen.

const STUKKEN = [
  // Voertuig — foto's van de auto zelf, stap "RDW Foto's".
  { key: 'v_linksvoor',       groep: 'Voertuig',     bron: 'photos', req: true,  label: 'Voertuig linksvoor' },
  { key: 'v_rechtsachter',    groep: 'Voertuig',     bron: 'photos', req: true,  label: 'Voertuig rechtsachter' },
  { key: 'v_vin',             groep: 'Voertuig',     bron: 'photos', req: true,  label: 'Ingeslagen voertuigidentificatienummer' },
  { key: 'v_constructieplaat',groep: 'Voertuig',     bron: 'photos', req: true,  label: 'Constructieplaat' },
  { key: 'v_cp2',             groep: 'Voertuig',     bron: 'photos', req: false, label: 'Constructieplaat 2e fase fabrikant' },
  { key: 'v_cp3',             groep: 'Voertuig',     bron: 'photos', req: false, label: 'Constructieplaat 3e fase fabrikant' },
  { key: 'v_teller',          groep: 'Voertuig',     bron: 'photos', req: true,  label: 'Tellerstand' },
  // Documentatie — foto's van de papieren, stap "Papieren Foto's".
  { key: 'd_kb1v',            groep: 'Documentatie', bron: 'photos', req: true,  label: 'Buitenlands kentekenbewijs deel I — voorkant' },
  { key: 'd_kb1a',            groep: 'Documentatie', bron: 'photos', req: true,  label: 'Buitenlands kentekenbewijs deel I — achterkant' },
  { key: 'd_kb2v',            groep: 'Documentatie', bron: 'photos', req: false, label: 'Buitenlands kentekenbewijs deel II — voorkant' },
  { key: 'd_kb2a',            groep: 'Documentatie', bron: 'photos', req: false, label: 'Buitenlands kentekenbewijs deel II — achterkant' },
  { key: 'd_cov_v',           groep: 'Documentatie', bron: 'photos', req: false, label: 'Certificaat van Overeenstemming — voorkant' },
  { key: 'd_cov_a',           groep: 'Documentatie', bron: 'photos', req: false, label: 'Certificaat van Overeenstemming — achterkant' },
  { key: 'd_apk',             groep: 'Documentatie', bron: 'photos', req: false, label: 'Buitenlands APK rapport' },
  // BPM — het taxatierapport. Alleen op route JA: op route NEE gaat de BPM via de koerslijst en is
  // er geen rapport. Weigeren zou dan een eis stellen die niet bestaat.
  { key: 'bpm_rapport',       groep: 'BPM',          bron: 'bpm_reports',
    req: v => v.route === 'JA', label: 'BPM-taxatierapport', waarom: 'alleen bij route JA' },
];

// De statussen van het dossier. `dossier` is de beginstand en staat nergens in de tabel: een auto
// zonder rij staat daar gewoon op. Zo hoeft er voor de bestaande auto's niets aangemaakt te worden.
const STATUSSEN = ['dossier', 'klaar', 'ingediend', 'keuring', 'ingeschreven'];
const STATUS_LABEL = {
  dossier:      'Dossier verzamelen',
  klaar:        'Klaar voor RDW',
  ingediend:    'Ingediend bij RDW',
  keuring:      'Keuring gepland',
  ingeschreven: 'Ingeschreven',
};
// Wat een status naast zichzelf nodig heeft. Een status die iets belooft wat er niet is, is erger
// dan geen status: "keuring gepland" zonder datum laat iemand wachten op een afspraak die er niet is.
const STATUS_EIST = { ingediend: 'dossiernr', keuring: 'keuring_datum' };

const verplicht = (stuk, auto) => (typeof stuk.req === 'function' ? !!stuk.req(auto) : !!stuk.req);

// De compleetheidscheck. Puur rekenwerk: alles wat uit de database komt gaat er als argument in, zodat
// dit zonder database te toetsen is.
//   auto      : rij uit vehicles (route bepaalt of het BPM-rapport verplicht is)
//   photos    : vehicles.photos, { key: url }
//   rapporten : rijen uit bpm_reports voor deze auto, [{url,name,ts}]
function beoordeel(auto, photos, rapporten) {
  const p = photos || {};
  const rap = Array.isArray(rapporten) ? rapporten : [];
  const stukken = STUKKEN.map(s => {
    const nodig = verplicht(s, auto);
    const uit = s.bron === 'bpm_reports'
      ? (rap.length ? { url: rap[0].url, naam: rap[0].name, ts: rap[0].ts } : null)
      : (p[s.key] ? { url: p[s.key], naam: null, ts: null } : null);
    return {
      key: s.key, groep: s.groep, label: s.label, verplicht: nodig,
      waarom: s.waarom || null,
      aanwezig: !!uit,
      url: uit ? uit.url : null,
      naam: uit ? uit.naam : null,
      ts: uit ? uit.ts : null,
    };
  });
  const nodig = stukken.filter(s => s.verplicht);
  const ontbreekt = nodig.filter(s => !s.aanwezig).map(s => ({ key: s.key, label: s.label }));
  return {
    stukken,
    ontbreekt,
    compleet: ontbreekt.length === 0,
    telling: { verplicht: nodig.length, aanwezig: nodig.filter(s => s.aanwezig).length },
  };
}

module.exports = { STUKKEN, STATUSSEN, STATUS_LABEL, STATUS_EIST, verplicht, beoordeel };
