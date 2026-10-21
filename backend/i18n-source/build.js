// Builds frontend/js/i18n/{en,hi,mr,gu}.js from the tables in this folder.
// Each table line is: English text | Hindi | Marathi | Gujarati   (lines starting with # are comments)
// Run: npm run i18n   then: npm test (test/i18n.js checks the result)
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', '..', 'frontend', 'js', 'i18n') + path.sep;
const rows = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#')).map(l => l.split('|'));
const strings = {}; const bad = []; const dup = [];
for (const f of ['strings-common.txt', 'strings-cook-and-plans.txt', 'strings-popups.txt']) for (const r of rows(f)) {
  if (r.length !== 4 || r.some(x => !x.trim())) { bad.push(r.join('|')); continue; }
  if (strings[r[0]]) { dup.push(r[0]); continue; }
  strings[r[0]] = { hi: r[1].trim(), mr: r[2].trim(), gu: r[3].trim() };
}
const patterns = {};
for (const r of rows('patterns.txt')) { if (r.length !== 4) { bad.push(r.join('|')); continue; } patterns[r[0]] = { hi: r[1], mr: r[2], gu: r[3] }; }
// English is the source text, so its file maps every key to itself ($0 = the whole matched text).
// It is not loaded by the pages; it exists so all four languages have the same keys.
Object.values(strings).forEach(v => { v.en = null; });
Object.values(patterns).forEach(v => { v.en = '$0'; });
const NAMES = { en: 'English', hi: 'Hindi', mr: 'Marathi', gu: 'Gujarati' };
for (const l of ['en', 'hi', 'mr', 'gu']) {
  const s = Object.fromEntries(Object.entries(strings).map(([k, v]) => [k, l === 'en' ? k : v[l]]));
  const p = Object.fromEntries(Object.entries(patterns).map(([k, v]) => [k, v[l]]));
  const body = `// ${NAMES[l]}. Keys are the English text shown on screen; patterns fill in numbers and names
// ($1, $2... are the parts captured by the PATTERNS list in ../i18n.js). Every language file has
// the same keys: test/i18n.js checks this. User content (dish and kitchen names) is not translated.
(window.I18N_DICTS = window.I18N_DICTS || {}).${l} = {
  strings: ${JSON.stringify(s, null, 4).replace(/\n}$/, '\n  }')},
  patterns: ${JSON.stringify(p, null, 4).replace(/\n}$/, '\n  }')}
};
`;
  fs.writeFileSync(OUT + l + '.js', body);
}
console.log('strings', Object.keys(strings).length, 'patterns', Object.keys(patterns).length, 'bad', bad, 'dup', dup);
