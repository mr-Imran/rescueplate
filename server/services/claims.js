import crypto from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import {
  decideAssign,
  decideCancelClaim,
  decideClaim,
  decideDeliver,
  decidePickup,
  decideUnassign,
  LIMITS,
  shouldRelease,
} from '../domain/rules.js';
import { assertTransition, CLAIM_HOLDING, CLAIM_OPEN } from '../domain/stateMachine.js';
import { audit } from '../lib/audit.js';
import { appNow } from '../lib/clock.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { beginIdempotent, completeIdempotent, hashRequest } from './idempotency.js';
import { lockListing, refreshListing } from './listingState.js';

const CLAIM_SELECT = `
  SELECT c.id, c.status, c.meals, c.handover_code, c.awaiting_volunteer_since,
         c.created_at, c.updated_at, c.closed_at, c.listing_id, c.ngo_org_id,
         l.title AS listing_title, l.food_type, l.is_veg, l.safe_until, l.status AS listing_status,
         l.donor_org_id,
         d.name AS donor_name, d.address AS donor_address, d.lat AS donor_lat, d.lng AS donor_lng,
         n.name AS ngo_name, n.address AS ngo_address, n.lat AS ngo_lat, n.lng AS ngo_lng,
         p.id AS pickup_id, p.volunteer_id, p.status AS pickup_status,
         p.assigned_at, p.picked_up_at, p.delivered_at, v.name AS volunteer_name
    FROM claims c
    JOIN listings l ON l.id = c.listing_id
    JOIN organizations d ON d.id = l.donor_org_id
    JOIN organizations n ON n.id = c.ngo_org_id
    LEFT JOIN LATERAL (
      SELECT * FROM pickups pk
       WHERE pk.claim_id = c.id AND pk.status IN ('ASSIGNED', 'PICKED_UP', 'DELIVERED')
       ORDER BY pk.assigned_at DESC LIMIT 1
    ) p ON true
    LEFT JOIN users v ON v.id = p.volunteer_id`;

const MINUTE = 60_000;

/** Row -> API shape. The handover code is revealed only to the donor's staff (and admins). */
function toClaim(r, viewer) {
  const seesCode = viewer && (viewer.role === 'admin' || (viewer.role === 'donor' && viewer.orgId === r.donor_org_id));
  const awaiting = r.status === 'CLAIMED' && r.awaiting_volunteer_since;
  return {
    id: r.id,
    status: r.status,
    meals: r.meals,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    closedAt: r.closed_at,
    releaseAt: awaiting ? new Date(new Date(r.awaiting_volunteer_since).getTime() + LIMITS.RELEASE_AFTER_MINUTES * MINUTE) : null,
    listing: { id: r.listing_id, title: r.listing_title, foodType: r.food_type, isVeg: r.is_veg, safeUntil: r.safe_until, status: r.listing_status },
    donor: { id: r.donor_org_id, name: r.donor_name, address: r.donor_address, lat: r.donor_lat, lng: r.donor_lng },
    ngo: { id: r.ngo_org_id, name: r.ngo_name, address: r.ngo_address, lat: r.ngo_lat, lng: r.ngo_lng },
    volunteer: r.volunteer_id ? { id: r.volunteer_id, name: r.volunteer_name } : null,
    assignedAt: r.assigned_at,
    pickedUpAt: r.picked_up_at,
    deliveredAt: r.delivered_at,
    ...(seesCode && (r.status === 'CLAIMED' || r.status === 'VOLUNTEER_ASSIGNED') ? { handoverCode: r.handover_code } : {}),
  };
}

async function getClaimView(db, id, viewer) {
  const { rows } = await db.query(`${CLAIM_SELECT} WHERE c.id = $1`, [id]);
  return rows[0] ? toClaim(rows[0], viewer) : null;
}

/** Queues the realtime event for a claim, addressed only to the parties involved. */
function notifyClaim(tx, claim, listing, volunteerIds = [], { board = false } = {}) {
  tx.notify({
    t: 'claim',
    id: claim.id,
    listingId: listing.id,
    ngoOrgId: claim.ngoOrgId,
    donorOrgId: listing.donorOrgId,
    volunteerIds: volunteerIds.filter(Boolean),
    board,
  });
}

/* ------------------------------------------------------------------ */
/* Creating a claim (advanced challenge A05)                           */
/* ------------------------------------------------------------------ */

/**
 * Claims meals from a listing. Returns { status, body, replayed }.
 *
 * One transaction does all of this, or none of it:
 *   1. register the Idempotency-Key (replays return the stored response)
 *   2. lock the listing row, then the NGO row            <- serializes competing claims
 *   3. evaluate the rules against the locked, current data
 *   4. decrement remaining meals, insert the claim, bump the version
 *   5. write the audit record, store the response under the key
 *   6. queue realtime events (delivered only on commit)
 *
 * Rule rejections (sold out, expired, capacity...) are also committed under
 * the key, so a retry of a rejected request gets the same answer.
 */
export async function createClaim(actor, listingId, { meals, allowPartial }, idempotencyKey) {
  const idem = { userId: actor.id, scope: 'claim.create', key: idempotencyKey };
  const requestHash = hashRequest({ listingId, meals, allowPartial });

  return withTransaction(async (tx) => {
    const seen = await beginIdempotent(tx, { ...idem, requestHash });
    if (!seen.fresh) return { status: seen.status, body: seen.body, replayed: true };

    const finish = async (status, body) => {
      await completeIdempotent(tx, idem, status, body);
      return { status, body, replayed: false };
    };
    const rejected = (d) => finish(d.status, { error: { code: d.code, message: d.message, ...(d.details ? { details: d.details } : {}) } });

    // Lock order: listing first, then organization. Every code path uses the same order, so no deadlocks.
    const listing = await lockListing(tx, listingId);
    if (!listing) return rejected({ status: 404, code: 'NOT_FOUND', message: 'Listing was not found.' });

    const orgRes = await tx.query('SELECT id, type, status, daily_capacity_meals, lat, lng FROM organizations WHERE id = $1 FOR UPDATE', [actor.orgId]);
    const o = orgRes.rows[0];
    const org = o ? { id: o.id, type: o.type, status: o.status, dailyCapacityMeals: o.daily_capacity_meals, lat: o.lat, lng: o.lng } : null;

    // Read the clock AFTER acquiring the locks: if we waited behind another claim, time has moved on.
    const now = await appNow(tx);
    const used = await tx.query(
      `SELECT COALESCE(sum(meals), 0)::int AS used FROM claims
        WHERE ngo_org_id = $1 AND status = ANY($2) AND created_at > $3::timestamptz - make_interval(hours => $4)`,
      [actor.orgId, CLAIM_HOLDING, now, LIMITS.CAPACITY_WINDOW_HOURS],
    );
    const open = await tx.query('SELECT 1 FROM claims WHERE listing_id = $1 AND ngo_org_id = $2 AND status = ANY($3)', [listingId, actor.orgId, CLAIM_OPEN]);

    const decision = decideClaim({
      listing,
      org,
      now,
      requested: meals,
      allowPartial,
      capacityUsed: used.rows[0].used,
      hasOpenClaim: open.rowCount > 0,
      donorCoords: listing.donor,
      ngoCoords: org ? { lat: org.lat, lng: org.lng } : null,
    });
    if (!decision.ok) return rejected(decision);

    const handoverCode = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const inserted = await tx.query(
      `INSERT INTO claims (listing_id, ngo_org_id, claimed_by, meals, handover_code, awaiting_volunteer_since, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $6) RETURNING id`,
      [listingId, actor.orgId, actor.id, decision.granted, handoverCode, now],
    );
    const claimId = inserted.rows[0].id;
    const updated = await refreshListing(tx, listing, { remainingMeals: listing.remainingMeals - decision.granted, now });

    await audit(tx, actor, 'claim.created', 'claim', claimId, {
      after: { listingId, meals: decision.granted, status: 'CLAIMED' },
      meta: { requested: meals, granted: decision.granted, limitedBy: decision.limitedBy, remainingAfter: updated.remainingMeals },
    });
    notifyClaim(tx, { id: claimId, ngoOrgId: actor.orgId }, listing, [], { board: true });

    return finish(201, {
      claim: await getClaimView(tx, claimId, actor),
      listing: updated,
      decision: {
        requested: meals,
        granted: decision.granted,
        partial: decision.partial,
        limitedBy: decision.limitedBy,
        explanation: decision.explanation,
        capacityLeft: decision.capacityLeftAfter,
        route: decision.route,
      },
    });
  });
}

/* ------------------------------------------------------------------ */
/* Claim lifecycle                                                     */
/* ------------------------------------------------------------------ */

/** Loads a claim with its listing locked first (global lock order), then the claim row. */
async function lockClaim(tx, claimId) {
  const pre = await tx.query('SELECT listing_id FROM claims WHERE id = $1', [claimId]);
  if (pre.rowCount === 0) throw notFound('Claim');
  const listing = await lockListing(tx, pre.rows[0].listing_id);
  const { rows } = await tx.query('SELECT * FROM claims WHERE id = $1 FOR UPDATE', [claimId]);
  const c = rows[0];
  const claim = {
    id: c.id,
    listingId: c.listing_id,
    ngoOrgId: c.ngo_org_id,
    meals: c.meals,
    status: c.status,
    handoverCode: c.handover_code,
    awaitingVolunteerSince: c.awaiting_volunteer_since,
  };
  // The claim's current pickup (abandoned and voided attempts are history, not current).
  const live = await tx.query(
    `SELECT id, volunteer_id, status FROM pickups
      WHERE claim_id = $1 AND status IN ('ASSIGNED', 'PICKED_UP', 'DELIVERED') ORDER BY assigned_at DESC LIMIT 1`,
    [claimId],
  );
  const pickup = live.rows[0] ? { id: live.rows[0].id, volunteerId: live.rows[0].volunteer_id, status: live.rows[0].status } : null;
  return { listing, claim, pickup, now: await appNow(tx) };
}

async function setClaimStatus(tx, claim, to, now, { awaiting = null, close = false } = {}) {
  assertTransition('claim', claim.status, to);
  await tx.query(
    `UPDATE claims SET status = $2, awaiting_volunteer_since = $3, updated_at = $4,
            closed_at = CASE WHEN $5 THEN $4 ELSE closed_at END
      WHERE id = $1`,
    [claim.id, to, awaiting, now, close],
  );
}

const fail = (d) => new AppError(d.status, d.code, d.message, d.details);
const isNgoOwner = (actor, claim) => actor.role === 'ngo' && actor.orgId === claim.ngoOrgId;

/**
 * Assigns a volunteer. Called by the claiming NGO (any volunteer) or by a
 * volunteer accepting an open pickup (themselves only). Two volunteers racing
 * for the same pickup are serialized by the row locks; the loser gets
 * ALREADY_ASSIGNED, and a partial unique index backs that up in the database.
 */
export async function assignVolunteer(actor, claimId, volunteerId) {
  return withTransaction(async (tx) => {
    const { listing, claim, now } = await lockClaim(tx, claimId);
    const selfAccept = actor.role === 'volunteer' && volunteerId === actor.id;
    if (!selfAccept && !isNgoOwner(actor, claim)) {
      throw forbidden('Only the NGO that made this claim can assign its volunteer.', 'NOT_OWNER');
    }
    // Lock the volunteer row so their active-pickup count cannot change under us.
    const vol = await tx.query('SELECT id, name, role, status FROM users WHERE id = $1 FOR UPDATE', [volunteerId]);
    const active = await tx.query(`SELECT count(*)::int AS n FROM pickups WHERE volunteer_id = $1 AND status IN ('ASSIGNED', 'PICKED_UP')`, [volunteerId]);
    const decision = decideAssign({ claim, listing, volunteer: vol.rows[0], volunteerActivePickups: active.rows[0].n, now });
    if (!decision.ok) throw fail(decision);

    await tx.query('INSERT INTO pickups (claim_id, volunteer_id, assigned_by, assigned_at) VALUES ($1, $2, $3, $4)', [claimId, volunteerId, actor.id, now]);
    await setClaimStatus(tx, claim, 'VOLUNTEER_ASSIGNED', now);
    await audit(tx, actor, selfAccept ? 'pickup.accepted' : 'pickup.assigned', 'claim', claimId, {
      before: { status: claim.status },
      after: { status: 'VOLUNTEER_ASSIGNED', volunteer: vol.rows[0].name },
    });
    notifyClaim(tx, claim, listing, [volunteerId], { board: true });
    return getClaimView(tx, claimId, actor);
  });
}

/** Removes the volunteer before collection (by the volunteer or the NGO). The claim waits for a new one. */
export async function unassignVolunteer(actor, claimId) {
  return withTransaction(async (tx) => {
    const { listing, claim, pickup, now } = await lockClaim(tx, claimId);
    const isAssignee = actor.role === 'volunteer' && pickup?.volunteerId === actor.id;
    if (!isAssignee && !isNgoOwner(actor, claim)) throw forbidden('Only the assigned volunteer or the claiming NGO can do this.', 'NOT_OWNER');
    const decision = decideUnassign({ claim });
    if (!decision.ok) throw fail(decision);

    await tx.query(`UPDATE pickups SET status = 'ABANDONED', closed_at = $2 WHERE id = $1`, [pickup.id, now]);
    await setClaimStatus(tx, claim, 'CLAIMED', now, { awaiting: now }); // the 30-minute release timer restarts
    await audit(tx, actor, 'pickup.unassigned', 'claim', claimId, { before: { status: claim.status }, after: { status: 'CLAIMED' } });
    notifyClaim(tx, claim, listing, [pickup.volunteerId], { board: true });
    return getClaimView(tx, claimId, actor);
  });
}

/** The volunteer collects the food. Requires the donor's handover code and must be before safe-until (R6). */
export async function confirmPickup(actor, claimId, code) {
  return withTransaction(async (tx) => {
    const { listing, claim, pickup, now } = await lockClaim(tx, claimId);
    const decision = decidePickup({ claim, listing, actorId: actor.id, pickup, code, now });
    if (!decision.ok) throw fail(decision);

    await tx.query(`UPDATE pickups SET status = 'PICKED_UP', picked_up_at = $2 WHERE id = $1`, [pickup.id, now]);
    await setClaimStatus(tx, claim, 'PICKED_UP', now);
    await audit(tx, actor, 'pickup.collected', 'claim', claimId, { before: { status: claim.status }, after: { status: 'PICKED_UP' } });
    notifyClaim(tx, claim, listing, [pickup.volunteerId]);
    return getClaimView(tx, claimId, actor);
  });
}

/** Delivery confirmed by the assigned volunteer or by the receiving NGO. May complete the listing. */
export async function confirmDelivery(actor, claimId) {
  return withTransaction(async (tx) => {
    const { listing, claim, pickup, now } = await lockClaim(tx, claimId);
    const isAssignee = actor.role === 'volunteer' && pickup?.volunteerId === actor.id;
    if (!isAssignee && !isNgoOwner(actor, claim)) throw forbidden('Only the assigned volunteer or the receiving NGO can confirm delivery.', 'NOT_OWNER');
    const decision = decideDeliver({ claim });
    if (!decision.ok) throw fail(decision);

    await tx.query(`UPDATE pickups SET status = 'DELIVERED', delivered_at = $2, closed_at = $2 WHERE id = $1`, [pickup.id, now]);
    await setClaimStatus(tx, claim, 'DELIVERED', now, { close: true });
    await refreshListing(tx, listing, { now }); // FULLY_CLAIMED -> COMPLETED once the last claim is delivered
    await audit(tx, actor, 'claim.delivered', 'claim', claimId, { before: { status: claim.status }, after: { status: 'DELIVERED', meals: claim.meals } });
    notifyClaim(tx, claim, listing, [pickup.volunteerId]);
    return getClaimView(tx, claimId, actor);
  });
}

/**
 * Closes an open claim and returns its meals to the listing, atomically.
 * Used for: NGO cancellation, automatic release (R5) and expiry (R6).
 * `actor` is null when the sweeper does it.
 */
async function closeAndReturn(tx, actor, { listing, claim, pickup, now }, to, action) {
  if (pickup) await tx.query(`UPDATE pickups SET status = 'VOIDED', closed_at = $2 WHERE id = $1`, [pickup.id, now]);
  await setClaimStatus(tx, claim, to, now, { close: true });
  const updated = await refreshListing(tx, listing, { remainingMeals: listing.remainingMeals + claim.meals, now });
  await audit(tx, actor, action, 'claim', claim.id, {
    before: { status: claim.status },
    after: { status: to },
    meta: { mealsReturned: claim.meals, listingStatus: updated.status, remainingAfter: updated.remainingMeals },
  });
  notifyClaim(tx, claim, listing, [pickup?.volunteerId], { board: true });
}

export async function cancelClaim(actor, claimId) {
  return withTransaction(async (tx) => {
    const ctx = await lockClaim(tx, claimId);
    if (!isNgoOwner(actor, ctx.claim)) throw forbidden('Only the NGO that made this claim can cancel it.', 'NOT_OWNER');
    const decision = decideCancelClaim({ claim: ctx.claim });
    if (!decision.ok) throw fail(decision);
    await closeAndReturn(tx, actor, ctx, 'CANCELLED', 'claim.cancelled');
    return getClaimView(tx, claimId, actor);
  });
}

/** Sweeper: R5 - release a claim that found no volunteer in time. Re-checks everything under lock. */
export async function releaseClaimIfDue(claimId) {
  return withTransaction(async (tx) => {
    const ctx = await lockClaim(tx, claimId);
    if (!shouldRelease(ctx)) return false;
    await closeAndReturn(tx, null, ctx, 'RELEASED', 'claim.released');
    return true;
  });
}

/** Sweeper: a claim not collected before the food-safety deadline expires; its meals count as wasted. */
export async function expireClaimIfDue(claimId) {
  return withTransaction(async (tx) => {
    const ctx = await lockClaim(tx, claimId);
    const open = ctx.claim.status === 'CLAIMED' || ctx.claim.status === 'VOLUNTEER_ASSIGNED';
    if (!open || new Date(ctx.now).getTime() < new Date(ctx.listing.safeUntil).getTime()) return false;
    await closeAndReturn(tx, null, ctx, 'EXPIRED', 'claim.expired');
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

const STATE_GROUPS = {
  open: CLAIM_OPEN,
  closed: ['DELIVERED', 'RELEASED', 'CANCELLED', 'EXPIRED'],
};

/** Claims visible to the viewer: resource isolation is part of the query itself. */
export async function listClaims(viewer, { state = 'all', listingId } = {}) {
  const where = [];
  const params = [];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (viewer.role === 'ngo') where.push(`c.ngo_org_id = ${p(viewer.orgId)}`);
  else if (viewer.role === 'donor') where.push(`l.donor_org_id = ${p(viewer.orgId)}`);
  else if (viewer.role === 'volunteer') where.push(`p.volunteer_id = ${p(viewer.id)}`);
  else if (viewer.role !== 'admin') throw forbidden();

  if (STATE_GROUPS[state]) where.push(`c.status = ANY(${p(STATE_GROUPS[state])})`);
  if (listingId) where.push(`c.listing_id = ${p(listingId)}`);

  const { rows } = await query(
    `${CLAIM_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY (c.status = ANY('{CLAIMED,VOLUNTEER_ASSIGNED,PICKED_UP}')) DESC, l.safe_until DESC, c.created_at DESC
     LIMIT 200`,
    params,
  );
  return rows.map((r) => toClaim(r, viewer));
}

/** Claims waiting for a volunteer, most urgent first (the volunteers' job board). */
export async function listOpenPickups(viewer) {
  const { rows } = await query(
    `${CLAIM_SELECT}
      WHERE c.status = 'CLAIMED' AND l.safe_until > app_now()
      ORDER BY l.safe_until ASC LIMIT 100`,
  );
  return rows.map((r) => toClaim(r, viewer));
}

export async function listVolunteers() {
  const { rows } = await query(
    `SELECT u.id, u.name,
            (SELECT count(*)::int FROM pickups pk WHERE pk.volunteer_id = u.id AND pk.status IN ('ASSIGNED', 'PICKED_UP')) AS active_pickups,
            (SELECT count(*)::int FROM pickups pk WHERE pk.volunteer_id = u.id AND pk.status = 'DELIVERED') AS deliveries
       FROM users u WHERE u.role = 'volunteer' AND u.status = 'ACTIVE' ORDER BY active_pickups, u.name`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    activePickups: r.active_pickups,
    deliveries: r.deliveries,
    available: r.active_pickups < LIMITS.MAX_ACTIVE_PICKUPS,
  }));
}
