// An express-session store backed by the Firebase Realtime Database.
//
// express-session's default MemoryStore keeps sessions in the process, which is
// fine on a long-running server but useless on Vercel: each request may hit a
// different (or brand new) serverless instance, so a session written by one is
// invisible to the next and users appear logged out at random.
//
// Keeping cookie sessions — rather than switching to a bearer token per
// request — matters because app.html hydrates progress with a *synchronous*
// XHR before first paint. Fetching a Firebase ID token is async, so a token
// scheme would break that pre-paint hydration; a cookie rides along for free.

const firebase = require('./firebase');

module.exports = function (session) {
  const Store = session.Store;

  class FirebaseSessionStore extends Store {
    constructor(options = {}) {
      super(options);
      this.path = options.path || 'sessions';
      // Sessions are pruned lazily on read: serverless has no long-lived
      // process to run a sweeper, and a stale row is harmless until touched.
      this.ttlMs = options.ttlMs || 30 * 24 * 60 * 60 * 1000; // matches the cookie's 30 days
    }

    // firebase.database() throws SYNCHRONOUSLY when Firebase isn't configured,
    // so this helper must not be followed by a Promise chain — otherwise the
    // throw escapes the `.catch()` and crashes the whole serverless function.
    ref(sid) {
      return firebase.database().ref(`${this.path}/${encodeKey(sid)}`);
    }

    safeRef(sid, cb, then) {
      let ref;
      try { ref = this.ref(sid); }
      catch (err) {
        // Log once per cold start so Vercel's logs surface the reason, but do
        // not fail the request: falling back to no-session-persistence is
        // better than a 500 on every page.
        if (!FirebaseSessionStore._warned) {
          console.error('[session-store] Firebase unavailable, sessions will not persist:', err.message);
          FirebaseSessionStore._warned = true;
        }
        return cb && cb(null);
      }
      return then(ref);
    }

    get(sid, cb) {
      this.safeRef(sid, cb, ref => ref.once('value')
        .then(snap => {
          const row = snap.val();
          if (!row) return cb(null, null);
          if (row.expiresAt && row.expiresAt < Date.now()) {
            return ref.remove().then(() => cb(null, null)).catch(() => cb(null, null));
          }
          let data;
          try { data = JSON.parse(row.json); } catch (e) { return cb(null, null); }
          cb(null, data);
        })
        .catch(err => cb(err)));
    }

    set(sid, sess, cb) {
      // Stored as a JSON string: session data is arbitrary and may contain keys
      // (dots, undefined) that RTDB would reject as field names.
      const row = {
        json: JSON.stringify(sess),
        expiresAt: expiryOf(sess, this.ttlMs),
        updatedAt: Date.now(),
      };
      this.safeRef(sid, cb, ref => ref.set(row).then(() => cb && cb(null)).catch(err => cb && cb(err)));
    }

    destroy(sid, cb) {
      this.safeRef(sid, cb, ref => ref.remove().then(() => cb && cb(null)).catch(err => cb && cb(err)));
    }

    touch(sid, sess, cb) {
      // Just push the expiry out; no need to rewrite the payload. A failed
      // touch must not break the request.
      this.safeRef(sid, () => cb && cb(null), ref => ref.update({ expiresAt: expiryOf(sess, this.ttlMs) })
        .then(() => cb && cb(null))
        .catch(() => cb && cb(null)));
    }

    // Admin action: forcibly evict every session that belongs to one user.
    // Used when an account is banned, so their existing browser tab loses
    // its cookie's underlying record and the next request treats them as
    // unauthenticated (and firebase-session will then refuse them).
    async destroyByUserId(userId) {
      if (!userId) return 0;
      let count = 0;
      try {
        const snap = await firebase.database().ref(this.path).once('value');
        const rows = snap.val() || {};
        const jobs = [];
        for (const [key, row] of Object.entries(rows)) {
          try {
            const data = JSON.parse(row.json || '{}');
            if (data.userId === userId) {
              jobs.push(firebase.database().ref(`${this.path}/${key}`).remove());
              count++;
            }
          } catch (e) { /* skip corrupt rows */ }
        }
        await Promise.all(jobs);
      } catch (e) {
        console.error('[session-store] destroyByUserId failed:', e.message);
      }
      return count;
    }
  }

  return FirebaseSessionStore;
};

function expiryOf(sess, ttlMs) {
  const cookieExpiry = sess && sess.cookie && sess.cookie.expires;
  if (cookieExpiry) return new Date(cookieExpiry).getTime();
  return Date.now() + ttlMs;
}

// RTDB keys can't contain . $ # [ ] / — session ids are URL-safe base64 and can
// legitimately include some of these, so encode defensively.
function encodeKey(sid) {
  return encodeURIComponent(sid).replace(/\./g, '%2E');
}
