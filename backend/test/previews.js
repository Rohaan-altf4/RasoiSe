// Link previews and page assets: what WhatsApp etc. see when a RasoiSe link is shared,
// and that pages load the local Tailwind / icon files instead of CDNs.

const assert = require('assert');

const BASE = process.env.BASE || 'http://localhost:3000';
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓', msg); }
const meta = (html, prop) => {
  const m = html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`));
  return m ? m[1] : null;
};

(async () => {
  console.log('Link previews');
  let html = await (await fetch(`${BASE}/`)).text();
  ok(/Home-cooked meals in/.test(meta(html, 'og:title') || ''), `home page has a preview title ("${meta(html, 'og:title')}")`);
  ok(/^https:\/\//.test(meta(html, 'og:image') || ''), 'home page preview has an absolute image URL');
  ok((html.match(/<meta name="description"/g) || []).length === 1, 'exactly one description tag');

  const kitchens = (await (await fetch(`${BASE}/api/kitchens`)).json()).kitchens;
  const k = kitchens[0];
  html = await (await fetch(`${BASE}/kitchen.html?id=${k.id}`)).text();
  ok(meta(html, 'og:title') === `${k.name} · RasoiSe`.replace(/'/g, '\''), `kitchen link previews "${meta(html, 'og:title')}"`);
  ok(new RegExp(`₹${k.pricing.single}`).test(meta(html, 'og:description') || ''), 'kitchen preview shows the meal price');
  ok(/w=1200/.test(meta(html, 'og:image') || ''), 'kitchen preview uses its cover photo at 1200px');
  ok(new RegExp(`<title>${k.name.replace(/'/g, '&#39;|\'')}`).test(html) || html.includes(`<title>${k.name}`), 'browser tab title is the kitchen name');

  html = await (await fetch(`${BASE}/kitchen.html?id=99999`)).text();
  ok(!meta(html, 'og:title') && /<title>Kitchen · RasoiSe<\/title>/.test(html), 'unknown kitchen id: normal page, no preview');

  html = await (await fetch(`${BASE}/chef-onboarding.html`)).text();
  ok(/Register your kitchen/.test(meta(html, 'og:title') || ''), 'cook sign-up page has its own preview');

  console.log('Page assets');
  html = await (await fetch(`${BASE}/calendar.html`, { redirect: 'manual' })).text();
  const login = await (await fetch(`${BASE}/login.html`)).text();
  ok(!/cdn\.tailwindcss\.com/.test(login) && /\/css\/tailwind\.css/.test(login), 'pages load the ready-made tailwind.css, not the Tailwind CDN');
  ok(!/unpkg\.com\/lucide/.test(login) && /\/js\/icons\.js/.test(login), 'pages load the trimmed icons.js, not the full Lucide library');
  const css = await fetch(`${BASE}/css/tailwind.css`);
  ok(css.ok && (await css.text()).includes('.grid-cols-2'), 'tailwind.css is served and has the layout classes');
  const icons = await (await fetch(`${BASE}/js/icons.js`)).text();
  ok(icons.length < 60000 && /"calendar-x"/.test(icons) && /createIcons/.test(icons), `icons.js is small (${Math.round(icons.length / 1024)} KB) and has the icons the pages use`);

  console.log(`\nAll ${passed} checks passed.`);
})().catch(err => {
  console.error('\n✗ FAILED:', err.message);
  process.exitCode = 1;
});
