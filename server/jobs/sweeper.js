// Background sweeper: applies the time-based rules.
//   - listings past their safe-until time with unclaimed meals -> EXPIRED
//   - open claims not collected before safe-until            -> EXPIRED (meals counted as wasted)
//   - claims with no volunteer after 30 minutes (R5)         -> RELEASED (meals return to the listing)
//
// Correctness never depends on when the sweeper runs: claim, pickup and edit
// all re-check the deadline themselves under a row lock. The sweeper only keeps
// stored statuses and the live feed up to date.
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { resetDemoIfIdle } from '../db/seed.js';
import { LIMITS } from '../domain/rules.js';
import { audit } from '../lib/audit.js';
import { appNow } from '../lib/clock.js';
import { expireClaimIfDue, releaseClaimIfDue } from '../services/claims.js';
import { listingAuditView, lockListing, refreshListing } from '../services/listingState.js';

async function expireListing(id) {
  return withTransaction(async (tx) => {
    const listing = await lockListing(tx, id);
    if (!listing || !['POSTED', 'PARTIALLY_CLAIMED'].includes(listing.status)) return false;
    const now = await appNow(tx);
    if (new Date(now).getTime() < new Date(listing.safeUntil).getTime()) return false; // re-checked under lock
    const updated = await refreshListing(tx, listing, { now });
    if (updated.status === listing.status) return false;
    await audit(tx, null, 'listing.expired', 'listing', id, {
      before: listingAuditView(listing),
      after: listingAuditView(updated),
      meta: { mealsWasted: updated.remainingMeals },
    });
    return true;
  });
}

/** Runs each due item in its own short transaction; one failure never blocks the rest. */
async function each(ids, fn, label, summary) {
  for (const id of ids) {
    try {
      if (await fn(id)) summary[label] += 1;
    } catch (err) {
      summary.errors += 1;
      console.error(`[sweeper] ${label} ${id} failed: ${err.message}`);
    }
  }
}

export async function sweepOnce() {
  const summary = { listingsExpired: 0, claimsExpired: 0, claimsReleased: 0, errors: 0 };

  const dueClaims = await query(
    `SELECT c.id FROM claims c JOIN listings l ON l.id = c.listing_id
      WHERE c.status IN ('CLAIMED', 'VOLUNTEER_ASSIGNED') AND l.safe_until <= app_now()
      ORDER BY l.safe_until LIMIT 200`,
  );
  await each(dueClaims.rows.map((r) => r.id), expireClaimIfDue, 'claimsExpired', summary);

  const dueListings = await query(
    `SELECT id FROM listings WHERE status IN ('POSTED', 'PARTIALLY_CLAIMED') AND safe_until <= app_now()
      ORDER BY safe_until LIMIT 200`,
  );
  await each(dueListings.rows.map((r) => r.id), expireListing, 'listingsExpired', summary);

  const dueReleases = await query(
    `SELECT c.id FROM claims c JOIN listings l ON l.id = c.listing_id
      WHERE c.status = 'CLAIMED' AND l.safe_until > app_now()
        AND c.awaiting_volunteer_since <= app_now() - make_interval(mins => $1)
      ORDER BY c.awaiting_volunteer_since LIMIT 200`,
    [LIMITS.RELEASE_AFTER_MINUTES],
  );
  await each(dueReleases.rows.map((r) => r.id), releaseClaimIfDue, 'claimsReleased', summary);

  return summary;
}

async function housekeeping() {
  await query(`DELETE FROM sessions WHERE expires_at < now() - interval '1 day'`);
  await query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`);
}

export function startSweeper() {
  let running = false;
  let ticks = 0;
  const timer = setInterval(async () => {
    if (running) return; // never overlap with a slow previous run
    running = true;
    try {
      // Safe with several app instances: every item is re-checked under its row
      // lock, so a second sweeper finds nothing left to do for it.
      await sweepOnce();
      const tick = ticks++;
      if (tick % 360 === 0) await housekeeping();
      // Demo mode: restore the sample data once nobody has changed anything for a while.
      if (config.demoMode && tick % 6 === 0 && (await resetDemoIfIdle(config.demoAutoResetMinutes))) {
        console.log(`[demo] no changes for ${config.demoAutoResetMinutes} minutes: sample data restored`);
      }
    } catch (err) {
      console.error('[sweeper] run failed (will retry):', err.message);
    } finally {
      running = false;
    }
  }, config.sweepIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
