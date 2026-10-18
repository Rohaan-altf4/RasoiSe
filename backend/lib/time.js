// Business time helpers. Every meal date and cutoff is in India Standard Time (UTC+5:30),
// no matter what timezone the server machine uses.
//
// For demos and tests you can shift the clock with RASOI_NOW (an ISO timestamp).
// Time keeps moving forward from that point, so "8 AM cutoff" logic can be tested any time of day.

const IST_OFFSET_MS = 330 * 60 * 1000;
const bootedAt = Date.now();

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function now() {
  const base = process.env.RASOI_NOW ? Date.parse(process.env.RASOI_NOW) : NaN;
  return new Date(Number.isNaN(base) ? Date.now() : base + (Date.now() - bootedAt));
}

function nowISO() {
  return now().toISOString();
}

// { date: 'YYYY-MM-DD', minutes: minutes since IST midnight }
function istParts(d = now()) {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  };
}

function today() {
  return istParts().date;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay();
}

function dayKey(dateStr) {
  return DAY_KEYS[weekday(dateStr)];
}

function isValidDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '08:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// True while changes for `dateStr` are still allowed (before the kitchen's cutoff on that day).
function isBeforeCutoff(dateStr, cutoff = '08:00') {
  const { date, minutes } = istParts();
  if (dateStr > date) return true;
  if (dateStr < date) return false;
  return minutes < toMinutes(cutoff);
}

// '15:30' -> '3:30 PM'
function fmt12(hhmm) {
  const mins = toMinutes(hhmm);
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// The moment 'YYYY-MM-DD' at 'HH:MM' happens in India (as a real Date)
function istMoment(dateStr, hhmm) {
  return new Date(Date.parse(dateStr + 'T00:00:00Z') - IST_OFFSET_MS + toMinutes(hhmm) * 60000);
}

// 'Thu 16 Oct, 12:30 PM' for a Date, in India time
function fmtIST(d) {
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hhmm = `${String(s.getUTCHours()).padStart(2, '0')}:${String(s.getUTCMinutes()).padStart(2, '0')}`;
  return `${days[s.getUTCDay()]} ${s.getUTCDate()} ${months[s.getUTCMonth()]}, ${fmt12(hhmm)}`;
}

// Days between two YYYY-MM-DD strings (b - a)
function diffDays(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

module.exports = {
  DAY_KEYS, now, nowISO, istParts, today, addDays, weekday, dayKey,
  isValidDate, toMinutes, fmt12, isBeforeCutoff, diffDays, istMoment, fmtIST
};
