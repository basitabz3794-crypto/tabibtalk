/* ============================================================
   Firebase Auth wiring for Tabib Talk.

   Firebase owns identity: it stores passwords and sends the email-verification
   and password-reset emails itself, with no admin step. The server still owns
   everything else (plans, payments, devices, admin) and keeps using its own
   session — so after a Firebase sign-in we hand the resulting ID token to
   /api/auth/firebase-session, which verifies it and sets that session cookie.

   Load order on a page that uses this:
     firebase-app-compat.js -> firebase-auth-compat.js -> header.js -> this file
   ============================================================ */

const TTAuth = (function () {
  let initPromise = null;

  // Initialise once, using the config the server serves from its env.
  function ready() {
    if (!initPromise) {
      initPromise = fetch('/api/config/firebase', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (cfg) {
          if (!cfg.apiKey) throw new Error('Sign-in is not configured on this server yet.');
          if (!firebase.apps.length) firebase.initializeApp(cfg);
          return firebase.auth();
        });
    }
    return initPromise;
  }

  // Like api(), but hands back the status so callers can react to the
  // "needs verification" 403 rather than just seeing a thrown error.
  async function postSession(idToken, profile) {
    const res = await fetch('/api/auth/firebase-session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': (typeof getDeviceId === 'function') ? getDeviceId() : '',
      },
      body: JSON.stringify({ idToken: idToken, profile: profile || undefined }),
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, data: data || {} };
  }

  // Turn Firebase's error codes into something a student can act on.
  function friendlyError(err) {
    switch (err && err.code) {
      case 'auth/invalid-email': return 'That email address doesn\'t look right.';
      case 'auth/user-disabled': return 'This account has been disabled. Please contact support.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential': return 'Incorrect email or password.';
      case 'auth/email-already-in-use': return 'An account with this email already exists. Try logging in instead.';
      case 'auth/weak-password': return 'Please choose a password of at least 6 characters.';
      case 'auth/too-many-requests': return 'Too many attempts. Please wait a few minutes and try again.';
      case 'auth/network-request-failed': return 'Network problem — please check your connection and try again.';
      default: return (err && err.message) || 'Something went wrong. Please try again.';
    }
  }

  // Where Firebase's verification / reset links land the user afterwards.
  function actionSettings() {
    return { url: window.location.origin + '/login.html', handleCodeInApp: false };
  }

  // ---- Sign up ----
  // Creates the Firebase account, sends the verification email, and registers
  // the profile with our server. Deliberately does NOT log the user in: they
  // must verify their email first.
  async function signUp(email, password, profile) {
    const auth = await ready();
    let cred;

    try {
      cred = await auth.createUserWithEmailAndPassword(email, password);
      // Send the verification email before anything else can fail.
      try { await cred.user.sendEmailVerification(actionSettings()); } catch (e) { /* non-fatal; user can resend */ }
    } catch (err) {
      if (err.code !== 'auth/email-already-in-use') throw err;
      // The Firebase account exists but our server may never have received the
      // profile (e.g. the network dropped right after the password was set).
      // If they can sign in, they own the account, so finish the job rather
      // than dead-ending them: signing up says "already exists, log in", while
      // logging in can't proceed without a profile.
      try {
        cred = await auth.signInWithEmailAndPassword(email, password);
      } catch (signInErr) {
        throw err; // wrong password — the address really is taken by someone else
      }
      if (!cred.user.emailVerified) {
        try { await cred.user.sendEmailVerification(actionSettings()); } catch (e) {}
      }
    }

    // Hand the profile to the server so the account record exists with the
    // details typed at signup. Normally comes back 403 needsVerification.
    const idToken = await cred.user.getIdToken();
    const r = await postSession(idToken, profile);

    // Already verified and the server accepted us: the session is live, so stay
    // signed in and let the caller go straight through to the app.
    if (r.ok) return { ok: true, user: r.data };

    // Otherwise don't leave a half-signed-in Firebase session lying around.
    await auth.signOut();
    if (!r.data.needsVerification) {
      throw new Error(r.data.error || 'Could not finish creating your account.');
    }
    return { needsVerification: true, email: email };
  }

  // ---- Log in ----
  // Returns { ok: true } once the server session is established, or
  // { needsVerification: true } if the email hasn't been verified yet.
  async function logIn(email, password) {
    const auth = await ready();
    const cred = await auth.signInWithEmailAndPassword(email, password);

    // Pick up a verification that happened in another tab/device, then force a
    // fresh token so its email_verified claim is up to date for the server.
    await cred.user.reload();
    if (!cred.user.emailVerified) {
      return { needsVerification: true, email: email };
    }

    const idToken = await cred.user.getIdToken(true);
    const r = await postSession(idToken);
    if (!r.ok) {
      await auth.signOut();
      throw new Error(r.data.error || 'Could not sign you in.');
    }
    return { ok: true, user: r.data };
  }

  // ---- Resend the verification email ----
  // Requires a signed-in Firebase user, so callers pass the password again.
  async function resendVerification(email, password) {
    const auth = await ready();
    const cred = await auth.signInWithEmailAndPassword(email, password);
    try {
      await cred.user.reload();
      if (cred.user.emailVerified) return { alreadyVerified: true };
      await cred.user.sendEmailVerification(actionSettings());
      return { sent: true };
    } finally {
      await auth.signOut();
    }
  }

  // ---- Forgot password ----
  // Fully automated: Firebase sends the email and hosts the reset page.
  // Always reports success so the form can't be used to discover which
  // addresses are registered.
  async function sendReset(email) {
    const auth = await ready();
    try {
      await auth.sendPasswordResetEmail(email, actionSettings());
    } catch (err) {
      if (err.code !== 'auth/user-not-found' && err.code !== 'auth/invalid-email') throw err;
    }
    return { ok: true };
  }

  // ---- Log out ----
  async function logOut() {
    try { const auth = await ready(); await auth.signOut(); } catch (e) {}
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
  }

  return { ready, signUp, logIn, resendVerification, sendReset, logOut, friendlyError };
})();
