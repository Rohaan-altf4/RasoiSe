// Link previews. When a RasoiSe link is shared on WhatsApp, Instagram etc., those apps read the
// page's <meta property="og:..."> tags (without running JavaScript). This adds them on the server,
// so a kitchen link shows that kitchen's photo, name and price.

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { SERVICE_AREA } = require('./models');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');

const escAttr = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inject(html, { title, description, image, url }) {
  const tags = [
    `<meta name="description" content="${escAttr(description)}">`,
    '<meta property="og:site_name" content="RasoiSe">',
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${escAttr(title)}">`,
    `<meta property="og:description" content="${escAttr(description)}">`,
    image ? `<meta property="og:image" content="${escAttr(image)}">` : '',
    `<meta property="og:url" content="${escAttr(url)}">`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`
  ].filter(Boolean).join('\n  ');
  return html
    .replace(/<meta name="description"[^>]*>\s*/i, '') // replaced by the one above
    .replace(/<title>[^<]*<\/title>/i, `<title>${escAttr(title)}</title>\n  ${tags}`);
}

// 1200px wide is what WhatsApp and others recommend for a large preview
const previewImage = url => (url && /images\.unsplash\.com/.test(url) ? url.replace(/([?&]w=)\d+/, (m, key) => `${key}1200`) : url);
const absolute = (req, url) => (!url ? '' : /^https?:\/\//.test(url) ? url : `${req.protocol}://${req.get('host')}${url}`);

function page(file, meta) {
  return (req, res, next) => {
    let html;
    try { html = fs.readFileSync(path.join(FRONTEND, file), 'utf8'); } catch (e) { return next(); }
    const m = meta(req);
    if (!m) return next(); // nothing special: serve the normal file
    res.set('Cache-Control', 'no-cache').type('html').send(inject(html, {
      ...m, image: absolute(req, previewImage(m.image)), url: `${req.protocol}://${req.get('host')}${req.originalUrl}`
    }));
  };
}

function homeMeta() {
  const d = db.load();
  const live = d.kitchens.filter(k => k.status === 'approved' && !k.paused);
  return {
    title: `RasoiSe · Home-cooked meals in ${SERVICE_AREA.name}`,
    description: `Everyday ghar ka khana from ${live.length} home cooks in ${SERVICE_AREA.name}, ${SERVICE_AREA.city}. Order one meal, try a day, or subscribe for the month.`,
    image: (live.find(k => k.coverUrl) || {}).coverUrl || '/img/placeholder-thali.svg'
  };
}

function kitchenMeta(req) {
  const d = db.load();
  const k = d.kitchens.find(x => String(x.id) === String(req.query.id) && x.status === 'approved');
  if (!k) return null;
  const where = k.location && k.location.locality ? ` in ${k.location.locality}` : '';
  return {
    title: `${k.name} · RasoiSe`,
    description: `${k.bio || 'Home-cooked meals'} By ${k.chefName}${where}. Meals from ₹${k.pricing.single}, trial ₹${k.pricing.trial}.`,
    image: k.coverUrl || (k.gallery || [])[0]
  };
}

function cookMeta() {
  return {
    title: 'Cook with RasoiSe · Register your kitchen',
    description: `Earn from your home kitchen. Cook for neighbours in ${SERVICE_AREA.name}: you set the menu, the price and how many meals you make.`,
    image: (db.load().kitchens.find(k => k.status === 'approved' && k.coverUrl) || {}).coverUrl
  };
}

function register(app) {
  app.get(['/', '/index.html', '/index'], page('index.html', homeMeta));
  app.get(['/kitchen.html', '/kitchen'], page('kitchen.html', kitchenMeta));
  app.get(['/chef-onboarding.html', '/chef-onboarding'], page('chef-onboarding.html', cookMeta));
}

module.exports = { register, inject };
