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
  rejected — each with the payment screenshot, method, plan, and user.
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
  server/
    index.js              Express server entrypoint
    routes/auth.js         signup / login / logout / current-user
    routes/plans.js         serves the plan list/prices to the frontend
    routes/manual-payments.js   generic manual-payment router (shared by PayPal + InstaPay + UPI)
    routes/paypal.js          PayPal-specific config on top of manual-payments.js
    routes/instapay.js        InstaPay-specific config on top of manual-payments.js
    routes/upi.js              UPI-specific config on top of manual-payments.js
    routes/admin.js            combined "all pending proofs, any method" listing for admin.html
    data/store.js          tiny JSON-file database (users, manual payment proofs)
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

Everything works immediately with placeholder values — signup/login and
all three manual-payment flows (PayPal, InstaPay, UPI) work out of the box,
since none of them need external API keys. Just fill in your real payment
details (step 2 below) before going live so users see correct information.

## 2. Set up your payment details (no business registration needed)

All three payment methods work the same way: you show the user where to
send money, they upload a screenshot of the payment, and you approve it
from `/admin.html`, which instantly activates their plan. None of this
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

## 5. Deploy

Recommended: [Render](https://render.com) or [Railway](https://railway.app) —
both deploy directly from a GitHub repo with almost no configuration, and
have an always-on free/cheap tier.

Steps are the same on either:
1. Push this project to a GitHub repo.
2. Create a new Web Service pointing at that repo.
3. Set the same environment variables from `.env` in their dashboard's
   "Environment" section (never commit your real `.env` to git).
4. Set the start command to `npm start`.
5. Once deployed, update `APP_URL` in your environment variables to your
   real domain.

## Important honesty notes

- **This uses a JSON file as a database** (`server/data/db.json`), which is
  fine for getting started and testing, but isn't safe for concurrent
  production traffic at scale. Before real launch with meaningful volume,
  migrate `server/data/store.js` to a real database (Postgres is a solid,
  common choice) — the rest of the code calls only the functions exported
  from that file, so the migration is contained to one file.
- **Manual payment approval means a delay for the user** between paying and
  getting access — usually fine for a student-run app, but worth checking
  `/admin.html` regularly (daily, ideally) so people aren't left waiting.
- **I could not run `npm install` or start this server in my sandbox**
  (no internet access there), so while every file is syntax-checked and the
  core business logic (user creation, tier upgrades, and each payment
  method's approve/reject flow) was verified with direct logic tests, I
  have not seen it running end-to-end with the real Express packages or a
  real browser session. Please run `npm install && npm start` yourself and
  try the flows — if anything breaks, send me the exact error and I'll fix
  it immediately.
- **The admin panel's shared-secret key is a starting point, not a permanent
  security model.** For anything beyond early testing, replace it with a
  real admin login (a boolean `isAdmin` flag on a real logged-in user).
