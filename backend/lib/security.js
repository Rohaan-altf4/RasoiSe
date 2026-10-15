// Basic protection for running on the public internet:
// - a few standard security headers
// - a simple per-IP limit on sign-in / sign-up so passwords can't be guessed endlessly
// (Kept in memory: fine for one server. Use a shared store if you ever run several.)

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  next();
}

// rateLimit({ max: 10, windowMs: 15 * 60 * 1000 }) -> at most 10 requests per IP per window
function rateLimit({ max, windowMs, message }) {
  const hits = new Map(); // ip -> { count, resetAt }
  setInterval(() => {
    const now = Date.now();
    hits.forEach((v, ip) => { if (v.resetAt <= now) hits.delete(ip); });
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const entry = hits.get(req.ip);
    if (!entry || entry.resetAt <= now) {
      hits.set(req.ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: message || 'Too many attempts. Please wait a few minutes and try again.' });
    }
    next();
  };
}

module.exports = { securityHeaders, rateLimit };
