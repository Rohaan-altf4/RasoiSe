// Sign-in sessions using a random token in an httpOnly cookie.
// Only a SHA-256 hash of the token is stored, so a leaked data.json can't be used to log in.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const time = require('./time');

const COOKIE_NAME = 'rasoi_session';
const SESSION_DAYS = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[6-9]\d{9}$/;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function checkPassword(password, hash) {
  return !!hash && bcrypt.compareSync(password, hash);
}

function normalisePhone(p) {
  return String(p || '').replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, '');
}

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(time.now().getTime() + SESSION_DAYS * 86400000);
  db.transaction(d => {
    d.sessions.push({ id: hashToken(token), userId, createdAt: time.nowISO(), expiresAt: expires.toISOString() });
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    expires,
    path: '/'
  });
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) {
    const id = hashToken(token);
    db.transaction(d => { d.sessions = d.sessions.filter(s => s.id !== id); });
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Middleware: attaches req.user when a valid session cookie is present.
function loadUser(req, res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) {
    const data = db.load();
    const session = data.sessions.find(s => s.id === hashToken(token));
    if (session && session.expiresAt > time.nowISO()) {
      const user = data.users.find(u => u.id === session.userId);
      if (user && user.status !== 'suspended') req.user = user;
    }
  }
  next();
}

// Middleware factory: requireRole('admin') or requireRole('customer', 'admin') etc.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this.' });
    }
    next();
  };
}

const requireAuth = requireRole();

function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

function findByIdentifier(identifier) {
  const id = String(identifier || '').trim().toLowerCase();
  const phone = normalisePhone(id);
  return db.load().users.find(u =>
    (u.email && u.email.toLowerCase() === id) || (u.phone && PHONE_RE.test(phone) && u.phone === phone)
  ) || null;
}

module.exports = {
  COOKIE_NAME, EMAIL_RE, PHONE_RE, hashPassword, checkPassword, normalisePhone,
  createSession, destroySession, loadUser, requireRole, requireAuth, publicUser, findByIdentifier
};
