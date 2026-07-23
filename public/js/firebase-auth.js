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

  // A student-readable reason a verification email failed to send, so we never
  // claim "email sent" when it wasn't. Firebase throttles verification sends
  // per project, so a burst of sign-ups can hit auth/too-many-requests — the
  // single most common cause of "registered but never got the email".
  function friendlyVerificationError(err) {
    var code = err && err.code;
    if (code === 'auth/too-many-requests') {
      return 'Too many verification emails were requested at once. Please wait 1–2 minutes, then tap “Resend verification email”.';
    }
    if (code === 'auth/network-request-failed') {
      return 'Network problem while sending the verification email — check your connection and tap “Resend verification email”.';
    }
    return 'Your account was created, but the verification email didn’t go out. Tap “Resend verification email” to try again.';
  }

  // Send a verification email that WORKS even before a new custom domain has
  // been added to Firebase's Authorized domains. Passing a continue `url` on an
  // un-authorized domain makes Firebase reject the whole call with
  // auth/unauthorized-continue-uri — so the email silently never sends. We try
  // with the nice same-domain continue URL first, and on that specific failure
  // retry with NO continue URL, which uses Firebase's own hosted action page
  // and always succeeds. (Add the domain in the console to get the nicer
  // same-site landing — see the README's Firebase setup.)
  async function sendVerification(user) {
    try {
      await user.sendEmailVerification(actionSettings());
    } catch (err) {
      if (err && (err.code === 'auth/unauthorized-continue-uri' || err.code === 'auth/invalid-continue-uri')) {
        await user.sendEmailVerification(); // default hosted action page
      } else {
        throw err;
      }
    }
  }
  async function sendResetEmail(auth, email) {
    try {
      await auth.sendPasswordResetEmail(email, actionSettings());
    } catch (err) {
      if (err && (err.code === 'auth/unauthorized-continue-uri' || err.code === 'auth/invalid-continue-uri')) {
        await auth.sendPasswordResetEmail(email); // default hosted action page
      } else {
        throw err;
      }
    }
  }

  // ---- Sign up ----
  // Creates the Firebase account, sends the verification email, and registers
  // the profile with our server. Deliberately does NOT log the user in: they
  // must verify their email first.
  async function signUp(email, password, profile) {
    const auth = await ready();
    let cred;
    // Track whether the verification email actually went out, so the UI can tell
    // the truth instead of always saying "email sent" even when it failed.
    let emailSent = false;
    let emailError = null;

    try {
      cred = await auth.createUserWithEmailAndPassword(email, password);
      // Send the verification email before anything else can fail.
      try { await sendVerification(cred.user); emailSent = true; }
      catch (e) { emailError = friendlyVerificationError(e); }
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
        try { await sendVerification(cred.user); emailSent = true; }
        catch (e) { emailError = friendlyVerificationError(e); }
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
    return { needsVerification: true, email: email, emailSent: emailSent, emailError: emailError };
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
      // They're blocked on verification — so send a FRESH link right now. This
      // is the recovery path for anyone whose original signup email was dropped
      // or throttled: just try to log in and a new one goes out. Report whether
      // it actually sent so the page can say the truth.
      let emailSent = false, emailError = null;
      try { await sendVerification(cred.user); emailSent = true; }
      catch (e) { emailError = friendlyVerificationError(e); }
      return { needsVerification: true, email: email, emailSent: emailSent, emailError: emailError };
    }

    const idToken = await cred.user.getIdToken(true);
    const r = await postSession(idToken);
    if (!r.ok) {
      await auth.signOut();
      // Blocked by the max-devices rule: hand the (still valid) ID token back
      // so the login page can offer the appeal form — the token is the proof
      // of account ownership the appeal endpoint requires.
      if (r.data.deviceBlocked) {
        return { deviceBlocked: true, error: r.data.error, idToken: idToken };
      }
      throw new Error(r.data.error || 'Could not sign you in.');
    }
    return { ok: true, user: r.data };
  }

  // ---- Device-limit appeal ----
  // Sends the user's explanation to the admin's Devices & Violations queue.
  async function sendDeviceAppeal(idToken, message) {
    const res = await fetch('/api/auth/device-appeal', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': (typeof getDeviceId === 'function') ? getDeviceId() : '',
      },
      body: JSON.stringify({ idToken: idToken, message: message }),
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'Could not send your appeal right now.');
    return data;
  }

  // ---- Resend the verification email ----
  // Requires a signed-in Firebase user, so callers pass the password again.
  async function resendVerification(email, password) {
    const auth = await ready();
    const cred = await auth.signInWithEmailAndPassword(email, password);
    try {
      await cred.user.reload();
      if (cred.user.emailVerified) return { alreadyVerified: true };
      await sendVerification(cred.user);
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
      // Resilient send: falls back to Firebase's hosted page if the current
      // domain isn't in Authorized domains yet (see sendResetEmail).
      await sendResetEmail(auth, email);
    } catch (err) {
      if (err.code !== 'auth/user-not-found' && err.code !== 'auth/invalid-email') throw err;
    }
    return { ok: true };
  }

  // ---- Continue with Google ----
  // Google accounts arrive already email-verified, so this sidesteps the
  // verification-email problem entirely. Existing users sign straight in; a
  // brand-new Google user has no profile yet (phone/college/year), so the
  // server answers 409 needsProfile and the caller collects those fields, then
  // calls completeGoogleProfile() to finish creating the account.
  async function signInWithGoogle() {
    const auth = await ready();
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    let cred;
    try {
      cred = await auth.signInWithPopup(provider);
    } catch (err) {
      const code = err && err.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') {
        return { cancelled: true };
      }
      if (code === 'auth/operation-not-allowed') {
        throw new Error('Google sign-in isn’t switched on for this site yet. Please use email sign-up for now.');
      }
      if (code === 'auth/account-exists-with-different-credential') {
        throw new Error('This email already has a password account here. Please log in with your email and password instead.');
      }
      if (code === 'auth/popup-blocked') {
        throw new Error('Your browser blocked the Google pop-up. Please allow pop-ups for this site and try again.');
      }
      if (code === 'auth/unauthorized-domain') {
        throw new Error('This web address isn’t authorised for Google sign-in yet. Please try again shortly or use email sign-up.');
      }
      throw new Error(friendlyError(err));
    }

    const idToken = await cred.user.getIdToken();
    const r = await postSession(idToken);
    if (r.ok) return { ok: true, user: r.data };

    // New Google user: the server has no profile for them yet.
    if (r.status === 409 || (r.data && r.data.needsProfile)) {
      return { needsProfile: true, email: cred.user.email || '', name: cred.user.displayName || '' };
    }
    // Blocked by the device limit — hand the token back for the appeal form.
    if (r.data && r.data.deviceBlocked) {
      await auth.signOut();
      return { deviceBlocked: true, error: r.data.error, idToken: idToken };
    }
    await auth.signOut();
    throw new Error((r.data && r.data.error) || 'Could not sign you in with Google.');
  }

  // Finish a brand-new Google signup once the extra profile fields are filled.
  // Reads a fresh ID token from the still-signed-in Google user, so it works
  // however long the person spent on the details form.
  async function completeGoogleProfile(profile) {
    const auth = await ready();
    const user = auth.currentUser;
    if (!user) throw new Error('Your Google sign-in timed out. Please tap “Continue with Google” again.');
    const idToken = await user.getIdToken(true);
    const r = await postSession(idToken, profile);
    if (r.ok) return { ok: true, user: r.data };
    if (r.data && r.data.deviceBlocked) return { deviceBlocked: true, error: r.data.error, idToken: idToken };
    await auth.signOut();
    throw new Error((r.data && r.data.error) || 'Could not finish setting up your account.');
  }

  // ---- Log out ----
  async function logOut() {
    try { const auth = await ready(); await auth.signOut(); } catch (e) {}
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
  }

  return { ready, signUp, logIn, signInWithGoogle, completeGoogleProfile, resendVerification, sendReset, sendDeviceAppeal, logOut, friendlyError };
})();
