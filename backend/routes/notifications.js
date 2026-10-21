// Notification bell + live event stream (Server-Sent Events).

const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');
const { addClient, removeClient } = require('../lib/notify');

const router = express.Router();

router.get('/notifications', auth.requireAuth, (req, res) => {
  const d = db.load();
  const mine = d.notifications.filter(n => n.userId === req.user.id);
  const list = mine.sort((a, b) => b.id - a.id).slice(0, Math.min(100, Number(req.query.limit) || 30));
  res.json({ notifications: list, unread: mine.filter(n => !n.read).length });
});

router.post('/notifications/read', auth.requireAuth, (req, res) => {
  const { ids, all } = req.body || {};
  const unread = db.transaction(d => {
    d.notifications.forEach(n => {
      if (n.userId === req.user.id && !n.read && (all || (Array.isArray(ids) && ids.includes(n.id)))) n.read = true;
    });
    return d.notifications.filter(n => n.userId === req.user.id && !n.read).length;
  });
  res.json({ unread });
});

// One long-lived connection per open tab. The browser reconnects by itself if it drops.
router.get('/events', auth.requireAuth, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const unread = db.load().notifications.filter(n => n.userId === req.user.id && !n.read).length;
  res.write(`event: hello\ndata: ${JSON.stringify({ unread })}\n\n`);
  const userId = req.user.id;
  addClient(userId, res);
  req.on('close', () => removeClient(userId, res));
});

module.exports = router;
