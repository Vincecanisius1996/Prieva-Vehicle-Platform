// Haalt uit een verkoopovereenkomst de regels die een taak zijn.
//
// De taken staan in Mobilox verspreid over twee velden: `comments` (meestal) en `footerText`
// (soms). Gemeten op 109 overeenkomsten van 2026: 169 taakregels in comments, 83 in de footer.
// Beide dus lezen — alleen de footer nemen zou tweederde missen.
//
// Wat eruit gaat: alles over de aanbetaling. Dat is een afspraak met de klant, geen werk voor de
// werkplaats. De meldcode telt daarbij mee omdat die in de praktijk altijd in een betaalzin staat
// ("onder vermelding van meldcode 8526").
const AANBETALING = /aanbetal|vooruitbetal|overmaken|over te maken|rekeningnummer|meldcode|iban|aanbetaald|te voldoen/i;
// Regels die alléén over geld gaan. Strak gehouden: "De klant betaalt voor het uitdeuken van twee
// putjes" blijft staan, want daar zit werk in. Alleen wat begint met een puur financiële term valt af.
const ALLEEN_GELD = /^(bijbetaling|korting|contante? betaling|let op:?\s*€)/i;

// Een kop is geen taak. "Gemaakte afspraken:" met daaronder een opsomming zou anders als los
// klusje bij Carport belanden.
const KOP = /^(gemaakte afspraken|afspraken|besproken|overeengekomen)\b.*:?\s*$/i;

// Soort bepalen. De volgorde is het hele verhaal: veel regels bevatten woorden uit twee soorten en
// de eerste die past, wint. Vandaar deze volgorde, van meest specifiek naar meest algemeen:
//
//   schade   "linkerzijde uitgedeukt … na polijstbeurt" is plaatwerk, geen poetsbeurt. Zonder deze
//            regel vóór poetsen en beurt belandde die regel bij de poetser of bij een onderhoudsbeurt.
//   poetsen  "grondig schoongemaakt" en "polijstbeurt" horen bij de poetser. Let op "schoongemaak":
//            het woord in de overeenkomsten is "schoongemaakt", en dat matcht niet op "schoonmaak" —
//            precies daardoor stond de interieur- en exterieurbeurt van de Astra bij Carport.
//   apk      staat ná schade: "APK en lakschade herstellen" is werkplaatswerk.
//   beurt    als laatste vóór de vangnetregel: "beurt" zit in polijstbeurt, poetsbeurt én afleverbeurt.
const SOORT = [
  ['reparatie', /uitgedeukt|uitdeuk|\bdeuk|inlak|lakschade|bijtipp?e|bijwerk|steenslag|kras(sen)?\b|schade|revisie|richten/i],
  ['poetsen',   /poets|polijst|wass(en)?|zuig|reinig|cleanen|schoonmaak|schoongemaak|schoonmak|stofferen|detailing|interieur\s*(en|&|\/|\+)\s*exterieur|exterieur\s*(en|&|\/|\+)\s*interieur/i],
  ['apk',       /\bapk\b|keuring/i],
  ['onderdeel', /bestell|onderdeel|inbouwen|monteren|vervangen door (een )?nieuw/i],
  ['beurt',     /beurt|onderhoud|service|olie/i],
  ['reparatie', /.*/],
];

// Regels die iets vertéllen in plaats van iets opdragen. "Verkoop onder handelsvoorwaarden" en "de
// auto zit nog in een importproces" zijn geen werk; als taak op een werkbon vragen ze om een vinkje
// dat nooit gezet kan worden. Ze worden een notitie, net als een ontkenning.
const INFO = /verkocht onder|verkoop onder|handelsvoorwaarden|handelscondities|importproces|nog in (het )?import|wacht(en|end)? op|onder voorbehoud|zonder garantie|geen garantie/i;

function soortVan(regel) {
  for (const [naam, patroon] of SOORT) if (patroon.test(regel)) return naam;
  return 'reparatie';
}

// Een regel die zegt dat iets NIET hoeft, is geen taak maar een afspraak om te weten. "Auto hoeft
// niet professioneel gewassen te worden" als poetsklus inplannen doet precies het omgekeerde.
const ONTKENNING = /\bhoeft? niet\b|\bniet nodig\b|\bgeen\b.*\bnodig\b|\bniet hoeven\b|\bvervalt\b/i;

// Opsommingstekens en nummering weghalen, maar de tekst verder met rust laten.
const schoon = r => r.replace(/^[-–—•*·]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();

/**
 * @param {{comments?:string, footerText?:string}} overeenkomst
 * @returns {Array<{soort:string, tekst:string, bron:'comments'|'footer'}>}
 */
function takenUit(overeenkomst) {
  const uit = [];
  for (const [bron, tekst] of [['comments', overeenkomst.comments], ['footer', overeenkomst.footerText]]) {
    for (const ruw of String(tekst || '').split('\n')) {
      // Eén regel kan twee afspraken bevatten. Splitsen op een zinseinde gevolgd door een
      // hoofdletter; "1.2 PureTech" blijft daardoor heel, want daar volgt geen spatie plus hoofdletter.
      for (const deel of schoon(ruw).split(/(?<=[.!?])\s+(?=[A-Z])/)) {
        const r = schoon(deel).replace(/[.;]\s*$/, '');
        if (!r || r.length < 3) continue;               // losse tekens zijn geen taak
        if (KOP.test(r)) continue;
        if (AANBETALING.test(r) || ALLEEN_GELD.test(r)) continue;
        uit.push({ soort: (ONTKENNING.test(r) || INFO.test(r)) ? 'notitie' : soortVan(r), tekst: r.slice(0, 300), bron });
      }
    }
  }
  // Dezelfde afspraak staat soms in allebei de velden.
  const gezien = new Set();
  return uit.filter(t => { const k = t.tekst.toLowerCase(); if (gezien.has(k)) return false; gezien.add(k); return true; });
}

module.exports = { takenUit, soortVan, AANBETALING, KOP, INFO, SOORT };
