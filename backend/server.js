// RasoiSe server: serves the frontend and the JSON API.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const db = require('./db');
const auth = require('./lib/auth');
const time = require('./lib/time');
const { defaultPreferences } = require('./lib/models');
const { securityHeaders, rateLimit } = require('./lib/security');
const { UPLOADS_DIR } = require('./lib/upload');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND = path.join(__dirname, '..', 'frontend');

app.disable('x-powered-by');
// Hosts like Render/Railway sit behind an HTTPS proxy; trust it so req.ip and secure cookies work
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(auth.loadUser);

// ---------- Protected pages ----------
// Pages that need a signed-in user of a certain role. Logged-out users go to the login page.
const PAGE_ROLES = {
  '/calendar.html': ['customer'],
  '/orders.html': ['customer'],
  '/profile.html': ['customer'],
  '/chef-dashboard.html': ['chef'],
  '/chef-settings.html': ['chef'],
  '/admin-console.html': ['admin']
};
const HOME_FOR = { customer: '/index.html', chef: '/chef-dashboard.html', admin: '/admin-console.html' };

app.use((req, res, next) => {
  const roles = PAGE_ROLES[req.path];
  if (!roles || req.method !== 'GET') return next();
  if (!req.user) return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
  if (!roles.includes(req.user.role)) return res.redirect(HOME_FOR[req.user.role] || '/');
  next();
});

// Old misspelled links keep working
app.get(['/calender.html', '/shef-dashboard.html'], (req, res) => {
  res.redirect(req.path === '/calender.html' ? '/calendar.html' : '/chef-dashboard.html');
});

// Chef photos live in UPLOADS_DIR (frontend/uploads by default, or DATA_DIR/uploads on a host disk)
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

// The service area for every page, from the one value in lib/models.js
app.get('/js/area.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache')
    .send(`window.RASOI_AREA = ${JSON.stringify(require('./lib/models').SERVICE_AREA)};`);
});

// Link previews (WhatsApp etc.) for the home, kitchen and cook-signup pages
require('./lib/previews').register(app);

// Code files are revalidated on every load so updates show up immediately; photos can be cached.
app.use(express.static(FRONTEND, {
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// ---------- API ----------
// Hosts ping this to check the app is up
app.get('/health', (req, res) => res.json({ ok: true }));

// Limit sign-in / sign-up / chef-registration attempts per IP (default 10 every 15 minutes)
const authLimit = rateLimit({ max: Number(process.env.AUTH_RATE_LIMIT) || 10, windowMs: 15 * 60 * 1000 });
app.use(['/api/auth/login', '/api/auth/signup', '/api/chef/register'], (req, res, next) => (req.method === 'POST' ? authLimit(req, res, next) : next()));

app.get('/api/config', (req, res) => {
  res.json({
    mapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
    mapsProvider: process.env.GOOGLE_MAPS_API_KEY ? 'google' : 'leaflet',
    serviceArea: require('./lib/models').SERVICE_AREA,
    localities: Object.entries(require('./lib/models').LOCALITIES).map(([name, c]) => ({ name, ...c })),
    today: time.today()
  });
});

app.use('/api/auth', require('./routes/auth').router);
app.use('/api/kitchens', require('./routes/kitchens'));
app.use('/api', require('./routes/customer').router);
app.use('/api', require('./routes/chef').router);
app.use('/api', require('./routes/reviews'));
app.use('/api', require('./routes/admin').router);
app.use('/api', require('./routes/tickets').router);
app.use('/api', require('./routes/notifications'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Pages that don't exist
app.use((req, res) => {
  res.status(404).sendFile(path.join(FRONTEND, '404.html'));
});

// Errors thrown by routes (httpError sets .status). Anything else is a bug: log it.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  if (status >= 500) console.error(err);
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'Photos must be under 5 MB.' : (status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message);
  if (req.path.startsWith('/api')) return res.status(status).json({ error: message, code: err.code });
  res.status(status).send(message);
});

// ---------- Admin account from .env ----------
function ensureAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || password.length < 8) {
    console.warn('[setup] ADMIN_EMAIL / ADMIN_PASSWORD (8+ chars) not set in backend/.env, so no admin account was created.');
    return;
  }
  db.transaction(d => {
    const existing = d.users.find(u => u.email === email);
    if (existing) {
      if (existing.role !== 'admin') console.warn(`[setup] ${email} exists but is not an admin. Use a different ADMIN_EMAIL.`);
      // .env is the source of truth: a deployed copy of the data must not keep the old admin password
      else if (!auth.checkPassword(password, existing.passwordHash)) {
        existing.passwordHash = auth.hashPassword(password);
        console.log(`[setup] Admin password updated from ADMIN_PASSWORD: ${email}`);
      }
      return;
    }
    d.users.push({
      id: db.nextId('users'), role: 'admin', name: process.env.ADMIN_NAME || 'RasoiSe Admin', email, phone: '',
      passwordHash: auth.hashPassword(password), status: 'active', createdAt: time.nowISO(),
      preferences: null, addresses: [], defaultAddressId: null, favourites: [], kitchenId: null
    });
    console.log(`[setup] Admin account created: ${email}`);
  });
}

async function start() {
  await db.init(); // connects to MongoDB when MONGODB_URI is set, else reads data.json
  ensureAdmin();
  require('./lib/jobs').start();
  const server = app.listen(PORT, () => {
    console.log(`RasoiSe running at http://localhost:${PORT}`);
  });
  // On Ctrl+C / host shutdown, finish any database writes still in flight before exiting
  const stop = async () => {
    server.close();
    await db.close().catch(() => {});
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return server;
}

if (require.main === module) {
  start().catch(err => {
    console.error(`[startup] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { app, start, defaultPreferences };
