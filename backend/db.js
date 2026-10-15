// JSON-file database.
// The whole dataset lives in memory and is written back to data.json after every change.
// Writes are atomic: we write a temp file first and then rename it over data.json,
// so a crash mid-write can never leave a half-written (corrupt) file behind.

const fs = require('fs');
const path = require('path');

// Where data.json lives. On a host, set DATA_DIR to a persistent disk (e.g. /var/data)
// so data survives redeploys. DB_FILE overrides it (used by the tests).
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.env.DB_FILE)
  : path.join(DATA_DIR, 'data.json');

const COLLECTIONS = [
  'users', 'sessions', 'kitchens', 'menus', 'orders', 'subscriptions',
  'walletTransactions', 'reviews', 'tickets', 'notifications', 'auditLog'
];

let data = null;

function emptyData() {
  const d = { version: 2, counters: {} };
  COLLECTIONS.forEach(c => { d[c] = []; });
  return d;
}

function load() {
  if (data) return data;

  if (!fs.existsSync(DB_FILE)) {
    data = emptyData();
    save();
    return data;
  }

  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  let parsed = raw.trim() ? JSON.parse(raw) : emptyData();

  // Old (v1) files have no version field. Convert them once and keep a backup.
  if (!parsed.version) {
    const { migrateLegacy } = require('./migrate');
    const backup = DB_FILE.replace(/\.json$/, '.legacy.json');
    fs.copyFileSync(DB_FILE, backup);
    parsed = migrateLegacy(parsed, emptyData());
    console.log(`[db] Migrated legacy data.json (backup saved to ${path.basename(backup)})`);
  }

  COLLECTIONS.forEach(c => { if (!Array.isArray(parsed[c])) parsed[c] = []; });
  if (!parsed.counters) parsed.counters = {};
  data = parsed;
  save();
  return data;
}

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  try {
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    // Windows can briefly lock the target (antivirus, editors). Fall back to copy + delete.
    fs.copyFileSync(tmp, DB_FILE);
    fs.unlinkSync(tmp);
  }
}

// Replace the whole dataset (used by the seed script).
function replace(newData) {
  data = newData;
  COLLECTIONS.forEach(c => { if (!Array.isArray(data[c])) data[c] = []; });
  if (!data.counters) data.counters = {};
  save();
}

// Simple incrementing ids per collection: 1, 2, 3...
function nextId(collection) {
  const db = load();
  const current = db.counters[collection] ||
    db[collection].reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  db.counters[collection] = current + 1;
  return current + 1;
}

// Work to run only after a transaction is saved (e.g. pushing live notifications).
let pendingAfterCommit = [];
function afterCommit(fn) {
  pendingAfterCommit.push(fn);
}

// Run a change and persist it. Handlers are synchronous, so changes never interleave.
// If fn throws, every change it made is rolled back, so a failed request never leaves
// half-applied data in memory.
function transaction(fn) {
  const current = load();
  const snapshot = JSON.stringify(current);
  pendingAfterCommit = [];
  let result;
  try {
    result = fn(current);
  } catch (err) {
    data = JSON.parse(snapshot);
    pendingAfterCommit = [];
    throw err;
  }
  save();
  const jobs = pendingAfterCommit;
  pendingAfterCommit = [];
  jobs.forEach(job => { try { job(); } catch (e) { console.error('[db] afterCommit failed', e); } });
  return result;
}

function findById(collection, id) {
  return load()[collection].find(item => String(item.id) === String(id)) || null;
}

module.exports = { load, save, replace, nextId, transaction, afterCommit, findById, emptyData, COLLECTIONS, DB_FILE };
