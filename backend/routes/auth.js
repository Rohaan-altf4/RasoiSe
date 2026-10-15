// Sign up, sign in, sign out and "who am I".

const express = require('express');
const db = require('../db');
const time = require('../lib/time');
const auth = require('../lib/auth');
const wallet = require('../lib/wallet');
const { defaultPreferences } = require('../lib/models');
const { audit } = require('../lib/notify');

const router = express.Router();

// Basic validation shared by customer sign-up and chef registration
function validateAccount({ name, email, phone, password }) {
  const errors = {};
  if (!name || String(name).trim().length < 2) errors.name = 'Please enter your name.';
  if (!email && !phone) errors.email = 'Enter an email or a mobile number.';
  if (email && !auth.EMAIL_RE.test(String(email).trim())) errors.email = 'That email doesn\'t look right.';
  if (phone && !auth.PHONE_RE.test(auth.normalisePhone(phone))) errors.phone = 'Enter a 10-digit mobile number starting with 6–9.';
  if (!password || String(password).length < 8) errors.password = 'Password must be at least 8 characters.';
  const data = db.load();
  const e = String(email || '').trim().toLowerCase();
  const p = auth.normalisePhone(phone);
  if (e && data.users.some(u => u.email === e)) errors.email = 'An account with this email already exists. Try signing in.';
  if (p && data.users.some(u => u.phone === p)) errors.phone = 'An account with this number already exists. Try signing in.';
  return errors;
}

function buildUser({ name, email, phone, password, role }) {
  return {
    id: db.nextId('users'),
    role,
    name: String(name).trim(),
    email: String(email || '').trim().toLowerCase(),
    phone: auth.normalisePhone(phone),
    passwordHash: auth.hashPassword(String(password)),
    status: 'active',
    createdAt: time.nowISO(),
    preferences: role === 'customer' ? defaultPreferences() : null,
    addresses: [],
    defaultAddressId: null,
    favourites: [],
    kitchenId: null
  };
}

function mePayload(user) {
  const data = db.load();
  const out = { user: auth.publicUser(user), today: time.today() };
  out.unread = data.notifications.filter(n => n.userId === user.id && !n.read).length;
  if (user.role === 'customer' || user.role === 'chef') out.wallet = wallet.balances(user.id);
  if (user.role === 'chef' && user.kitchenId) {
    const k = data.kitchens.find(x => x.id === user.kitchenId);
    if (k) out.kitchen = { id: k.id, name: k.name, status: k.status, paused: k.paused, statusNote: k.statusNote };
  }
  return out;
}

router.post('/signup', (req, res) => {
  const body = req.body || {};
  const errors = validateAccount(body);
  if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], fields: errors });

  const user = db.transaction(d => {
    const u = buildUser({ ...body, role: 'customer' });
    d.users.push(u);
    audit(d, u, 'USER_SIGNUP', u.name, `New customer account: ${u.email || u.phone}`);
    return u;
  });
  auth.createSession(res, user.id);
  res.status(201).json(mePayload(user));
});

router.post('/login', (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) return res.status(400).json({ error: 'Enter your email or mobile number and password.' });
  const user = auth.findByIdentifier(identifier);
  if (!user || !auth.checkPassword(String(password), user.passwordHash)) {
    return res.status(401).json({ error: 'Wrong email/number or password.' });
  }
  if (user.status === 'suspended') return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
  auth.createSession(res, user.id);
  res.json(mePayload(user));
});

router.post('/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null, today: time.today() });
  res.json(mePayload(req.user));
});

router.post('/password', auth.requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!auth.checkPassword(String(current || ''), req.user.passwordHash)) return res.status(400).json({ error: 'Current password is wrong.' });
  if (!next || String(next).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  db.transaction(() => { req.user.passwordHash = auth.hashPassword(String(next)); });
  res.json({ ok: true });
});

module.exports = { router, validateAccount, buildUser, mePayload };
