// Translation completeness: every language file has the same keys, every pattern id from
// frontend/js/i18n.js, no empty values, and no $n placeholder the pattern can't fill.
// Runs without the server.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', '..', 'frontend', 'js');
const LANGS = ['en', 'hi', 'mr', 'gu']; // en.js maps every key to itself
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓', msg); }

// Load i18n.js and the dictionaries in a tiny fake browser
const sandbox = {
  window: {}, localStorage: { getItem: () => null, setItem() {} },
  document: { documentElement: {}, write() {}, addEventListener() {} }, NodeFilter: {}, MutationObserver: class { observe() {} },
  location: {}, fetch: () => Promise.resolve()
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(DIR, 'i18n.js'), 'utf8'), sandbox);
LANGS.forEach(l => vm.runInContext(fs.readFileSync(path.join(DIR, 'i18n', `${l}.js`), 'utf8'), sandbox));
const { PATTERNS, LANGS: META } = sandbox.window.I18n;
const dicts = sandbox.window.I18N_DICTS;

console.log('Translation files');
ok(LANGS.every(l => META[l]) && META.en, 'English, Hindi, Marathi and Gujarati are in the language list');
ok(LANGS.every(l => dicts[l] && dicts[l].strings && dicts[l].patterns), 'every language file loads');

const base = Object.keys(dicts.hi.strings).sort();
ok(base.length > 300, `Hindi has ${base.length} strings`);
LANGS.forEach(l => {
  const keys = Object.keys(dicts[l].strings).sort();
  const missing = base.filter(k => !(k in dicts[l].strings));
  const extra = keys.filter(k => !(k in dicts.hi.strings));
  ok(!missing.length && !extra.length, `${l}: same ${keys.length} keys as Hindi${missing.length ? ` (missing: ${missing.slice(0, 5).join(' / ')})` : ''}${extra.length ? ` (extra: ${extra.slice(0, 5).join(' / ')})` : ''}`);
  const empty = keys.filter(k => !String(dicts[l].strings[k]).trim());
  ok(!empty.length, `${l}: no empty translations${empty.length ? ` (${empty.join(' / ')})` : ''}`);
  // Mixed scripts are a typo (e.g. a Gujarati letter in a Marathi line)
  const wrong = l === 'en' ? /[ऀ-૿]/ : l === 'gu' ? /[ऀ-ॿ]/ : /[઀-૿]/;
  const mixed = keys.filter(k => wrong.test(dicts[l].strings[k]));
  ok(!mixed.length, `${l}: no letters from the wrong script${mixed.length ? ` (${mixed.slice(0, 3).join(' / ')})` : ''}`);
});

// Text for the notice / make-up / cancellation features must never fall back to English
const MUST = ['Show password', 'Hide password', 'Skip this meal', 'Make-up day', 'Freeze plan', "I won't be home", 'Keep for pickup',
  'Not available', 'Cancel meal', 'Emergency cancellation', 'Notice for changes', 'Make-up days per plan', 'How changes work',
  'If the kitchen cancels a plan meal', 'Language'];
const gaps = MUST.filter(k => LANGS.some(l => !dicts[l].strings[k]));
ok(!gaps.length, `new feature text is translated in all languages${gaps.length ? ` (missing: ${gaps.join(' / ')})` : ''}`);

// A lost backslash turns d into a plain d, so the pattern silently never matches
const broken = PATTERNS.filter(([, re]) => /\(d\+\)|\[d[.,]|\(RSd/.test(re.source)).map(p => p[0]);
ok(!broken.length, `no pattern lost its \\d escapes${broken.length ? ` (${broken.join(', ')})` : ''}`);

PATTERNS.forEach(([id, re]) => {
  const groups = new RegExp(re.source + '|').exec('').length - 1;
  LANGS.forEach(l => {
    const t = dicts[l].patterns[id];
    assert.ok(t && t.trim(), `${l}: pattern "${id}" is missing`);
    const used = [...t.matchAll(/\$(\d)/g)].map(m => Number(m[1]));
    assert.ok(used.every(n => (n >= 1 || l === 'en') && n <= groups), `${l}: pattern "${id}" uses $${Math.max(...used)} but the pattern has ${groups} parts`);
  });
});
ok(true, `all ${PATTERNS.length} patterns are translated in every language, with valid placeholders`);
LANGS.forEach(l => {
  const extra = Object.keys(dicts[l].patterns).filter(id => !PATTERNS.some(p => p[0] === id));
  ok(!extra.length, `${l}: no unknown pattern ids${extra.length ? ` (${extra.join(', ')})` : ''}`);
});

// Real sentences the app shows, run through the Hindi translator
const hiBox = { ...sandbox, window: {}, localStorage: { getItem: () => 'hi', setItem() {} }, document: { documentElement: {}, write() {}, addEventListener() {} } };
vm.createContext(hiBox);
vm.runInContext(fs.readFileSync(path.join(DIR, 'i18n.js'), 'utf8'), hiBox);
vm.runInContext(fs.readFileSync(path.join(DIR, 'i18n', 'hi.js'), 'utf8'), hiBox);
const t = s => hiBox.window.I18n.t(s);
const samples = [
  'Change by 20 Oct, 12:30 PM', 'Skipped Wed, 21 Oct lunch', 'Added as a make-up day on Mon, 9 Nov.',
  'Skips left: 3 of 4', 'Late cancellations this month: 2 of 3', 'Delivered 96% of booked meals in the last 30 days',
  'Plan frozen Mon, 2 Nov – Thu, 12 Nov', 'Rated 4.5 out of 5', 'RS1023 delivered (₹100 - ₹10 platform fee)',
  'Asha won\'t be home for Tue, 20 Oct lunch', 'Moved to a make-up day on Mon, 9 Nov.', 'Skip this meal'
];
const untranslated = samples.filter(s => t(s) === s || /[A-Za-z]{4,} [a-z]{3,}/.test(t(s).replace(/Mon|Tue|Wed|Thu|Fri|Sat|Sun|Oct|Nov|Asha|RS\d+/g, '')));
ok(!untranslated.length, `sample sentences come out in Hindi${untranslated.length ? ` (still English: ${untranslated.map(s => `${s} → ${t(s)}`).join(' / ')})` : ''}`);

console.log(`\nAll ${passed} checks passed.`);
