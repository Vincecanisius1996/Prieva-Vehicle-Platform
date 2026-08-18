// Minimale xlsx-lezer in puur Node: genoeg om een tabblad terug te lezen en te controleren wat we
// erin geschreven hebben. Bewust geen algemene bibliotheek — we hoeven maar één ding te kunnen.
const { leesZip, uitpakken } = require('./xlsx-append.js');

const tekstUit = xml => {
  // <si> kan uit meerdere <t> bestaan (opgemaakte stukken tekst); die horen aan elkaar geplakt.
  const uit = [];
  for (const si of xml.split('<si>').slice(1)) {
    const stuk = si.split('</si>')[0];
    uit.push([...stuk.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => ontsnap(m[1])).join(''));
  }
  return uit;
};
const ontsnap = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const kolIndex = ref => { const l = /^([A-Z]+)/.exec(ref)[1]; let n = 0; for (const c of l) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };

function lees(buf, bladNaam) {
  const entries = leesZip(buf);
  const pak = naam => { const e = entries.find(x => x.naam === naam); return e ? uitpakken(e).toString('utf8') : null; };
  const gedeeld = pak('xl/sharedStrings.xml') ? tekstUit(pak('xl/sharedStrings.xml')) : [];

  const wb = pak('xl/workbook.xml');
  const rels = pak('xl/_rels/workbook.xml.rels');
  const bladen = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g)].map(m => ({ naam: ontsnap(m[1]), rid: m[2] }));
  const doelen = Object.fromEntries([...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]));

  const uit = {};
  for (const b of bladen) {
    let doel = (doelen[b.rid] || '').replace(/^\//, '');
    if (!doel.startsWith('xl/')) doel = 'xl/' + doel;
    const xml = pak(doel); if (xml === null) continue;
    const rijen = {};
    for (const m of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cellen = {};
      // Let op de niet-gulzige [^>]*? : met een gulzige variant slikt een zelfsluitende cel
      // (<c r="A2" s="43"/>) de inhoud van de volgende cellen op en schuiven alle waarden op.
      for (const c of m[2].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attr = c[2] || '', inhoud = c[3] || '';
        const t = (/t="([^"]+)"/.exec(attr) || [])[1];
        let w = null;
        if (t === 's') { const v = /<v>([\s\S]*?)<\/v>/.exec(inhoud); if (v) w = gedeeld[Number(v[1])]; }
        else if (t === 'inlineStr') { w = [...inhoud.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => ontsnap(x[1])).join(''); }
        else { const v = /<v>([\s\S]*?)<\/v>/.exec(inhoud); if (v) w = ontsnap(v[1]); }
        if (w !== null && w !== '') cellen[kolIndex(c[1])] = w;
      }
      rijen[Number(m[1])] = cellen;
    }
    uit[b.naam] = rijen;
  }
  return bladNaam ? uit[bladNaam] : uit;
}

// Excel-serienummer terug naar dd-mm-jjjj (epoch 1899-12-30 vanwege de schrikkeljaarfout van 1900).
const datum = n => { const d = new Date(Date.UTC(1899, 11, 30) + Number(n) * 86400000); return isNaN(d) ? n : `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`; };

module.exports = { lees, datum, tekstUit, ontsnap, kolIndex };
