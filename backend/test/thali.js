// One veg / non-veg tag per thali: the rules used for orders and day menus. Runs without the server.

const assert = require('assert');
const meals = require('../lib/meals');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓', msg); }

const kitchen = { id: 1, dietType: 'nonveg' };
const d = { menus: [{ kitchenId: 1, dishes: [{ name: 'Prawns Masala', type: 'nonveg' }, { name: 'Egg Curry', type: 'egg' }, { name: 'Kala Vatana Usal', type: 'veg' }] }] };
const veg = { id: 2, dietType: 'veg' };
const course = (...options) => ({ options });

console.log('Thali type');
ok(meals.mealType(d, kitchen, { a: 'Prawns Masala', b: 'Tondli Fry', c: 'Rice + Chapati', d: 'Sol Kadhi' }) === 'nonveg',
  'prawns + veg sides = non-veg thali (sides are not marked non-veg on their own)');
ok(meals.mealType(d, kitchen, { a: 'Egg Curry', b: 'Rice' }) === 'egg', 'egg curry + rice = eggetarian thali');
ok(meals.mealType(d, kitchen, { a: 'Kala Vatana Usal', b: 'Rice' }) === 'veg', 'all veg dishes = veg thali');
ok(meals.mealType(d, kitchen, { a: 'Chicken Sukka', b: 'Rice' }) === 'nonveg', 'untagged "Chicken Sukka" is judged non-veg by its name');
ok(meals.mealType(d, kitchen, { a: 'Anda Bhurji', b: 'Pav' }) === 'egg', 'untagged "Anda Bhurji" is judged egg by its name');
ok(meals.mealType(d, veg, { a: 'Chicken-style Soya' }) === 'veg', 'a pure-veg kitchen is always veg');

console.log('Day menu with options');
ok(meals.menuType(d, kitchen, [course('Prawns Masala', 'Kala Vatana Usal'), course('Rice')]) === 'mixed-nonveg', 'non-veg or veg main = "Veg & non-veg options"');
ok(meals.menuType(d, kitchen, [course('Prawns Masala'), course('Rice')]) === 'nonveg', 'only a non-veg main = non-veg thali');
ok(meals.menuType(d, kitchen, [course('Egg Curry', 'Kala Vatana Usal')]) === 'mixed-egg', 'egg or veg main = "Veg & egg options"');
ok(meals.menuType(d, kitchen, [course('Kala Vatana Usal'), course('Rice')]) === 'veg', 'all veg = veg thali');

console.log(`\nAll ${passed} checks passed.`);
