// Business rules as pure functions: no database, no HTTP, no clock access.
// Services load the facts (under row locks), call a decide*() function and
// apply the result. That keeps every rule unit-testable and explainable.
import { LISTING_TERMINAL } from './stateMachine.js';

export const FOOD_TYPES = {
  cooked_meal: { label: 'Cooked meal', maxSafeHours: 6 },
  dairy: { label: 'Dairy', maxSafeHours: 6 },
  bakery: { label: 'Bakery', maxSafeHours: 24 },
  produce: { label: 'Fresh produce', maxSafeHours: 48 },
  beverages: { label: 'Beverages', maxSafeHours: 48 },
  packaged: { label: 'Packaged food', maxSafeHours: 72 },
};

export const LIMITS = {
  MIN_LEAD_MINUTES: 15, //        a new listing must stay safe at least this long, or nobody can collect it
  RELEASE_AFTER_MINUTES: 30, //   a claim with no volunteer is released after this long
  CAPACITY_WINDOW_HOURS: 24, //   NGO capacity is measured over a rolling 24 hours
  MAX_ACTIVE_PICKUPS: 2, //       pickups one volunteer may carry at a time
  MAX_MEALS: 5000,
  CLOCK_SKEW_MINUTES: 5, //       tolerance for "prepared at" slightly in the future
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ok = (extra = {}) => ({ ok: true, ...extra });
const reject = (status, code, message, details) => ({ ok: false, status, code, message, ...(details ? { details } : {}) });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * R1 - food-safety window. Returns a map of field -> message (empty when valid).
 * `enforceLead` applies only when a listing is first posted.
 */
export function checkListingTimes({ foodType, preparedAt, safeUntil, now, enforceLead }) {
  const errors = {};
  const type = FOOD_TYPES[foodType];
  if (!type) return { foodType: 'Choose a food type from the list.' };
  const prepared = new Date(preparedAt).getTime();
  const safe = new Date(safeUntil).getTime();
  const t = new Date(now).getTime();

  if (prepared > t + LIMITS.CLOCK_SKEW_MINUTES * MINUTE) {
    errors.preparedAt = 'Prepared time cannot be in the future.';
  }
  if (safe <= prepared) {
    errors.safeUntil = 'Safe-until time must be after the prepared time.';
  } else if (safe - prepared > type.maxSafeHours * HOUR) {
    errors.safeUntil = `${type.label} can be listed for at most ${type.maxSafeHours} hours after it was prepared.`;
  } else if (safe <= t) {
    errors.safeUntil = 'Safe-until time has already passed.';
  } else if (enforceLead && safe - t < LIMITS.MIN_LEAD_MINUTES * MINUTE) {
    errors.safeUntil = `Food must stay safe for at least ${LIMITS.MIN_LEAD_MINUTES} more minutes so it can be collected.`;
  }
  return errors;
}

/**
 * Single source of truth for a listing's status, derived from its numbers.
 * Invariant maintained everywhere: remaining = total - meals held by CLAIMED,
 * VOLUNTEER_ASSIGNED, PICKED_UP and DELIVERED claims.
 */
export function deriveListingStatus({ cancelled, totalMeals, remainingMeals, openClaims, safeUntil, now }) {
  if (cancelled) return 'CANCELLED';
  const pastDeadline = new Date(now).getTime() >= new Date(safeUntil).getTime();
  if (remainingMeals === 0) return openClaims > 0 ? 'FULLY_CLAIMED' : 'COMPLETED';
  if (pastDeadline) return 'EXPIRED';
  return remainingMeals === totalMeals ? 'POSTED' : 'PARTIALLY_CLAIMED';
}

/**
 * R2, R3, R4, R8 - decides a claim request. Called with the listing and the
 * NGO rows locked, so the answer cannot be invalidated by a concurrent claim.
 */
export function decideClaim({ listing, org, now, requested, allowPartial, capacityUsed, hasOpenClaim }) {
  if (!org || org.type !== 'ngo') {
    return reject(403, 'FORBIDDEN', 'Only NGO accounts can claim food.');
  }
  if (org.status !== 'VERIFIED') {
    return reject(403, 'ORG_NOT_VERIFIED', 'Your organization must be verified by an admin before it can claim food.');
  }
  if (listing.status === 'CANCELLED') {
    return reject(409, 'LISTING_CANCELLED', 'The donor has withdrawn this listing.');
  }
  if (listing.status === 'EXPIRED' || new Date(now).getTime() >= new Date(listing.safeUntil).getTime()) {
    return reject(409, 'LISTING_EXPIRED', 'This food has passed its safe-until time and can no longer be claimed.');
  }
  if (hasOpenClaim) {
    return reject(409, 'ALREADY_CLAIMED', 'Your organization already has an open claim on this listing.');
  }
  if (listing.remainingMeals <= 0) {
    return reject(409, 'SOLD_OUT', 'All meals on this listing have already been claimed.');
  }
  const capacityLeft = Math.max(0, org.dailyCapacityMeals - capacityUsed);
  if (capacityLeft <= 0) {
    return reject(
      409,
      'CAPACITY_REACHED',
      `Your organization has reached its capacity of ${plural(org.dailyCapacityMeals, 'meal')} per ${LIMITS.CAPACITY_WINDOW_HOURS} hours.`,
      { dailyCapacityMeals: org.dailyCapacityMeals, capacityUsed, capacityLeft: 0 },
    );
  }

  const granted = Math.min(requested, listing.remainingMeals, capacityLeft);
  const limitedBy = granted === requested ? null : listing.remainingMeals <= capacityLeft ? 'stock' : 'capacity';
  if (granted < requested && !allowPartial) {
    return reject(
      409,
      'INSUFFICIENT_MEALS',
      limitedBy === 'stock'
        ? `Only ${plural(listing.remainingMeals, 'meal')} left, and you asked for all ${requested} or nothing.`
        : `Your remaining capacity is ${plural(capacityLeft, 'meal')}, and you asked for all ${requested} or nothing.`,
      { available: granted, limitedBy },
    );
  }

  const explanation =
    limitedBy === 'stock'
      ? `Granted ${granted} of ${requested} requested: only ${plural(listing.remainingMeals, 'meal')} were left.`
      : limitedBy === 'capacity'
        ? `Granted ${granted} of ${requested} requested: your organization had capacity for ${plural(capacityLeft, 'more meal')} in this ${LIMITS.CAPACITY_WINDOW_HOURS}-hour window.`
        : `Granted all ${plural(granted, 'meal')} requested.`;

  return ok({ granted, partial: granted < requested, limitedBy, explanation, capacityLeftAfter: capacityLeft - granted });
}

/** Rules for a donor editing a listing. `claimedMeals` = total - remaining. */
export function decideListingEdit({ listing, patch, now, hasClaimHistory }) {
  if (LISTING_TERMINAL.includes(listing.status)) {
    return reject(409, 'LISTING_CLOSED', `This listing is ${listing.status.toLowerCase()} and can no longer be edited.`);
  }
  if (new Date(now).getTime() >= new Date(listing.safeUntil).getTime()) {
    return reject(409, 'LISTING_EXPIRED', 'This listing has passed its safe-until time and can no longer be edited.');
  }
  const next = { ...listing, ...patch };
  const claimedMeals = listing.totalMeals - listing.remainingMeals;
  const fieldErrors = {};

  // Facts an NGO relied on when claiming are frozen once anything has been claimed.
  if (hasClaimHistory) {
    const frozenMsg = 'This cannot be changed after food has been claimed.';
    if (next.foodType !== listing.foodType) fieldErrors.foodType = frozenMsg;
    if (next.isVeg !== listing.isVeg) fieldErrors.isVeg = frozenMsg;
    if (new Date(next.preparedAt).getTime() !== new Date(listing.preparedAt).getTime()) fieldErrors.preparedAt = frozenMsg;
  }
  if (next.totalMeals < claimedMeals) {
    fieldErrors.totalMeals = `${plural(claimedMeals, 'meal')} already claimed, so the total cannot go below ${claimedMeals}.`;
  }
  const timeErrors = checkListingTimes({ foodType: next.foodType, preparedAt: next.preparedAt, safeUntil: next.safeUntil, now, enforceLead: false });
  for (const [field, message] of Object.entries(timeErrors)) fieldErrors[field] ??= message;
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: 'Please correct the highlighted fields.', details: { fieldErrors } };
  }
  return ok({ next: { ...next, remainingMeals: next.totalMeals - claimedMeals } });
}

/** R7 - a donor may withdraw a listing only while nobody is relying on it. */
export function decideCancelListing({ listing, openClaims }) {
  if (listing.status === 'CANCELLED') return reject(409, 'ALREADY_CANCELLED', 'This listing is already cancelled.');
  if (LISTING_TERMINAL.includes(listing.status)) {
    return reject(409, 'LISTING_CLOSED', `This listing is ${listing.status.toLowerCase()} and cannot be cancelled.`);
  }
  if (openClaims > 0) {
    return reject(409, 'HAS_OPEN_CLAIMS', `${plural(openClaims, 'NGO claim')} still open on this listing. It cannot be cancelled until they are delivered or withdrawn.`, {
      openClaims,
    });
  }
  return ok();
}

/** A listing can be permanently deleted only if it never had a claim (history must be preserved). */
export function decideDeleteListing({ claimCount }) {
  if (claimCount > 0) {
    return reject(409, 'HAS_HISTORY', 'This listing has claim history and cannot be deleted. Cancel it instead.', { claimCount });
  }
  return ok();
}

const pastDeadline = (listing, now) => new Date(now).getTime() >= new Date(listing.safeUntil).getTime();

/** Assigning a volunteer (by the NGO) or a volunteer accepting an open pickup. */
export function decideAssign({ claim, listing, volunteer, volunteerActivePickups, now }) {
  if (claim.status === 'VOLUNTEER_ASSIGNED' || claim.status === 'PICKED_UP') {
    return reject(409, 'ALREADY_ASSIGNED', 'A volunteer has already taken this pickup.');
  }
  if (claim.status !== 'CLAIMED') {
    return reject(409, 'CLAIM_CLOSED', `This claim is ${claim.status.toLowerCase()} and no longer needs a volunteer.`);
  }
  if (pastDeadline(listing, now)) {
    return reject(409, 'LISTING_EXPIRED', 'This food has passed its safe-until time and can no longer be collected.');
  }
  if (!volunteer || volunteer.role !== 'volunteer') return reject(400, 'NOT_A_VOLUNTEER', 'Choose a volunteer account.');
  if (volunteer.status !== 'ACTIVE') return reject(409, 'VOLUNTEER_UNAVAILABLE', 'This volunteer account is suspended.');
  if (volunteerActivePickups >= LIMITS.MAX_ACTIVE_PICKUPS) {
    return reject(409, 'VOLUNTEER_BUSY', `A volunteer can carry at most ${LIMITS.MAX_ACTIVE_PICKUPS} pickups at a time.`, {
      activePickups: volunteerActivePickups,
    });
  }
  return ok();
}

/** R6 - food may not be collected after its safe-until time; handover needs the donor's code. */
export function decidePickup({ claim, listing, actorId, pickup, code, now }) {
  if (claim.status !== 'VOLUNTEER_ASSIGNED') {
    return reject(409, 'INVALID_STATE', `This pickup cannot be collected because the claim is ${claim.status.toLowerCase().replace('_', ' ')}.`);
  }
  if (!pickup || pickup.volunteerId !== actorId) {
    return reject(403, 'FORBIDDEN', 'Only the assigned volunteer can collect this pickup.');
  }
  if (pastDeadline(listing, now)) {
    return reject(409, 'LISTING_EXPIRED', 'This food has passed its safe-until time. For safety it can no longer be collected.');
  }
  if (String(code) !== String(claim.handoverCode)) {
    return reject(400, 'WRONG_CODE', 'That handover code is not correct. Ask the donor to read it out again.');
  }
  return ok();
}

export function decideDeliver({ claim }) {
  if (claim.status === 'DELIVERED') return reject(409, 'ALREADY_DELIVERED', 'This delivery was already confirmed.');
  if (claim.status !== 'PICKED_UP') {
    return reject(409, 'INVALID_STATE', 'Food must be collected from the donor before delivery can be confirmed.');
  }
  return ok();
}

export function decideUnassign({ claim }) {
  if (claim.status !== 'VOLUNTEER_ASSIGNED') {
    return reject(409, 'INVALID_STATE', 'A volunteer can only be removed before the food has been collected.');
  }
  return ok();
}

export function decideCancelClaim({ claim }) {
  if (claim.status === 'CANCELLED') return reject(409, 'ALREADY_CANCELLED', 'This claim is already cancelled.');
  if (claim.status !== 'CLAIMED' && claim.status !== 'VOLUNTEER_ASSIGNED') {
    return reject(409, 'INVALID_STATE', `A claim that is ${claim.status.toLowerCase().replace('_', ' ')} cannot be cancelled.`);
  }
  return ok();
}

/** R5 - should the sweeper release this claim back to the listing? */
export function shouldRelease({ claim, listing, now }) {
  if (claim.status !== 'CLAIMED' || !claim.awaitingVolunteerSince) return false;
  if (pastDeadline(listing, now)) return false; // expiry handles it instead
  const waited = new Date(now).getTime() - new Date(claim.awaitingVolunteerSince).getTime();
  return waited >= LIMITS.RELEASE_AFTER_MINUTES * MINUTE;
}
