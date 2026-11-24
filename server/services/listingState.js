// Shared listing persistence helpers used by the listing, claim and sweeper services.
import { query } from '../db/pool.js';
import { deriveListingStatus } from '../domain/rules.js';
import { assertTransition, CLAIM_OPEN } from '../domain/stateMachine.js';

export const LISTING_SELECT = `
  SELECT l.id, l.donor_org_id, l.title, l.description, l.food_type, l.is_veg,
         l.total_meals, l.remaining_meals, l.prepared_at, l.safe_until, l.status,
         l.version, l.created_at, l.updated_at,
         o.name AS donor_name, o.address AS donor_address, o.lat AS donor_lat, o.lng AS donor_lng
    FROM listings l
    JOIN organizations o ON o.id = l.donor_org_id`;

/** Database row -> the listing shape used by the API and by realtime events. */
export function toListing(r) {
  return {
    id: r.id,
    donorOrgId: r.donor_org_id,
    title: r.title,
    description: r.description,
    foodType: r.food_type,
    isVeg: r.is_veg,
    totalMeals: r.total_meals,
    remainingMeals: r.remaining_meals,
    preparedAt: r.prepared_at,
    safeUntil: r.safe_until,
    status: r.status,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    donor: { id: r.donor_org_id, name: r.donor_name, address: r.donor_address, lat: r.donor_lat, lng: r.donor_lng },
    ...(r.distance_km !== undefined ? { distanceKm: r.distance_km === null ? null : Math.round(r.distance_km * 10) / 10 } : {}),
  };
}

export async function getListing(id, db = { query }) {
  const { rows } = await db.query(`${LISTING_SELECT} WHERE l.id = $1`, [id]);
  return rows[0] ? toListing(rows[0]) : null;
}

/**
 * Reads a listing and takes a row lock on it (SELECT ... FOR UPDATE) until the
 * transaction ends. Every operation that changes a listing's meal count starts
 * here, so concurrent claims, edits, cancellations and the sweeper are
 * serialized per listing. Global lock order: listing -> organization -> claim -> user.
 */
export async function lockListing(tx, id) {
  const { rows } = await tx.query(`${LISTING_SELECT} WHERE l.id = $1 FOR UPDATE OF l`, [id]);
  return rows[0] ? toListing(rows[0]) : null;
}

export async function countOpenClaims(tx, listingId) {
  const { rows } = await tx.query('SELECT count(*)::int AS n FROM claims WHERE listing_id = $1 AND status = ANY($2)', [listingId, CLAIM_OPEN]);
  return rows[0].n;
}

/**
 * Recomputes a locked listing's status from its numbers, persists any change
 * with a version bump, and queues the realtime event. Returns the new listing.
 */
export async function refreshListing(tx, listing, { remainingMeals = listing.remainingMeals, now, cancelled = listing.status === 'CANCELLED', fields = {} }) {
  const totalMeals = fields.totalMeals ?? listing.totalMeals;
  const safeUntil = fields.safeUntil ?? listing.safeUntil;
  const openClaims = await countOpenClaims(tx, listing.id);
  const status = deriveListingStatus({ cancelled, totalMeals, remainingMeals, openClaims, safeUntil, now });
  assertTransition('listing', listing.status, status);

  const next = { ...listing, ...fields, remainingMeals, status };
  const changed =
    status !== listing.status ||
    remainingMeals !== listing.remainingMeals ||
    Object.keys(fields).some((k) => !sameValue(fields[k], listing[k]));
  if (!changed) return listing;

  const { rows } = await tx.query(
    `UPDATE listings
        SET title = $2, description = $3, food_type = $4, is_veg = $5, total_meals = $6,
            remaining_meals = $7, prepared_at = $8, safe_until = $9, status = $10,
            version = version + 1, updated_at = app_now()
      WHERE id = $1 AND version = $11
      RETURNING version, updated_at`,
    [next.id, next.title, next.description, next.foodType, next.isVeg, next.totalMeals, next.remainingMeals, next.preparedAt, next.safeUntil, next.status, listing.version],
  );
  // Cannot happen while we hold the row lock; guards against future code that forgets to lock.
  if (rows.length === 0) throw new Error(`Listing ${listing.id} changed without a lock`);
  tx.notify({ t: 'listing', id: listing.id });
  return { ...next, version: rows[0].version, updatedAt: rows[0].updated_at };
}

export function sameValue(a, b) {
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return a === b;
}

/** Compact snapshot stored in the audit log. */
export function listingAuditView(l) {
  return {
    title: l.title,
    description: l.description,
    foodType: l.foodType,
    isVeg: l.isVeg,
    totalMeals: l.totalMeals,
    remainingMeals: l.remainingMeals,
    preparedAt: l.preparedAt,
    safeUntil: l.safeUntil,
    status: l.status,
    version: l.version,
  };
}
