## Feature summary (accounts, subscriptions, admin hub)

This site now includes a full subscription platform on a premium dark UI
(Linear / Apple / Stripe inspired), built in the plain-HTML/Express stack:

**Accounts & access**
- Signup collects name, nationality, email, and college year/grade.
- Signing up grants the free **Explorer** tier — required before buying any plan.
- **Firebase Auth owns sign-in.** Signing up sends a verification email
  automatically, and users can't log in until they've clicked it.
- **Forgot-password is fully automated**: Firebase emails a reset link straight
  away — no admin step. (See "Firebase setup" below.)
- QBank is **Professional/Lifetime only**; Explorer and Student get the
  upgrade prompt.
- **Max 2 devices per account.** A stable device id is sent on every request;
  a 3rd device is blocked and recorded as a flagged violation.
- **Copy protection** across the site (disables selection, right-click, and
  common copy/devtools shortcuts — a strong deterrent, though by the nature
  of the web not absolutely unbreakable).

**My Account** (pinned in the top-right nav on every page)
- All personal details, current tier, and the exact **plan expiry date** with
  a days-remaining countdown (lifetime shows "never expires").
- A **recommendation box** — feedback is saved and shown in the admin hub.
- Payment history across PayPal / InstaPay / UPI.

**Subscriptions & expiry**
- On approval, a plan's duration is recorded (monthly 30d, 6-month 180d,
  yearly 365d, lifetime never). When the duration elapses, the subscription
  is **suspended** automatically (access reverts to Explorer) and shows as
  suspended in the hub.

**Admin hub** (`/admin.html`, unlocked with your `ADMIN_KEY`) — an analytics
dashboard with 8 live stat cards and tabs for:
- **Subscriptions**: pending (with approve/reject), active, suspended, and
  rejected — each with the payment transaction id, method, plan, and user.
- **Users**: everyone who signed up, their details, tier, subscription state,
  device count, and status, with **suspend / ban / unban** actions.
- **Password resets**: historical requests only. Firebase now emails reset
  links directly, so nothing new lands here and no admin action is needed.
- **Recommendations**: everything users submitted.
- **Devices & violations**: full per-device history with a **flag** action.

**Terms & Conditions** — a popup (with a close ×) covering no-refunds,
no auto-payment/no forced renewal, and no account/device sharing. Available
from the payment page, the homepage side menu, and the signup form.

---

# Tabib Talk — Website

A small Node.js/Express backend + plain-HTML frontend that adds accounts,
subscription plans, and three manually-verified payment methods (PayPal,
InstaPay, UPI) on top of the existing Tabib Talk learning app. There is
no automatic card gateway (Stripe) in this version — every payment is
confirmed by you personally via a simple admin panel, which needs no
business registration or KYC of any kind to set up.

## What's included

```
tabib-talk-web/
  api/
    index.js              Vercel serverless entry — exports the Express app
  vercel.json             routes /api/* to that function; public/ is served by the CDN
  server/
    index.js              Express app (only listens when run directly, for local dev)
    routes/auth.js         signup / login / logout / current-user
    routes/plans.js         serves the plan list/prices to the frontend
    routes/manual-payments.js   generic manual-payment router (shared by PayPal + InstaPay + UPI)
    routes/paypal.js          PayPal-specific config on top of manual-payments.js
    routes/instapay.js        InstaPay-specific config on top of manual-payments.js
    routes/upi.js              UPI-specific config on top of manual-payments.js
    routes/admin.js            combined "all pending proofs, any method" listing for admin.html
    data/store.js          the database — Firebase Realtime Database (users, payment proofs, devices…)
    data/firebase.js       Firebase Admin SDK: token verification + database handle
    data/session-store.js  express-session store backed by Firebase (survives serverless)
    data/plans.js          single source of truth for plan names and prices
  public/
    index.html              homepage
    plans.html               pricing page — PayPal (international) + InstaPay + UPI
    login.html               signup / login
    account.html             shows current plan + payment proof status (all methods)
    admin.html                review & approve/reject PayPal/InstaPay/UPI proofs, in one place
    app.html                  the actual Tabib Talk learning app, with a tier-sync script added
    css/main.css              shared styles, matching the app's existing look
    js/header.js              shared header + small fetch() helper
    js/firebase-auth.js       Firebase Auth: signup, login, verification, password reset
  .env.example              copy to .env and fill in real values
```

## 1. Install & run locally

```bash
cd tabib-talk-web
npm install
cp .env.example .env
npm start
```

Visit http://localhost:3000

You must complete the Firebase setup (step 4) first: Firebase is both the
database and the sign-in provider, so without credentials the server starts but
sign-in returns a 503. Once configured, signup/login and all three
manual-payment flows (PayPal, InstaPay, UPI) work out of the box — none of them
need external API keys. Fill in your real payment details (step 2) before going
live so users see correct information.

## 2. Set up your payment details (no business registration needed)

All three payment methods work the same way: you show the user where to
send money, they submit the transaction id from their payment app, and you
check it against your statement and approve it from `/admin.html`, which
instantly activates their plan. None of this
requires a company, GST number, or business bank account — just your
personal PayPal, InstaPay, and UPI details.

In `.env`, fill in:

- **PayPal** (international payments, e.g. from Indian or any other cards):
  `PAYPAL_EMAIL` (your PayPal account's email) and optionally
  `PAYPAL_ME_LINK` (a `paypal.me/yourname` link, if you have one — gives
  users a one-click way to pay you). A **Business-type PayPal account**
  (still free, still no company required) is worth using over a Personal
  one, since PayPal's own policies flag repeated personal-account payments
  for a product/service as something that should be a Business account —
  using one from the start avoids your account being limited later.
- **InstaPay** (Egypt): `INSTAPAY_IPA`, `INSTAPAY_PHONE`.
- **UPI** (India): `UPI_ID`, `UPI_PAYEE_NAME`.

**Why none of these are automatic gateways:** Paymob/Fawry (Egypt) and
Paytm (India) all require a registered business with GST/Commercial
Register documents to onboard as a merchant. Stripe doesn't support Egypt
at all, and its India UPI support looked uncertain/possibly GST-gated when
I checked. Manual approval sidesteps all of that and works today with zero
paperwork — the tradeoff is that you (or someone you trust) need to check
`/admin.html` periodically to approve incoming payments, rather than it
happening instantly and automatically.

All three methods share the same underlying "manual payment proof" system
(`server/routes/manual-payments.js`), so adding a fourth method later
(e.g. a direct bank transfer option) is a ~10-line addition, not a rebuild.

Set `ADMIN_KEY` in `.env` to a long random string — this is the password
you'll paste into `/admin.html` to review and approve payment proofs from
**all three methods** in one place. **Do not share this key**, and only
access `/admin.html` yourself.

## 3. The learning app is already embedded

`public/app.html` now contains the actual Tabib Talk learning app (not a
placeholder). On load, it calls `/api/auth/me`; if someone is logged in and
has a paid tier on the server (set by an admin-approved PayPal/InstaPay/UPI
payment), the app updates its local tier to match, so their real subscription
is reflected immediately — instead of relying only on whatever was last
stored in that browser. If nobody is logged in, the app behaves exactly as
it does when opened standalone (Explorer/local-only use still works).

**Choosing a paid plan inside the app never grants access directly.** The
app has its own in-app "Plans" preview (for browsing prices), but tapping
"Choose this plan" there redirects to the real `/plans.html?plan=<id>` on
this website, which pre-selects that exact plan and opens the payment
section — so there's exactly one real checkout path (PayPal / InstaPay /
UPI + your admin approval), and no way to get paid access without going
through it. Only the free Explorer plan can be chosen directly inside the
app, since no payment is needed for it.

**When you update the app itself** (new features, content, fixes), just
replace `public/app.html` with your latest version of
`egyptian-medical-arabic-guide.html` — the tier-sync script sits in its own
`<script>` block right before `</body>`, so re-copying a newer app version
and re-adding that same block (or asking me to do it) is all that's needed.


## 4. Firebase setup (sign-in, email verification, password reset, progress)

Firebase Auth stores passwords and sends the verification / password-reset
emails, so there is no manual admin step for either. The browser signs in
against Firebase and posts the resulting ID token to
`/api/auth/firebase-session`; the server verifies it with the Admin SDK and
establishes its own session, so plans, payments, devices and admin are
unchanged. Per-user progress lives in the Realtime Database, written
**server-side** so users can't forge their own streak or scores.

In the [Firebase console](https://console.firebase.google.com), for the
project in your `.env`:

1. **Authentication → Sign-in method →** enable **Email/Password**.
2. **Realtime Database →** create a database.
3. **Realtime Database → Rules →** paste this and publish. Only the server
   touches progress, and the Admin SDK bypasses rules, so the browser is
   denied outright:

   ```json
   { "rules": { ".read": false, ".write": false } }
   ```

4. **Project settings → Service accounts → Generate new private key.** Put the
   whole downloaded JSON on one line in `.env` as
   `FIREBASE_SERVICE_ACCOUNT_JSON='{...}'` (single quotes). **This is a real
   secret** — it grants full admin access to the project. Never commit it.
5. Fill in the `FIREBASE_*` client values from **Project settings → Your apps**.
   Unlike the service account, these are safe to expose publicly — a web API
   key only identifies the project.

Without `FIREBASE_SERVICE_ACCOUNT_JSON` the server still boots, but sign-in
returns a 503 and progress falls back to the local JSON store.

**Optional — keep reset/verify links on your own domain:** by default the email
links land on Firebase's hosted page. To use `reset-password.html` instead (it
already handles both link types), set the custom action URL to
`https://yourdomain/reset-password.html` under **Authentication → Templates**.

**Migrating an account created before Firebase:** sign up again with the same
email. The server links the new Firebase account to the existing record by
email address, so the plan, tier and progress are preserved — and because
Firebase requires the email to be verified first, only the mailbox owner can do
this.

## 5. Deploy to Vercel

The app is built for Vercel: `api/index.js` runs the Express app as a
serverless function, `vercel.json` points every `/api/*` request at it, and
everything in `public/` is served straight from Vercel's CDN.

Three things had to change for this to work, because Vercel gives a function no
disk and no memory between requests:

- **The database is Firebase**, not a JSON file. `server/data/store.js` talks to
  the Realtime Database. Vercel's filesystem is read-only, so the old
  `db.json` writes would have failed on every signup and approval.
- **Sessions are stored in Firebase** (`server/data/session-store.js`).
  express-session's default keeps them in memory, which a serverless instance
  loses between requests — users would appear randomly logged out.
- **Payment proof is a transaction ID**, not a screenshot upload. There is
  nowhere on Vercel to write an uploaded file. The admin matches the id against
  the real InstaPay/UPI/PayPal statement.

Steps:
1. Push this repo to GitHub.
2. On [vercel.com](https://vercel.com), import the repo. Leave the build
   settings alone — `vercel.json` covers it.
3. Add every variable from your `.env` under **Settings → Environment
   Variables**. `FIREBASE_SERVICE_ACCOUNT_JSON` must be the whole JSON on one
   line (no surrounding quotes needed in Vercel's UI). Never commit the real
   `.env`.
4. Deploy, then set `APP_URL` to the real deployed URL and redeploy.
5. **Add your Vercel domain to Firebase** → Authentication → Settings →
   **Authorized domains**. Miss this and the verification/reset emails fail with
   `auth/unauthorized-continue-uri`, because the link back to your site is
   rejected as an unknown domain. Add both `your-app.vercel.app` and any custom
   domain.

Render and Railway also still work (`npm start`), and don't need step 5's
caveat about the filesystem — but the app no longer depends on a disk either
way.

## Important honesty notes

- **The database is the Firebase Realtime Database.** `server/data/db.json` is
  no longer read or written — it's kept only as a backup of the pre-Firebase
  data. Everything still goes through `server/data/store.js`, so swapping to
  Postgres later would again be a one-file change.
- **Some list endpoints read a whole collection and filter in memory** (e.g.
  "all devices" to count each user's). That's fine at hundreds of users and
  keeps the admin hub to a couple of queries instead of one per row, but it is
  not how you'd query at tens of thousands. Add `.indexOn` rules (see below)
  and paginate before that becomes a problem.
- **Add these database rules for cheap lookups** — logging in queries users by
  email and Firebase uid, which without an index downloads the whole table:
  `"users": { ".indexOn": ["emailLower", "firebaseUid"] }`
- **Manual payment approval means a delay for the user** between paying and
  getting access — usually fine for a student-run app, but worth checking
  `/admin.html` regularly (daily, ideally) so people aren't left waiting.
- **Payment proof is now a transaction ID rather than a screenshot**, so
  approving a payment means checking that id against your real InstaPay / UPI /
  PayPal statement. You lose the at-a-glance visual confirmation the screenshot
  gave you; the id is shown in the admin hub next to each pending payment.
- **The admin panel's shared-secret key is a starting point, not a permanent
  security model.** For anything beyond early testing, replace it with a
  real admin login (a boolean `isAdmin` flag on a real logged-in user).
