// Een inruilauto op een verkoopovereenkomst is een feit: die auto komt bij de aflevering binnen.
// Hij hoort dus in PVP te staan bij Komende — precies wat "komend" betekent: afgesproken, nog niet er.
//
// Wat Mobilox geeft: een kenteken zonder streepjes in kleine letters, een omschrijving als vrije
// tekst ("Toyota Aygo II 1.0 VVT-i x-clusiv"), de inruilprijs, de kilometerstand en de BPM. Geen VIN.

const plat = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Kenteken in de Nederlandse groepering zetten. PVP schrijft ze met streepjes (KJT-21-V), Mobilox
// zonder (kjt21v); zonder omzetting zou dezelfde auto er twee keer in komen te staan.
//
// De groepen volgen uit de afwisseling van letters en cijfers — dat is precies hoe de sidecodes zijn
// opgebouwd. Levert dat er geen drie op (70STXZ: cijfers, dan vier letters), dan wordt het vier-blok
// in tweeën gedeeld: 70-ST-XZ. Lukt het niet netjes, dan blijft het kenteken zoals het is: een
// verkeerd gezette streep is erger dan geen streep.
function kentekenOpmaak(ruw) {
  const k = plat(ruw);
  if (k.length !== 6) return k || null;
  const groepen = k.match(/[A-Z]+|[0-9]+/g) || [];
  if (groepen.length === 3) return groepen.join('-');
  if (groepen.length === 2) {
    const [a, b] = groepen;
    if (a.length === 2 && b.length === 4) return `${a}-${b.slice(0, 2)}-${b.slice(2)}`;
    if (a.length === 4 && b.length === 2) return `${a.slice(0, 2)}-${a.slice(2)}-${b}`;
  }
  return k;
}

// Merken vergelijken zonder accenten: Mobilox schrijft "Citroen", PVP "Citroën". Dat is hetzelfde
// merk, en twee schrijfwijzen in de catalogus is precies het probleem dat in het Autoboek 73
// varianten voor 31 merken opleverde.
const merkSleutel = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

// "Toyota Aygo II 1.0 VVT-i x-clusiv" -> merk Toyota, model de rest.
// Bewust niet verder opsplitsen in model en uitvoering: waar het model ophoudt en de uitvoering
// begint is niet af te leiden, en een verkeerde gok is lastiger te herstellen dan een lange modelnaam.
//
// `merken` is de schrijfwijze die PVP zelf al gebruikt (uit de catalogus). Staat het merk daar,
// dan wint die schrijfwijze; anders nemen we hem over zoals Mobilox hem geeft.
function naamUit(omschrijving, merken) {
  const t = String(omschrijving || '').trim().replace(/\s+/g, ' ');
  if (!t) return { merk: null, model: null };
  const eerste = t.split(' ')[0];
  const bekend = merken && merken.get(merkSleutel(eerste));
  return { merk: bekend || eerste, model: t.slice(eerste.length).trim() || null };
}

// De auto zoals hij bij Komende hoort te staan. `bron` is de regel waar hij vandaan komt, zodat in
// PVP terug te zien is bij welke verkoop deze inruil hoort.
function autoUit(inruil, bron, merken) {
  const kent = kentekenOpmaak(inruil.kenteken);
  const vin = plat(inruil.vin) || null;
  const { merk, model } = naamUit(inruil.omschrijving, merken);
  if (!vin && !kent) return null;                 // zonder sleutel is er geen auto aan te maken
  return {
    vin, kenteken: kent, merk, model,
    km: inruil.km != null ? inruil.km : null,
    inkoopprijs: inruil.prijs != null ? inruil.prijs : null,
    inkoopdatum: bron && bron.datum ? bron.datum : null,
    lev: 'Inruil',
    importAuto: false,
    note: bron ? `Inruil bij ${bron.soort} ${bron.nummer}` + (bron.omschrijving ? ` (${bron.omschrijving})` : '') : 'Inruil',
  };
}

module.exports = { kentekenOpmaak, naamUit, autoUit, plat, merkSleutel };
