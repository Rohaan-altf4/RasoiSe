// Copy data.json into MongoDB, replacing what is in the MongoDB database.
// (The server already does this by itself the first time, when the database is empty.)
// Stop the server first, then:  npm run mongo:import

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');

(async () => {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in backend/.env first (e.g. mongodb://localhost:27017).');
  const db = require('./db');
  if (!fs.existsSync(db.DB_FILE)) throw new Error(`${db.DB_FILE} not found.`);
  // Read the file the same way file mode does (including upgrades), then write it to MongoDB
  const raw = JSON.parse(fs.readFileSync(db.DB_FILE, 'utf8'));
  await db.init({ importFile: false });
  db.replace(raw);
  await db.close();
  const d = raw;
  console.log(`Imported ${path.basename(db.DB_FILE)} into MongoDB database "${db.MONGODB_DB}": ` +
    db.COLLECTIONS.map(c => `${c} ${(d[c] || []).length}`).join(', '));
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
