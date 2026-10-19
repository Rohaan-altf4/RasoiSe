// Database layer.
//
// The app works on one in-memory dataset (users, kitchens, orders...). Every change runs inside
// transaction(), which rolls back on error, and is then persisted to one of two stores:
//
//   - MongoDB (when MONGODB_URI is set in .env): one collection per dataset (users, orders...).
//     After each transaction only the records that changed are written, in order, with
//     bulkWrite. Open the database in MongoDB Compass to see the live data.
//   - A JSON file (data.json) when MONGODB_URI is not set. The tests use this by default.
//
// Keeping the working copy in memory keeps every request synchronous, so two requests can never
// interleave half-way through a wallet or order change.

const fs = require('fs');
const path = require('path');

// ---------- Settings ----------
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'rasoise';
const USE_MONGO = Boolean(MONGODB_URI);

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

// Fill in missing collections and fields added in later versions (notice period, skip limits...)
function normalise(parsed) {
  COLLECTIONS.forEach(c => { if (!Array.isArray(parsed[c])) parsed[c] = []; });
  if (!parsed.counters) parsed.counters = {};
  if (!parsed.version) parsed.version = 2;
  require('./lib/models').upgradeRecords(parsed);
  return parsed;
}

// Read and (if needed) upgrade data.json
function readFile(file) {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf-8');
  let parsed = raw.trim() ? JSON.parse(raw) : emptyData();
  // Old (v1) files have no version field. Convert them once and keep a backup.
  if (!parsed.version) {
    const { migrateLegacy } = require('./migrate');
    const backup = file.replace(/\.json$/, '.legacy.json');
    fs.copyFileSync(file, backup);
    parsed = migrateLegacy(parsed, emptyData());
    console.log(`[db] Migrated legacy data.json (backup saved to ${path.basename(backup)})`);
  }
  return normalise(parsed);
}

function writeFile() {
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

// ---------- MongoDB ----------
let client = null;
let mdb = null;
let persisted = null;              // { collection: Map(_id -> JSON of the stored record) }, plus meta
let writeChain = Promise.resolve(); // writes run one after another, in commit order
let writeFailed = false;

// Every record gets a stable _id: its id, or its kitchenId for menus (one menu per kitchen)
function keyOf(collection, doc) {
  return collection === 'menus' ? doc.kitchenId : doc.id;
}

function metaOf(d) {
  return JSON.stringify({ version: d.version, counters: d.counters });
}

// Indexes for the lookups the app does most (also visible under "Indexes" in Compass)
async function createIndexes() {
  const specs = [
    ['users', { email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string', $gt: '' } } }],
    ['users', { phone: 1 }, {}],
    ['kitchens', { ownerId: 1 }, {}],
    ['orders', { kitchenId: 1, date: 1, slot: 1 }, {}],
    ['orders', { customerId: 1, date: 1 }, {}],
    ['orders', { subscriptionId: 1 }, {}],
    ['subscriptions', { customerId: 1 }, {}],
    ['walletTransactions', { userId: 1 }, {}],
    ['notifications', { userId: 1, createdAt: -1 }, {}],
    ['sessions', { userId: 1 }, {}],
    ['reviews', { kitchenId: 1 }, {}],
    ['tickets', { kitchenId: 1, status: 1 }, {}]
  ];
  for (const [c, keys, opts] of specs) {
    try { await mdb.collection(c).createIndex(keys, opts); } catch (e) { console.warn(`[db] Index on ${c} skipped: ${e.message}`); }
  }
}

// Connect and load everything into memory. If the MongoDB database is empty and a data.json
// exists, its contents are imported once (so switching to MongoDB keeps your data).
async function init({ importFile = true } = {}) {
  if (!USE_MONGO) { load(); return; }
  if (data) return;
  const { MongoClient } = require('mongodb');
  client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(`Could not connect to MongoDB at ${MONGODB_URI} (${err.message}). Is the MongoDB service running?`);
  }
  mdb = client.db(MONGODB_DB);

  const meta = await mdb.collection('meta').findOne({ _id: 'meta' });
  const loaded = emptyData();
  if (meta) {
    loaded.version = meta.version || 2;
    loaded.counters = meta.counters || {};
  }
  for (const c of COLLECTIONS) {
    const docs = await mdb.collection(c).find({}).sort({ _id: 1 }).toArray();
    loaded[c] = docs.map(({ _id, ...rest }) => rest);
  }

  persisted = { meta: meta ? metaOf(loaded) : null };
  COLLECTIONS.forEach(c => {
    persisted[c] = new Map(loaded[c].map(doc => [keyOf(c, doc), JSON.stringify(doc)]));
  });

  const isEmpty = !meta && COLLECTIONS.every(c => !loaded[c].length);
  if (isEmpty && importFile && fs.existsSync(DB_FILE)) {
    data = readFile(DB_FILE);
    console.log(`[db] MongoDB database "${MONGODB_DB}" was empty: imported ${path.basename(DB_FILE)} (${data.users.length} users, ${data.orders.length} orders).`);
  } else {
    data = normalise(loaded);
  }
  await createIndexes();
  save();
  await writeChain;
  console.log(`[db] Using MongoDB: ${MONGODB_URI.replace(/\/\/[^@/]*@/, '//***@')} database "${MONGODB_DB}"`);
}

// Work out what changed since the last write and queue it. The JSON is taken now, so later
// changes in memory can't leak into this write.
function queueMongoWrite() {
  const ops = {};
  COLLECTIONS.forEach(c => {
    const seen = new Set();
    const list = [];
    data[c].forEach(doc => {
      const id = keyOf(c, doc);
      if (id === undefined || id === null) return;
      seen.add(id);
      const json = JSON.stringify(doc);
      if (persisted[c].get(id) !== json) {
        list.push({ replaceOne: { filter: { _id: id }, replacement: { _id: id, ...JSON.parse(json) }, upsert: true } });
        persisted[c].set(id, json);
      }
    });
    [...persisted[c].keys()].forEach(id => {
      if (!seen.has(id)) {
        list.push({ deleteOne: { filter: { _id: id } } });
        persisted[c].delete(id);
      }
    });
    if (list.length) ops[c] = list;
  });
  const meta = metaOf(data);
  const metaChanged = meta !== persisted.meta;
  persisted.meta = meta;
  if (!Object.keys(ops).length && !metaChanged) return;

  writeChain = writeChain.then(async () => {
    for (const [c, list] of Object.entries(ops)) await mdb.collection(c).bulkWrite(list, { ordered: true });
    if (metaChanged) await mdb.collection('meta').replaceOne({ _id: 'meta' }, { _id: 'meta', ...JSON.parse(meta) }, { upsert: true });
  }).catch(err => {
    // Keep running on the in-memory copy, and rewrite everything on the next save
    console.error('[db] MongoDB write failed, will retry on the next change:', err.message);
    writeFailed = true;
  });
}

// ---------- Shared API (used by the whole app) ----------
function load() {
  if (data) return data;
  if (USE_MONGO) throw new Error('Database not ready: call await db.init() before using it.');
  data = readFile(DB_FILE) || emptyData();
  save();
  return data;
}

function save() {
  if (!USE_MONGO) return writeFile();
  if (writeFailed) {
    // A previous write failed: forget what we think is stored so everything is written again
    writeFailed = false;
    COLLECTIONS.forEach(c => { persisted[c] = new Map(); });
    persisted.meta = null;
  }
  queueMongoWrite();
}

// Replace the whole dataset (used by the seed script).
function replace(newData) {
  data = normalise(newData);
  save();
}

// Wait for queued writes and close the connection (seed script, server shutdown)
async function close() {
  if (!USE_MONGO || !client) return;
  await writeChain;
  await client.close();
  client = null;
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
// half-applied data in memory (or in the database).
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

module.exports = {
  init, close, load, save, replace, nextId, transaction, afterCommit, findById, emptyData,
  COLLECTIONS, DB_FILE, USE_MONGO, MONGODB_DB
};
