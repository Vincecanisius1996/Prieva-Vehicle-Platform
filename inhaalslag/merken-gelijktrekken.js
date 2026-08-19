// Eenmalig: kolom G (Merk) in het Autoboek gelijktrekken naar de volledige merknaam.
// Zonder --echt wordt er niets geüpload. Raakt uitsluitend cellen in kolom G; alle andere kolommen,
// tabbladen, formules en opmaak blijven ongemoeid, en dat wordt vóór het uploaden nagerekend.
const B = require('/opt/pvp-api/autoboek/xlsx-append.js');
const { lees } = require('/opt/pvp-api/autoboek/xlsx-lees.js');
const { volledigMerk } = require('/opt/pvp-api/autoboek/merken.js');
const drive = require('/opt/pvp-api/autoboek/drive.js');
const fs = require('fs'), os = require('os'), path = require('path');

const ECHT = process.argv.includes('--echt');
const SCOPE = 'https://www.googleapis.com/auth/drive';
const ID = process.env.AUTOBOEK_FILE_ID;
// Blad5 heeft dezelfde kolomindeling als de autotabbladen en bevat 47 regels met merken; die horen
// er dus bij. 'BTW reserves' heeft geen merkkolom. 'Bandenlijst' blijft er BEWUST buiten: daar is
// kolom G de profieldiepte en staat het bandenmerk in kolom A.
const BLADEN = ['Komende Autos', 'Lopende Autos', 'Verkochte Autos', 'Blad5'];
const KOL = 6, LETTER = 'G';                 // G = Merk
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

(async () => {
  const tok = await drive.token(SCOPE);
  const voor = await drive.meta(tok, ID);
  const buf = await drive.download(tok, ID);
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'pvp-merken-'));
  const inPad = path.join(map, 'in.xlsx');
  fs.writeFileSync(inPad, buf);
  fs.writeFileSync('/var/backups/pvp/autoboek/voor-merken-' + new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + '.xlsx', buf);

  const entries = B.leesZip(buf);
  const uitpak = naam => { const e = entries.find(x => x.naam === naam); return e ? B.uitpakken(e).toString('utf8') : null; };

  const onbekend = {}, wijzigingen = [];
  const nieuweXml = {};

  for (const blad of BLADEN) {
    const bp = B.bladPad(entries, blad);
    let xml = uitpak(bp);
    const rijen = B.rijenUit(xml);
    const boekBlad = lees(buf, blad);
    let raak = 0;

    for (const r of rijen) {
      if (r.nr < 2) continue;
      const ruw = String((boekBlad[r.nr] || {})[KOL] || '');
      const huidig = ruw.trim();
      if (!huidig) continue;
      const nieuw = volledigMerk(huidig);
      if (!nieuw) { (onbekend[huidig] ||= 0); onbekend[huidig]++; continue; }
      // Vergelijken met de RUWE celwaarde, niet de getrimde: 'Peugeot ' met een spatie erachter is
      // voor een draaitabel een ander merk dan 'Peugeot', en dat moet dus ook rechtgezet worden.
      if (nieuw === ruw) continue;

      const m = new RegExp(`<c r="${LETTER}${r.nr}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`).exec(r.binnen);
      if (!m) continue;
      if (/<f[ >]/.test(m[2] || '')) { console.log(`  overgeslagen: ${blad}!${LETTER}${r.nr} bevat een formule`); continue; }
      const s = (/s="(\d+)"/.exec(m[1] || '') || [])[1];
      const cel = `<c r="${LETTER}${r.nr}"${s !== undefined ? ` s="${s}"` : ''} t="inlineStr"><is><t>${esc(nieuw)}</t></is></c>`;
      const nieuweRij = r.heel.replace(m[0], () => cel);
      xml = xml.replace(r.heel, () => nieuweRij);
      wijzigingen.push({ blad, rij: r.nr, van: ruw === huidig ? huidig : JSON.stringify(ruw), naar: nieuw });
      raak++;
    }
    nieuweXml[bp] = xml;
    console.log(`${blad}: ${raak} cellen aangepast`);
  }

  if (Object.keys(onbekend).length) {
    console.log('\nONBEKENDE MERKEN — met rust gelaten:');
    for (const [k, n] of Object.entries(onbekend)) console.log(`   ${k} (${n}x)`);
  }

  const perOmzetting = {};
  for (const w of wijzigingen) (perOmzetting[w.van + ' → ' + w.naar] ||= 0), perOmzetting[w.van + ' → ' + w.naar]++;
  console.log('\nomzettingen (' + wijzigingen.length + ' cellen):');
  for (const [k, n] of Object.entries(perOmzetting).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(3)}x  ${k}`);

  if (!wijzigingen.length) { console.log('\nniets te doen.'); return; }

  // Nieuw werkboek bouwen. vervang() muteert de zip-ingang; schrijfZip() maakt er weer één bestand van.
  for (const [bp, xml] of Object.entries(nieuweXml)) {
    const e = entries.find(x => x.naam === bp);
    if (!e) throw new Error('tabblad niet terug te vinden in de zip: ' + bp);
    B.vervang(e, Buffer.from(xml, 'utf8'));
  }
  const nieuw = B.schrijfZip(entries);
  fs.writeFileSync(path.join(map, 'uit.xlsx'), nieuw);

  // ===== controle vóór het uploaden =====
  const oudE = B.leesZip(buf), nieuwE = B.leesZip(nieuw);   // buf is onaangeroerd, entries wel gemuteerd
  const paden = new Set([...oudE.map(e => e.naam), ...nieuwE.map(e => e.naam)]);
  let fout = 0;
  const gewijzigdePaden = new Set(Object.keys(nieuweXml));
  for (const p of paden) {
    const a = oudE.find(e => e.naam === p), b = nieuwE.find(e => e.naam === p);
    if (!a || !b) { console.log('CONTROLE FOUT: bestand erbij/eraf:', p); fout++; continue; }
    const gelijk = B.uitpakken(a).equals(B.uitpakken(b));
    if (!gelijk && !gewijzigdePaden.has(p)) { console.log('CONTROLE FOUT: onverwacht gewijzigd:', p); fout++; }
  }
  const na = lees(nieuw);
  for (const blad of Object.keys(lees(buf))) {
    const v = lees(buf, blad), n = na[blad];
    if (Object.keys(v).length !== Object.keys(n).length) { console.log('CONTROLE FOUT: ander aantal rijen op', blad); fout++; }
    const bewerkt = BLADEN.includes(blad);
    for (const nr of Object.keys(v)) {
      const rv = v[nr], rn = n[nr] || {};
      for (const k of new Set([...Object.keys(rv), ...Object.keys(rn)])) {
        if (bewerkt && Number(k) === KOL && Number(nr) >= 2) {
          const verwacht = volledigMerk(String(rv[k] || '').trim()) || String(rv[k] || '').trim() || undefined;
          const gekregen = rn[k];
          if (String(gekregen || '') !== String(verwacht || '')) {
            console.log(`CONTROLE FOUT: ${blad} rij ${nr} merk "${rv[k]}" -> "${gekregen}", verwacht "${verwacht}"`); fout++;
          }
        } else if (String(rv[k] || '') !== String(rn[k] || '')) {
          console.log(`CONTROLE FOUT: ${blad} rij ${nr} kolom ${k} veranderde: "${rv[k]}" -> "${rn[k]}"`); fout++;
        }
      }
    }
  }
  console.log(fout ? `\n${fout} CONTROLEFOUTEN — er wordt niets geüpload.` : '\ncontrole: alleen kolom G gewijzigd, elke andere cel op elk tabblad identiek.');
  if (fout) process.exit(1);

  if (!ECHT) { console.log('\n>>> PROEFDRAAI — er is niets geüpload. Draai met --echt.'); return; }

  const nu = await drive.meta(tok, ID);
  if (nu.headRevisionId !== voor.headRevisionId) throw new Error('iemand heeft het Autoboek intussen opgeslagen — niets geschreven');
  await drive.upload(tok, ID, nieuw);
  const terug = lees(await drive.download(tok, ID));
  let rest = 0;
  for (const blad of BLADEN) for (const nr of Object.keys(terug[blad] || {})) {
    if (Number(nr) < 2) continue;
    const m = String(terug[blad][nr][KOL] || '').trim();
    if (m && volledigMerk(m) && volledigMerk(m) !== m) rest++;
  }
  console.log(`\ngeüpload en nagelezen. Nog niet-gelijkgetrokken merken: ${rest}`);
})().catch(e => { console.error('MISLUKT:', e.message); process.exit(1); });
