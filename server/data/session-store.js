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

    ref(sid) {
      return firebase.database().ref(`${this.path}/${encodeKey(sid)}`);
    }

    get(sid, cb) {
      this.ref(sid).once('value')
        .then(snap => {
          const row = snap.val();
          if (!row) return cb(null, null);
          if (row.expiresAt && row.expiresAt < Date.now()) {
            return this.ref(sid).remove().then(() => cb(null, null)).catch(() => cb(null, null));
          }
          let data;
          try { data = JSON.parse(row.json); } catch (e) { return cb(null, null); }
          cb(null, data);
        })
        .catch(err => cb(err));
    }

    set(sid, sess, cb) {
      // Stored as a JSON string: session data is arbitrary and may contain keys
      // (dots, undefined) that RTDB would reject as field names.
      const row = {
        json: JSON.stringify(sess),
        expiresAt: expiryOf(sess, this.ttlMs),
        updatedAt: Date.now(),
      };
      this.ref(sid).set(row).then(() => cb && cb(null)).catch(err => cb && cb(err));
    }

    destroy(sid, cb) {
      this.ref(sid).remove().then(() => cb && cb(null)).catch(err => cb && cb(err));
    }

    touch(sid, sess, cb) {
      // Just push the expiry out; no need to rewrite the payload.
      this.ref(sid).update({ expiresAt: expiryOf(sess, this.ttlMs) })
        .then(() => cb && cb(null))
        .catch(() => cb && cb(null)); // a failed touch must not break the request
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
