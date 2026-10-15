// Notifications + live updates.
// - notify() saves a notification (shown in the bell) and pushes it to any open tabs.
// - refresh() tells open tabs that some data changed so they can reload it ("orders", "wallet"...).
// Live pushes use Server-Sent Events: each open tab keeps one GET /api/events connection.

const db = require('../db');
const time = require('./time');

const clients = new Map(); // userId -> Set of open SSE responses

function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
}

function removeClient(userId, res) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(userId);
}

function push(userId, event, payload) {
  const set = clients.get(userId);
  if (!set) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  set.forEach(res => res.write(msg));
}

function uniq(ids) {
  return [...new Set(ids.filter(id => id != null))];
}

// Save + push a notification to one or more users.
function notify(d, userIds, { type, title, body = '', link = '' }) {
  uniq([].concat(userIds)).forEach(userId => {
    const n = {
      id: db.nextId('notifications'),
      userId, type, title, body, link,
      read: false,
      createdAt: time.nowISO()
    };
    d.notifications.push(n);
    // Push after the current change has been saved
    db.afterCommit(() => push(userId, 'notification', n));
  });
}

// Ask open pages to re-fetch. topics: e.g. ['orders', 'wallet', 'kitchen']
function refresh(userIds, topics) {
  uniq([].concat(userIds)).forEach(userId => {
    db.afterCommit(() => push(userId, 'refresh', { topics }));
  });
}

function adminIds(d) {
  return d.users.filter(u => u.role === 'admin' && u.status !== 'suspended').map(u => u.id);
}

function audit(d, actor, action, target, detail) {
  d.auditLog.push({
    id: db.nextId('auditLog'),
    action,
    actorId: actor ? actor.id : null,
    actorName: actor ? `${actor.name} (${actor.role})` : 'System',
    target,
    detail,
    createdAt: time.nowISO()
  });
}

// Heartbeat so proxies don't close idle connections
setInterval(() => {
  clients.forEach(set => set.forEach(res => res.write(': ping\n\n')));
}, 25000).unref();

module.exports = { addClient, removeClient, push, notify, refresh, adminIds, audit };
