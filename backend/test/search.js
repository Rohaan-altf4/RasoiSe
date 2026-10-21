// Search matching: Indian scripts and common spelling differences. Runs without the server.

const assert = require('assert');
const path = require('path');
const S = require(path.join(__dirname, '..', '..', 'frontend', 'js', 'search.js'));

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓', msg); }

const hay = 'Nanak\'s Rasoi Harpreet Kaur Punjabi Shahi Paneer Dal Makhani Tawa Roti Versova Chicken Biryani Masala Dosa Gujarati Kadhi Chole Bhature';
console.log('Search');
ok(S.matches(hay, 'paneer'), 'exact English word');
ok(S.matches(hay, 'panir'), 'misspelling: panir finds Paneer');
ok(S.matches(hay, 'पनीर'), 'Hindi: पनीर finds Paneer');
ok(S.matches(hay, 'પનીર'), 'Gujarati: પનીર finds Paneer');
ok(S.matches(hay, 'बिरयानी'), 'Hindi: बिरयानी finds Biryani');
ok(S.matches(hay, 'biriyani'), 'misspelling: biriyani finds Biryani');
ok(S.matches(hay, 'मसाला डोसा'), 'two Hindi words: मसाला डोसा finds Masala Dosa');
ok(S.matches(hay, 'गुजराती'), 'Marathi/Hindi cuisine name: गुजराती finds Gujarati');
ok(S.matches(hay, 'छोले'), 'Hindi: छोले finds Chole');
ok(S.matches(hay, 'daal makhni'), 'daal makhni finds Dal Makhani');
ok(S.matches(hay, 'nanaks'), 'apostrophes ignored');
ok(S.matches(hay, ''), 'empty search matches everything');
ok(!S.matches(hay, 'sushi'), 'unrelated word does not match');
ok(!S.matches(hay, 'पिज़्ज़ा'), 'unrelated Hindi word (pizza) does not match');
ok(!S.matches('Annapurna Kitchen Gujarati Thali', 'biryani'), 'biryani does not match a kitchen without it');

console.log(`\nAll ${passed} checks passed.`);
