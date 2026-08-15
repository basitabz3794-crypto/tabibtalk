// Rate limiting.
//
// A sliding window held in memory. This runs on Vercel, where each serverless
// instance has its own memory and instances come and go, so this is not a
// guarantee — somebody determined, spreading requests across instances, gets
// more through than the number here suggests.
//
// It is still worth having. The realistic abuse is a script hammering one
// endpoint as fast as it can, and that lands on a warm instance and is stopped.
// The things that actually cost money are guarded properly elsewhere and do not
// depend on this: referral rewards are capped per calendar month against the
// ledger, and only one friend request can be open between two people at a time.
// This is the cheap outer layer, not the lock.
//
// Limits are set well above what a real student does. Anyone hitting one is
// either scripting or has a bug, and either way the answer is the same.

const WINDOWS = new Map();   // key -> array of timestamps
let lastSweep = Date.now();

// Old keys are dropped periodically rather than on a timer, so nothing is
// scheduled and an idle instance does no work. The cap is a backstop: if
// something pathological fills this, the whole thing is dropped rather than
// growing without limit.
const MAX_KEYS = 20000;
function sweep(now, windowMs) {
  if (now - lastSweep < 60000 && WINDOWS.size < MAX_KEYS) return;
  lastSweep = now;
  if (WINDOWS.size >= MAX_KEYS) { WINDOWS.clear(); return; }
  for (const [k, hits] of WINDOWS) {
    if (!hits.length || now - hits[hits.length - 1] > windowMs) WINDOWS.delete(k);
  }
}

// Behind Vercel the socket address is the proxy, so the forwarded header is the
// only thing that identifies a caller. It can be forged, which is exactly why
// this is never used to protect anything that costs money — only to stop a
// straightforward flood.
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || 'unknown';
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs   how long the window is
 * @param {number} opts.max        how many requests are allowed in it
 * @param {string} opts.name       used in the key, so two limiters never collide
 * @param {'ip'|'user'} opts.by    what to count against
 * @param {string} opts.message    what the caller is told
 */
function rateLimit(opts) {
  const { windowMs, max, name, by = 'ip', message } = opts;
  return function (req, res, next) {
    // Counting a logged-in student by account rather than by address matters on
    // a university network, where a whole year group shares one address and
    // would otherwise exhaust a shared allowance between them.
    const who = by === 'user' ? (req.session && req.session.userId) : null;
    const key = name + ':' + (who || clientIp(req));

    const now = Date.now();
    sweep(now, windowMs);

    const hits = (WINDOWS.get(key) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
      res.set('Retry-After', String(Math.max(1, retryAfter)));
      return res.status(429).json({
        error: message || 'That is a lot of requests at once — please wait a moment and try again.',
        retryAfter,
      });
    }
    hits.push(now);
    WINDOWS.set(key, hits);
    next();
  };
}

// Exposed so a test can start from a clean slate rather than inheriting counts
// from whatever ran before it.
rateLimit.reset = function () { WINDOWS.clear(); lastSweep = Date.now(); };

module.exports = rateLimit;
