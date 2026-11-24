import { query, withTransaction } from '../db/pool.js';
import { checkListingTimes, decideCancelListing, decideDeleteListing, decideListingEdit } from '../domain/rules.js';
import { CLAIM_HOLDING, CLAIM_OPEN } from '../domain/stateMachine.js';
import { audit } from '../lib/audit.js';
import { appNow } from '../lib/clock.js';
import { AppError, conflict, forbidden, notFound, validationError } from '../lib/errors.js';
import { getListing, listingAuditView, LISTING_SELECT, lockListing, refreshListing, sameValue, toListing } from './listingState.js';

const HAVERSINE_KM = (lat, lng) => `
  (6371 * 2 * asin(sqrt(
     power(sin(radians(o.lat - ${lat}) / 2), 2) +
     cos(radians(${lat})) * cos(radians(o.lat)) * power(sin(radians(o.lng - ${lng}) / 2), 2))))`;

// Sort keys are mapped to fixed SQL fragments; user input never reaches ORDER BY.
const SORTS = {
  expiry: 'l.safe_until',
  meals: 'l.remaining_meals',
  newest: 'l.created_at',
  distance: 'distance_km',
};

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Search, filter, sort and paginate listings, plus aggregates over the whole filtered set. */
export async function listListings(viewer, f) {
  const where = [];
  const params = [];
  const p = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  // Distance is measured from explicit coordinates, else from the viewer's organization.
  const origin = f.lat !== undefined && f.lng !== undefined ? { lat: f.lat, lng: f.lng } : viewer.org ? { lat: viewer.org.lat, lng: viewer.org.lng } : null;
  const distanceSql = origin ? HAVERSINE_KM(p(origin.lat), p(origin.lng)) : 'NULL::double precision';

  if (f.q) {
    const like = p(`%${escapeLike(f.q)}%`);
    where.push(`(l.title ILIKE ${like} OR l.description ILIKE ${like} OR o.name ILIKE ${like} OR o.address ILIKE ${like})`);
  }
  if (f.foodType) where.push(`l.food_type = ${p(f.foodType)}`);
  if (f.veg === 'veg') where.push('l.is_veg = true');
  if (f.veg === 'nonveg') where.push('l.is_veg = false');
  if (f.status === 'available') {
    where.push(`l.status IN ('POSTED', 'PARTIALLY_CLAIMED') AND l.safe_until > app_now()`);
  } else if (f.status && f.status !== 'all') {
    where.push(`l.status = ${p(f.status)}`);
  }
  if (f.minMeals) where.push(`l.remaining_meals >= ${p(f.minMeals)}`);
  if (f.withinMinutes) where.push(`l.safe_until <= app_now() + make_interval(mins => ${p(f.withinMinutes)})`);
  if (f.mine) {
    if (!viewer.orgId || viewer.role !== 'donor') throw forbidden('Only donor accounts have their own listings.');
    where.push(`l.donor_org_id = ${p(viewer.orgId)}`);
  }
  if (f.maxKm && origin) where.push(`${distanceSql} <= ${p(f.maxKm)}`);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortKey = f.sort === 'distance' && !origin ? 'expiry' : f.sort;
  const orderSql = `${SORTS[sortKey]} ${f.order === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, l.id`;

  // One filtered set, queried twice: aggregates over all matches, then the requested page.
  const baseSql = `${LISTING_SELECT.replace('FROM listings l', `, ${distanceSql} AS distance_km FROM listings l`)} ${whereSql}`;
  const totals = await query(
    `SELECT count(*)::int AS total,
            COALESCE(sum(sub.remaining_meals), 0)::int AS meals_available,
            count(DISTINCT sub.donor_org_id)::int AS donors
       FROM (${baseSql}) sub`,
    [...params],
  );
  const page = await query(
    `SELECT sub.* FROM (${baseSql}) sub
     ORDER BY ${orderSql.replaceAll('l.', 'sub.')}
     LIMIT ${p(f.pageSize)} OFFSET ${p((f.page - 1) * f.pageSize)}`,
    params,
  );
  const t = totals.rows[0];
  return {
    items: page.rows.map(toListing),
    page: f.page,
    pageSize: f.pageSize,
    total: t.total,
    totalPages: Math.max(1, Math.ceil(t.total / f.pageSize)),
    summary: { mealsAvailable: t.meals_available, donors: t.donors },
    distanceFrom: origin ? (f.lat !== undefined ? 'your location' : viewer.org.name) : null,
    sort: sortKey,
  };
}

/** One listing, with the extra detail the viewer is entitled to. */
export async function getListingDetail(viewer, id) {
  const listing = await getListing(id);
  if (!listing) throw notFound('Listing');
  const isOwner = viewer.role === 'donor' && viewer.orgId === listing.donorOrgId;
  const result = { listing, canEdit: isOwner };

  if (viewer.role === 'ngo') {
    const mine = await query(
      `SELECT id, meals, status, created_at FROM claims WHERE listing_id = $1 AND ngo_org_id = $2 ORDER BY created_at DESC LIMIT 5`,
      [id, viewer.orgId],
    );
    result.myClaims = mine.rows.map((r) => ({ id: r.id, meals: r.meals, status: r.status, createdAt: r.created_at }));
  }
  if (isOwner || viewer.role === 'admin') {
    const history = await query(
      `SELECT id, actor_label, action, created_at, meta FROM audit_log WHERE ${LISTING_AUDIT_WHERE} ORDER BY id DESC LIMIT 20`,
      [id],
    );
    result.history = history.rows.map((r) => ({ id: r.id, actor: r.actor_label, action: r.action, at: r.created_at, meta: r.meta }));
  }
  return result;
}

export async function createListing(actor, input) {
  return withTransaction(async (tx) => {
    const now = await appNow(tx);
    const fieldErrors = checkListingTimes({ ...input, now, enforceLead: true });
    if (Object.keys(fieldErrors).length > 0) throw validationError(fieldErrors);

    // Duplicate-post protection: serialize posts per organization, then look for an
    // identical open listing (same title and prepared time). A double-submitted
    // form therefore creates one listing, never two.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`post:${actor.orgId}`]);
    const dup = await tx.query(
      `SELECT id FROM listings
        WHERE donor_org_id = $1 AND lower(title) = lower($2) AND prepared_at = $3
          AND status IN ('POSTED', 'PARTIALLY_CLAIMED', 'FULLY_CLAIMED')`,
      [actor.orgId, input.title, input.preparedAt],
    );
    if (dup.rowCount > 0) {
      throw conflict('DUPLICATE_LISTING', 'This listing was already posted. Open the existing one instead of posting it again.', {
        existingId: dup.rows[0].id,
      });
    }

    const { rows } = await tx.query(
      `INSERT INTO listings (donor_org_id, created_by, title, description, food_type, is_veg,
                             total_meals, remaining_meals, prepared_at, safe_until, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $10) RETURNING id`,
      [actor.orgId, actor.id, input.title, input.description, input.foodType, input.isVeg, input.totalMeals, input.preparedAt, input.safeUntil, now],
    );
    const listing = await getListing(rows[0].id, tx);
    await audit(tx, actor, 'listing.created', 'listing', listing.id, { after: listingAuditView(listing) });
    tx.notify({ t: 'listing', id: listing.id, created: true });
    return listing;
  });
}

// Audit entries about a listing: its own edits plus the claim events that changed its meal count.
const LISTING_AUDIT_WHERE = `
  ((entity_type = 'listing' AND entity_id = $1) OR
   (entity_type = 'claim' AND entity_id IN (SELECT id FROM claims WHERE listing_id = $1)
      AND action IN ('claim.created', 'claim.cancelled', 'claim.released', 'claim.expired', 'claim.delivered')))`;

/** Who last changed this listing, for the conflict message. */
async function lastChange(tx, listingId) {
  const { rows } = await tx.query(
    `SELECT actor_label, action, created_at FROM audit_log WHERE ${LISTING_AUDIT_WHERE} ORDER BY id DESC LIMIT 1`,
    [listingId],
  );
  return rows[0] ? { actor: rows[0].actor_label, action: rows[0].action, at: rows[0].created_at } : null;
}

function assertOwner(actor, listing) {
  if (actor.role !== 'donor' || actor.orgId !== listing.donorOrgId) {
    throw forbidden("This listing belongs to another organization. You can't change it.", 'NOT_OWNER');
  }
}

async function assertVersion(tx, listing, expectedVersion) {
  if (listing.version === expectedVersion) return;
  // Optimistic-concurrency conflict: the caller edited a copy that is no longer current.
  // Nothing is written; the latest data goes back so the client can merge.
  throw conflict('VERSION_CONFLICT', 'This listing was changed by someone else while you were editing. Review the latest version.', {
    current: listing,
    yourVersion: expectedVersion,
    lastChange: await lastChange(tx, listing.id),
  });
}

export async function updateListing(actor, id, { expectedVersion, ...patch }) {
  return withTransaction(async (tx) => {
    const listing = await lockListing(tx, id);
    if (!listing) throw notFound('Listing');
    assertOwner(actor, listing); // ownership first: non-owners must not even learn the current data
    await assertVersion(tx, listing, expectedVersion);

    const changedKeys = Object.keys(patch).filter((k) => !sameValue(patch[k], listing[k]));
    if (changedKeys.length === 0) return listing; // nothing to do; do not bump the version

    const now = await appNow(tx);
    const history = await tx.query('SELECT 1 FROM claims WHERE listing_id = $1 AND status = ANY($2) LIMIT 1', [id, CLAIM_HOLDING]);
    const decision = decideListingEdit({ listing, patch, now, hasClaimHistory: history.rowCount > 0 });
    if (!decision.ok) throw new AppError(decision.status, decision.code, decision.message, decision.details);

    const fields = Object.fromEntries(changedKeys.map((k) => [k, decision.next[k]]));
    const updated = await refreshListing(tx, listing, { remainingMeals: decision.next.remainingMeals, now, fields });
    await audit(tx, actor, 'listing.updated', 'listing', id, {
      before: listingAuditView(listing),
      after: listingAuditView(updated),
      meta: { changed: changedKeys },
    });
    return updated;
  });
}

export async function cancelListing(actor, id, { expectedVersion }) {
  return withTransaction(async (tx) => {
    const listing = await lockListing(tx, id);
    if (!listing) throw notFound('Listing');
    assertOwner(actor, listing);
    if (expectedVersion !== undefined) await assertVersion(tx, listing, expectedVersion);

    const open = await tx.query('SELECT count(*)::int AS n FROM claims WHERE listing_id = $1 AND status = ANY($2)', [id, CLAIM_OPEN]);
    const decision = decideCancelListing({ listing, openClaims: open.rows[0].n });
    if (!decision.ok) throw new AppError(decision.status, decision.code, decision.message, decision.details);

    const updated = await refreshListing(tx, listing, { now: await appNow(tx), cancelled: true });
    await audit(tx, actor, 'listing.cancelled', 'listing', id, { before: listingAuditView(listing), after: listingAuditView(updated) });
    return updated;
  });
}

export async function deleteListing(actor, id) {
  return withTransaction(async (tx) => {
    const listing = await lockListing(tx, id);
    if (!listing) throw notFound('Listing');
    assertOwner(actor, listing);
    const claims = await tx.query('SELECT count(*)::int AS n FROM claims WHERE listing_id = $1', [id]);
    const decision = decideDeleteListing({ claimCount: claims.rows[0].n });
    if (!decision.ok) throw new AppError(decision.status, decision.code, decision.message, decision.details);

    await tx.query('DELETE FROM listings WHERE id = $1', [id]);
    await audit(tx, actor, 'listing.deleted', 'listing', id, { before: listingAuditView(listing) });
    tx.notify({ t: 'listing', id, deleted: true });
    return { deleted: true };
  });
}
