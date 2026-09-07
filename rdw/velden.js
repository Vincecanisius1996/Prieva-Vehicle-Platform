// PVP — het importdossier: wat de RDW van een importvoertuig wil zien, en of het er is.
//
// SINDS 07-09-2026 HANGT DE LIJST AAN DE VOERTUIGSOORT. Daarvóór was alles op personenauto's
// gebouwd: één lijst voor elk voertuig. Een lichte bedrijfsauto vraagt om foto's van de laadruimte
// en de scheidingswand, een motorfiets om het motornummer, en een aanhangwagen om veel minder —
// Sjoerd kon een bedrijfswagen daardoor niet goed toevoegen.
//
// DIT IS DE ENIGE LIJST. `index.html` haalt hem op via GET /api/velden en heeft alleen nog een
// terugval voor als de API wegvalt. Daarvóór stond dezelfde lijst hier én als PHOTO_GROUPS in de
// frontend, met een waarschuwing in CLAUDE.md om ze samen bij te werken — met vier soorten zou dat
// acht lijsten op twee plekken worden.

/* De vier soorten uit de RDW-app. `personenauto` is de standaard: `vehicles.voertuigsoort` leeg
   betekent personenauto, zodat de bestaande auto's ongemoeid blijven. */
const SOORTEN = [
  { code: 'personenauto', label: 'Personenvoertuig (M1)' },
  { code: 'bedrijfsauto', label: 'Lichte bedrijfsauto (N1, ≤ 3500 kg)' },
  { code: 'motorfiets',   label: 'Bromfiets of motorfiets (L1e–L7e)' },
  { code: 'aanhangwagen', label: 'Aanhangwagen snelverkeer (O2)' },
];
const STANDAARD_SOORT = 'personenauto';
const soortVan = v => {
  const s = String((v && v.voertuigsoort) || '').trim();
  return SOORTEN.some(x => x.code === s) ? s : STANDAARD_SOORT;
};

/* Per stuk staat er per soort wat de RDW ermee wil:
     'verplicht' | 'optioneel' | (ontbreekt) = niet van toepassing
   Die derde stand is nieuw en is de kern van deze wijziging: een vakje dat voor deze soort niet
   bestaat hoort te verdwijnen, niet als "optioneel" te blijven staan en verwarring te zaaien.

   `bron` zegt waar het stuk vandaan komt: `photos` is de jsonb op de auto, `bpm_reports` een
   aparte tabel. `eis` mag ook een functie zijn — dat gebruikt alleen het taxatierapport, want dat
   hangt aan de ROUTE en niet aan de soort. */
const V = 'verplicht', O = 'optioneel';
const ALLE  = { personenauto: V, bedrijfsauto: V, motorfiets: V, aanhangwagen: V };
const ALLE_O = { personenauto: O, bedrijfsauto: O, motorfiets: O, aanhangwagen: O };

const STUKKEN = [
  // --- Voertuig: foto's van de auto zelf, stap "RDW Foto's" ---
  { key: 'v_linksvoor',        groep: 'Voertuig', bron: 'photos', label: 'Voertuig linksvoor',                       eis: ALLE },
  { key: 'v_rechtsachter',     groep: 'Voertuig', bron: 'photos', label: 'Voertuig rechtsachter',                    eis: ALLE },
  { key: 'v_vin',              groep: 'Voertuig', bron: 'photos', label: 'Ingeslagen voertuigidentificatienummer',   eis: ALLE },
  { key: 'v_vin2',             groep: 'Voertuig', bron: 'photos', label: 'Ingeslagen voertuigidentificatienummer aanvullend',
    eis: { motorfiets: O } },
  { key: 'v_constructieplaat', groep: 'Voertuig', bron: 'photos', label: 'Constructieplaat',                         eis: ALLE },
  { key: 'v_cp2',              groep: 'Voertuig', bron: 'photos', label: 'Constructieplaat 2e fase fabrikant',
    eis: { personenauto: O, bedrijfsauto: O } },
  { key: 'v_cp3',              groep: 'Voertuig', bron: 'photos', label: 'Constructieplaat 3e fase fabrikant',
    eis: { personenauto: O, bedrijfsauto: O } },
  { key: 'v_teller',           groep: 'Voertuig', bron: 'photos', label: 'Tellerstand',
    eis: { personenauto: V, bedrijfsauto: V, motorfiets: O } },
  { key: 'v_motornummer',      groep: 'Voertuig', bron: 'photos', label: 'Ingeslagen motornummer',
    eis: { motorfiets: O } },
  // De drie laadruimtefoto's die een lichte bedrijfsauto extra vraagt.
  { key: 'v_laadruimte_fisc',  groep: 'Voertuig', bron: 'photos', label: 'Laadruimte fiscale afmetingen',
    eis: { bedrijfsauto: V } },
  { key: 'v_scheidingswand',   groep: 'Voertuig', bron: 'photos', label: 'Bevestiging scheidingswand',
    eis: { bedrijfsauto: V } },
  { key: 'v_laadruimte_zij',   groep: 'Voertuig', bron: 'photos', label: 'Laadruimte zijwanden',
    eis: { bedrijfsauto: V } },

  // --- Documentatie: foto's van de papieren, stap "Papieren Foto's" ---
  { key: 'd_kb1v',   groep: 'Documentatie', bron: 'photos', label: 'Buitenlands kentekenbewijs deel I — voorkant',   eis: ALLE },
  { key: 'd_kb1a',   groep: 'Documentatie', bron: 'photos', label: 'Buitenlands kentekenbewijs deel I — achterkant', eis: ALLE },
  { key: 'd_kb2v',   groep: 'Documentatie', bron: 'photos', label: 'Buitenlands kentekenbewijs deel II — voorkant',  eis: ALLE_O },
  { key: 'd_kb2a',   groep: 'Documentatie', bron: 'photos', label: 'Buitenlands kentekenbewijs deel II — achterkant',eis: ALLE_O },
  { key: 'd_cov_v',  groep: 'Documentatie', bron: 'photos', label: 'Certificaat van Overeenstemming — voorkant',     eis: ALLE_O },
  { key: 'd_cov_a',  groep: 'Documentatie', bron: 'photos', label: 'Certificaat van Overeenstemming — achterkant',   eis: ALLE_O },
  { key: 'd_cov2_v', groep: 'Documentatie', bron: 'photos', label: 'Certificaat van Overeenstemming 2e fase — voorkant',
    eis: { bedrijfsauto: O } },
  { key: 'd_cov2_a', groep: 'Documentatie', bron: 'photos', label: 'Certificaat van Overeenstemming 2e fase — achterkant',
    eis: { bedrijfsauto: O } },
  { key: 'd_cov3_v', groep: 'Documentatie', bron: 'photos', label: 'Certificaat van Overeenstemming 3e fase — voorkant',
    eis: { bedrijfsauto: O } },
  { key: 'd_cov3_a', groep: 'Documentatie', bron: 'photos', label: 'Certificaat van Overeenstemming 3e fase — achterkant',
    eis: { bedrijfsauto: O } },
  { key: 'd_apk',    groep: 'Documentatie', bron: 'photos', label: 'Buitenlands APK rapport',
    eis: { personenauto: O, bedrijfsauto: O, motorfiets: O } },

  // --- BPM ---
  // Hangt aan de ROUTE, niet aan de soort: op route NEE loopt de BPM via de koerslijst en bestaat er
  // geen rapport. Op een aanhangwagen zit helemaal geen BPM, dus daar geldt het nooit (opgave Prieva
  // 07-09-2026) — ook niet als iemand per ongeluk route JA kiest.
  { key: 'bpm_rapport', groep: 'BPM', bron: 'bpm_reports', label: 'BPM-taxatierapport',
    waarom: 'alleen bij route JA; niet voor een aanhangwagen',
    eis: v => (soortVan(v) !== 'aanhangwagen' && v && v.route === 'JA') ? V : null },
];

/* Wat de RDW van DIT voertuig wil: 'verplicht', 'optioneel' of null (niet van toepassing). */
function eisVan(stuk, v) {
  if (typeof stuk.eis === 'function') return stuk.eis(v) || null;
  return stuk.eis[soortVan(v)] || null;
}

// De statussen van het dossier. Een auto zonder rij in `rdw_dossier` staat op `dossier`.
const STATUSSEN = ['dossier', 'klaar', 'ingediend', 'keuring', 'ingeschreven'];
const STATUS_LABEL = {
  dossier:      'Dossier verzamelen',
  klaar:        'Klaar voor RDW',
  ingediend:    'Ingediend bij RDW',
  keuring:      'Keuring gepland',
  ingeschreven: 'Ingeschreven',
};
const STATUS_EIST = { ingediend: 'dossiernr', keuring: 'keuring_datum' };

/* De compleetheidscheck. Puur rekenwerk: alles wat uit de database komt gaat er als argument in.
   Stukken die voor deze soort niet gelden komen NIET in de uitkomst — die bestaan niet voor dit
   voertuig, en ze als "optioneel, ontbreekt" tonen zou de lijst onleesbaar maken.
   Uitzondering: staat er wél een foto in, dan blijft het stuk zichtbaar met eis `null`. Anders zou
   een foto na een soortwissel onzichtbaar in de database blijven staan. */
function beoordeel(auto, photos, rapporten) {
  const p = photos || {};
  const rap = Array.isArray(rapporten) ? rapporten : [];
  const stukken = [];
  for (const s of STUKKEN) {
    const eis = eisVan(s, auto);
    const uit = s.bron === 'bpm_reports'
      ? (rap.length ? { url: rap[0].url, naam: rap[0].name, ts: rap[0].ts } : null)
      : (p[s.key] ? { url: p[s.key], naam: null, ts: null } : null);
    if (!eis && !uit) continue;                       // niet van toepassing en niets aanwezig
    stukken.push({
      key: s.key, groep: s.groep, label: s.label,
      eis, verplicht: eis === V, waarom: s.waarom || null,
      nvt: !eis,                                      // wél een foto, maar niet van toepassing
      aanwezig: !!uit,
      url: uit ? uit.url : null, naam: uit ? uit.naam : null, ts: uit ? uit.ts : null,
    });
  }
  const nodig = stukken.filter(s => s.verplicht);
  const ontbreekt = nodig.filter(s => !s.aanwezig).map(s => ({ key: s.key, label: s.label }));
  return {
    stukken, ontbreekt,
    compleet: ontbreekt.length === 0,
    telling: { verplicht: nodig.length, aanwezig: nodig.filter(s => s.aanwezig).length },
    soort: soortVan(auto),
  };
}

/* De lijst zoals de frontend hem nodig heeft: per soort welke stukken gelden, gegroepeerd zoals de
   kaarten op het scherm. Meegegeven door GET /api/velden. */
function velden() {
  return {
    soorten: SOORTEN,
    standaard: STANDAARD_SOORT,
    groepen: [
      { groep: 'Voertuig',     step: "RDW Foto's",      stepIdx: 0 },
      { groep: 'Documentatie', step: "Papieren Foto's", stepIdx: 1 },
    ],
    stukken: STUKKEN.map(s => ({
      key: s.key, groep: s.groep, label: s.label, bron: s.bron, waarom: s.waarom || null,
      // De functie-vorm is niet te versturen; die geldt alleen voor het BPM-rapport en dat staat
      // niet op de fotokaarten. Voor de frontend is 'route' genoeg om te weten dat het anders werkt.
      eis: typeof s.eis === 'function' ? 'route' : s.eis,
    })),
  };
}

module.exports = { SOORTEN, STANDAARD_SOORT, soortVan, STUKKEN, eisVan, velden,
                   STATUSSEN, STATUS_LABEL, STATUS_EIST, beoordeel };
