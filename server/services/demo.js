// Demo console (admin only, demo mode only). Each action reproduces one of the
// judges' test scenarios on demand by calling the SAME service functions the
// normal API uses, concurrently, on separate database connections.
import crypto from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { RACE_NGO_KEYS, resetDemoData, seedId } from '../db/seed.js';
import { sweepOnce } from '../jobs/sweeper.js';
import { audit } from '../lib/audit.js';
import { getClockOffsetSeconds, setClockOffsetSeconds } from '../lib/clock.js';
import { findActor } from './actors.js';
import { cancelClaim, createClaim } from './claims.js';
import { cancelListing, createListing, updateListing } from './listings.js';
import { integrityCheck } from './stats.js';

const key = () => crypto.randomUUID();

async function demoListing(donor, title, totalMeals) {
  const stamp = new Date().toISOString().slice(11, 23);
  const appTime = Date.now() + (await getClockOffsetSeconds()) * 1000; // respect a fast-forwarded demo clock
  return createListing(donor, {
    title: `[Demo] ${title} ${stamp}`,
    description: 'Created by the demo console.',
    foodType: 'cooked_meal',
    isVeg: true,
    totalMeals,
    preparedAt: new Date(appTime - 10 * 60_000),
    safeUntil: new Date(appTime + 2 * 3600_000),
  });
}

async function listingLedger(listingId) {
  const { rows } = await query(
    `SELECT l.total_meals, l.remaining_meals, l.status, l.version,
            COALESCE((SELECT sum(meals)::int FROM claims WHERE listing_id = l.id
                       AND status IN ('CLAIMED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP', 'DELIVERED')), 0) AS held
       FROM listings l WHERE l.id = $1`,
    [listingId],
  );
  const r = rows[0];
  return {
    totalMeals: r.total_meals,
    remainingMeals: r.remaining_meals,
    mealsHeldByClaims: r.held,
    status: r.status,
    version: r.version,
    balanced: r.total_meals === r.remaining_meals + r.held,
    oversold: r.remaining_meals < 0 || r.held > r.total_meals,
  };
}

async function cleanup(donor, listingId, granted) {
  for (const g of granted) await cancelClaim(g.actor, g.claimId).catch(() => {});
  await cancelListing(donor, listingId, {}).catch(() => {});
}

/**
 * A05 test: several NGOs request the last meals at the same instant.
 * Every contender's claim runs as its own transaction on its own connection.
 */
export async function runRace({ meals, contenders, requestEach, keep }) {
  const donor = await findActor(seedId('user:donor'));
  const actors = await Promise.all(RACE_NGO_KEYS.slice(0, contenders).map((k) => findActor(seedId(`user:${k}`))));
  const listing = await demoListing(donor, 'Race for the last meals', meals);

  const started = Date.now();
  const settled = await Promise.allSettled(actors.map((a) => createClaim(a, listing.id, { meals: requestEach, allowPartial: true }, key())));
  const elapsedMs = Date.now() - started;

  const results = settled.map((s, i) => {
    const base = { ngo: actors[i].org.name, requested: requestEach };
    if (s.status === 'rejected') return { ...base, outcome: 'ERROR', granted: 0, detail: s.reason.message };
    const { status, body } = s.value;
    if (status === 201) {
      return { ...base, outcome: body.decision.partial ? 'PARTIAL' : 'GRANTED', granted: body.decision.granted, detail: body.decision.explanation, claimId: body.claim.id, actor: actors[i] };
    }
    return { ...base, outcome: body.error.code, granted: 0, detail: body.error.message };
  });
  const ledger = await listingLedger(listing.id);
  const totalGranted = results.reduce((s, r) => s + r.granted, 0);

  if (!keep) await cleanup(donor, listing.id, results.filter((r) => r.claimId));
  return {
    listingId: listing.id,
    kept: Boolean(keep),
    setup: { mealsAvailable: meals, contenders: actors.length, requestedEach: requestEach, totalRequested: actors.length * requestEach },
    results: results.map(({ actor, ...r }) => r),
    totalGranted,
    ledger,
    elapsedMs,
    // Pass = nothing oversold, and every meal is accounted for: granted + remaining = total.
    passed: !ledger.oversold && ledger.balanced && totalGranted + ledger.remainingMeals === meals,
  };
}

/** A05 test: the same claim request is sent several times with one Idempotency-Key. */
export async function runIdempotency({ copies }) {
  const donor = await findActor(seedId('user:donor'));
  const ngo = await findActor(seedId('user:womens'));
  const listing = await demoListing(donor, 'Duplicate request test', 30);
  const sameKey = key();

  const send = () => createClaim(ngo, listing.id, { meals: 10, allowPartial: true }, sameKey);
  const concurrent = await Promise.all(Array.from({ length: copies }, send));
  const late = await send(); // a retry that arrives after everything has finished
  const all = [...concurrent, late];

  const created = await query('SELECT count(*)::int AS n FROM claims WHERE listing_id = $1', [listing.id]);
  const ledger = await listingLedger(listing.id);
  const claimIds = new Set(all.map((r) => r.body.claim?.id));
  const result = {
    listingId: listing.id,
    requestsSent: all.length,
    responses: all.map((r, i) => ({ request: i + 1, status: r.status, replayed: r.replayed, claimId: r.body.claim?.id ?? null, late: i === all.length - 1 })),
    claimsCreated: created.rows[0].n,
    executedOnce: all.filter((r) => !r.replayed).length === 1,
    sameClaimReturned: claimIds.size === 1,
    ledger,
    passed: created.rows[0].n === 1 && ledger.remainingMeals === 20 && claimIds.size === 1,
  };
  await cleanup(donor, listing.id, [{ actor: ngo, claimId: all[0].body.claim.id }]);
  return result;
}

/** A01 test: two staff members save different edits based on the same version at the same instant. */
export async function runConflict() {
  const farhana = await findActor(seedId('user:donor'));
  const tanvir = await findActor(seedId('user:donor2'));
  const listing = await demoListing(farhana, 'Simultaneous edit test', 50);

  const attempt = (actor, totalMeals) =>
    updateListing(actor, listing.id, { expectedVersion: listing.version, totalMeals }).then(
      (updated) => ({ editor: actor.name, wanted: totalMeals, outcome: 'SAVED', newVersion: updated.version }),
      (err) => ({
        editor: actor.name,
        wanted: totalMeals,
        outcome: err.code || 'ERROR',
        message: err.message,
        serverVersion: err.details?.current?.version,
        serverTotalMeals: err.details?.current?.totalMeals,
        changedBy: err.details?.lastChange?.actor,
      }),
    );
  const results = await Promise.all([attempt(farhana, 45), attempt(tanvir, 60)]);
  const ledger = await listingLedger(listing.id);
  const saved = results.filter((r) => r.outcome === 'SAVED');
  const conflicts = results.filter((r) => r.outcome === 'VERSION_CONFLICT');
  const out = {
    listingId: listing.id,
    baseVersion: listing.version,
    results,
    final: { totalMeals: ledger.totalMeals, version: ledger.version },
    passed: saved.length === 1 && conflicts.length === 1 && ledger.totalMeals === saved[0].wanted && ledger.version === listing.version + 1,
  };
  await cleanup(farhana, listing.id, []);
  return out;
}

/** Moves the application clock and immediately applies the time-based rules. */
export async function advanceClock(actor, { minutes, reset }) {
  const seconds = await withTransaction(async (tx) => {
    const current = await getClockOffsetSeconds(tx);
    const next = reset ? 0 : current + minutes * 60;
    await setClockOffsetSeconds(tx, next);
    await audit(tx, actor, reset ? 'demo.clock_reset' : 'demo.clock_advanced', 'system', null, { before: { offsetSeconds: current }, after: { offsetSeconds: next } });
    tx.notify({ t: 'clock' });
    return next;
  });
  const sweep = await sweepOnce();
  return { clockOffsetSeconds: seconds, serverNow: new Date(Date.now() + seconds * 1000), sweep };
}

export async function resetDemo() {
  await resetDemoData();
  return { reset: true, integrity: await integrityCheck() };
}

export { integrityCheck };
