// Per-dialect entitlements.
//
// A purchase belongs to the DIALECT it was made in and stays parked there.
// Buying Advanced for Egyptian does not hand out Advanced in Hejazi; switching
// to Hejazi gives Hejazi's baseline, and switching back to Egyptian restores
// exactly what was paid for. Nothing is ever forfeited by switching.
//
// Shape on the user record:
//
//   user.dialect          — the dialect they are currently in
//   user.entitlements     — { eg: {…}, hejazi: {…}, khaleeji: {…} }
//   user.tier, user.planId, user.planActivatedAt,
//   user.planExpiresAt, user.subStatus
//                         — a PROJECTION of entitlements[user.dialect]
//
// The flat fields are kept deliberately. Every existing reader — the app's tier
// sync, the admin tables, the plans page, the access checks — already reads
// them, so projecting means none of that code has to know entitlements exist.
// The map is the source of truth; the flat fields are the active view of it.

const { DIALECTS, normaliseDialect, baselineTier, configForDialect } = require('./plans');

// The fields that make up one dialect's purchase state.
const FIELDS = ['tier', 'planId', 'planActivatedAt', 'planExpiresAt', 'subStatus'];

// Read the whole map, seeding it from the legacy flat fields the first time an
// account is touched. This is the migration: accounts that predate per-dialect
// entitlements keep precisely the access they already paid for, parked on the
// dialect they were using (Egyptian for everyone who signed up before dialects
// existed, which is all 115 of them).
function readAll(user) {
  const out = {};
  const existing = (user && user.entitlements) || {};
  DIALECTS.forEach((d) => { if (existing[d]) out[d] = Object.assign({}, existing[d]); });

  const home = normaliseDialect(user && user.dialect);
  if (!out[home]) {
    const seeded = {};
    FIELDS.forEach((f) => {
      if (user && user[f] !== undefined && user[f] !== null) seeded[f] = user[f];
    });
    // Only seed when there is something worth keeping. A brand-new account with
    // no tier yet should not get an empty entitlement written for it.
    if (Object.keys(seeded).length) out[home] = seeded;
  }
  return out;
}

// Lifetime is the one plan that is NOT parked on the dialect it was bought in.
//
// Every other plan stays where it was purchased — buying Advanced for Egyptian
// grants nothing in Hejazi — because each dialect is sold separately. Lifetime
// is sold as the opposite of that: one payment covering every dialect, and any
// dialect added later. So holding it anywhere means holding it everywhere.
//
// Finding it is a scan of the entitlement map rather than a flag on the
// account, which means it needs no migration and cannot fall out of step: the
// two students who already own Lifetime are recognised by the record they
// already have.
function lifetimeEntitlement(user) {
  const all = readAll(user);
  const found = Object.keys(all).find(d => all[d] && all[d].tier === 'lifetime');
  return found ? all[found] : null;
}

// What this user is entitled to in one dialect. A dialect they have never
// bought in returns that dialect's baseline and nothing else — no plan, no
// expiry, no carried-over tier. The single exception is Lifetime, above.
function forDialect(user, dialect, siteConfig) {
  const d = normaliseDialect(dialect);
  const all = readAll(user);

  // Lifetime is checked BEFORE this dialect's own record, and that ordering
  // matters. A student who owns Lifetime and has since visited another dialect
  // already has an 'explorer' entry sitting there from that visit; returning it
  // would lock a lifetime owner out of the very dialects their payment was
  // meant to cover. Both of the existing Lifetime accounts were in exactly that
  // position. Lifetime therefore outranks whatever a dialect happens to hold.
  const life = lifetimeEntitlement(user);
  if (life) {
    return {
      tier: 'lifetime',
      planId: life.planId || 'lifetime',
      planActivatedAt: life.planActivatedAt || null,
      planExpiresAt: null,        // lifetime never expires, in any dialect
      subStatus: life.subStatus || 'active',
    };
  }

  if (all[d] && all[d].tier) return Object.assign({}, all[d]);

  return {
    tier: baselineTier(configForDialect(siteConfig, d)),
    planId: null,
    planActivatedAt: null,
    planExpiresAt: null,
    subStatus: null,
  };
}

// The patch that makes `dialect` the active one: the flat fields become that
// dialect's entitlement, and the map is written back so the seed persists.
function switchTo(user, dialect, siteConfig) {
  const d = normaliseDialect(dialect);
  const all = readAll(user);
  const ent = forDialect(user, d, siteConfig);
  const patch = { dialect: d, entitlements: all };
  FIELDS.forEach((f) => { patch[f] = ent[f] === undefined ? null : ent[f]; });
  return patch;
}

// The patch that records a purchase (or an admin plan change) against one
// dialect. If that dialect is the one the user is currently in, the flat fields
// move with it; if not, the purchase is parked and takes effect when they
// switch to it.
function grant(user, dialect, ent, siteConfig) {
  const d = normaliseDialect(dialect);
  const all = readAll(user);
  all[d] = {};
  FIELDS.forEach((f) => { all[d][f] = ent[f] === undefined ? null : ent[f]; });

  const patch = { entitlements: all };
  if (normaliseDialect(user && user.dialect) === d) {
    FIELDS.forEach((f) => { patch[f] = all[d][f]; });
  }
  return patch;
}

module.exports = { FIELDS, readAll, forDialect, switchTo, grant, lifetimeEntitlement };
