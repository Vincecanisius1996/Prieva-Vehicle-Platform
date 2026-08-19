// Eén schrijfwijze per merk. Het Autoboek is jarenlang met de hand gevuld en telt 73 varianten voor
// ruim dertig merken ('PEU' 48x naast 'Peugeot' 12x, 'CITR' 22x naast 'Citroen' 15x). In een
// draaitabel zijn dat evenzoveel verschillende merken.
//
// Sleutel is de variant in hoofdletters; de waarde is de volledige merknaam.
// Twee bewuste keuzes: 'Citroen' en 'Skoda' blijven zónder trema en háček. Die tekens zijn voor een
// tekstvergelijking een ander teken en zouden precies het probleem terugbrengen dat we oplossen;
// bovendien schrijft het boek ze al jaren zo. Verschil in hóófdletters doet er niet toe — dat telt
// Power BI als hetzelfde merk — maar we maken het meteen gelijk, want half opruimen leest slechter.
const VOLLEDIG = {
  PEUGEOT: ['PEU', 'PUE', 'PEUGEOT'],
  VOLKSWAGEN: ['VW', 'VOLKS', 'VOLKSWAGEN'],
  CITROEN: ['CITR', 'CITROEN', 'CITROËN'],
  BMW: ['BMW'],
  OPEL: ['OPEL'],
  AUDI: ['AUD', 'AUDI'],
  TESLA: ['TESLA'],
  RENAULT: ['REN', 'RENAULT'],
  'MERCEDES-BENZ': ['MER', 'MERC', 'MERCEDES', 'MERCEDES-BENZ'],
  KIA: ['KIA'],
  FIAT: ['FIA', 'FIAT'],
  TOYOTA: ['TOY', 'TOYOTA'],
  MG: ['MG'],
  FORD: ['FORD'],
  'ALFA ROMEO': ['ALFA', 'ALFA ROMEO'],
  SEAT: ['SEA', 'SEAT'],
  MITSUBISHI: ['MITS', 'MITSUBISHI'],
  MINI: ['MINI'],
  HYUNDAI: ['HYUN', 'HYUNDAI'],
  NISSAN: ['NIS', 'NISS', 'NISSAN'],
  'LYNK & CO': ['LYNK', 'LYNK & CO', 'LYNK&CO'],
  SKODA: ['SKO', 'SKODA', 'ŠKODA'],
  SUZUKI: ['SUZ', 'SUZUKI'],
  DODGE: ['DOD', 'DODGE'],
  MAZDA: ['MAZDA'],
  VOLVO: ['VOL', 'VOLVO'],
  DACIA: ['DACIA'],
  DAIHATSU: ['DIA', 'DAIHATSU'],
  CHEVROLET: ['CHEV', 'CHEVROLET'],
  CUPRA: ['CUPRA'],
  BYD: ['BYD'],
  DS: ['DS'],
};

// De nette schrijfwijze hoort bij de sleutel: 'MERCEDES-BENZ' -> 'Mercedes-Benz', 'BMW' -> 'BMW'.
const EIGEN_HOOFDLETTERS = ['BMW', 'MG', 'BYD', 'DS'];
function net(sleutel) {
  if (EIGEN_HOOFDLETTERS.includes(sleutel)) return sleutel;
  return sleutel.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, v, l) => v + l.toUpperCase());
}

const TABEL = {};
for (const [sleutel, varianten] of Object.entries(VOLLEDIG))
  for (const v of varianten) TABEL[v] = net(sleutel);

/** De volledige merknaam bij een schrijfwijze, of null als het merk onbekend is. */
function volledigMerk(s) {
  const t = String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  if (!t) return null;
  return TABEL[t.toUpperCase()] || null;
}

module.exports = { volledigMerk, TABEL };
