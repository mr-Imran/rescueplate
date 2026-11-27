// Unit tests for the pure business rules and state machines (no database needed).
import { describe, expect, it } from 'vitest';
import {
  assessRouteSafety,
  checkListingTimes,
  decideAssign,
  decideCancelListing,
  decideClaim,
  decideDeleteListing,
  decideListingEdit,
  decidePickup,
  deriveListingStatus,
  estimateTravelMinutes,
  haversineKm,
  shouldRelease,
} from '../server/domain/rules.js';
import { assertTransition, canTransition, CLAIM_TRANSITIONS, LISTING_TRANSITIONS } from '../server/domain/stateMachine.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const mins = (n) => new Date(NOW.getTime() + n * 60_000);
const listing = (o = {}) => ({ status: 'POSTED', totalMeals: 40, remainingMeals: 40, preparedAt: mins(-30), safeUntil: mins(120), foodType: 'cooked_meal', isVeg: true, ...o });
const ngo = (o = {}) => ({ id: 'n1', type: 'ngo', status: 'VERIFIED', dailyCapacityMeals: 100, ...o });
const claimReq = (o = {}) => ({ listing: listing(), org: ngo(), now: NOW, requested: 20, allowPartial: true, capacityUsed: 0, hasOpenClaim: false, ...o });

describe('R1 food-safety window', () => {
  const base = { foodType: 'cooked_meal', preparedAt: mins(-30), safeUntil: mins(120), now: NOW, enforceLead: true };
  it('accepts a normal listing', () => expect(checkListingTimes(base)).toEqual({}));
  it('rejects safe-until before prepared', () => expect(checkListingTimes({ ...base, safeUntil: mins(-40) }).safeUntil).toMatch(/after the prepared/));
  it('rejects safe-until in the past', () => expect(checkListingTimes({ ...base, preparedAt: mins(-200), safeUntil: mins(-5) }).safeUntil).toMatch(/already passed/));
  it('rejects cooked food listed for more than 6 hours', () => expect(checkListingTimes({ ...base, safeUntil: mins(-30 + 6 * 60 + 1) }).safeUntil).toMatch(/at most 6 hours/));
  it('allows exactly 6 hours for cooked food (boundary)', () => expect(checkListingTimes({ ...base, safeUntil: mins(-30 + 6 * 60) })).toEqual({}));
  it('allows bakery items a longer window', () => expect(checkListingTimes({ ...base, foodType: 'bakery', safeUntil: mins(20 * 60) })).toEqual({}));
  it('rejects prepared time in the future', () => expect(checkListingTimes({ ...base, preparedAt: mins(30), safeUntil: mins(90) }).preparedAt).toMatch(/future/));
  it('requires 15 minutes of lead time for new listings only', () => {
    expect(checkListingTimes({ ...base, safeUntil: mins(10) }).safeUntil).toMatch(/at least 15 more minutes/);
    expect(checkListingTimes({ ...base, safeUntil: mins(10), enforceLead: false })).toEqual({});
  });
  it('rejects an unknown food type', () => expect(checkListingTimes({ ...base, foodType: 'mystery' }).foodType).toBeTruthy());
});

describe('listing status derivation', () => {
  const d = (o) => deriveListingStatus({ cancelled: false, totalMeals: 40, remainingMeals: 40, openClaims: 0, safeUntil: mins(60), now: NOW, ...o });
  it('POSTED when nothing is claimed', () => expect(d({})).toBe('POSTED'));
  it('PARTIALLY_CLAIMED when some meals remain', () => expect(d({ remainingMeals: 15, openClaims: 1 })).toBe('PARTIALLY_CLAIMED'));
  it('FULLY_CLAIMED when none remain but deliveries are pending', () => expect(d({ remainingMeals: 0, openClaims: 2 })).toBe('FULLY_CLAIMED'));
  it('COMPLETED when none remain and everything is delivered', () => expect(d({ remainingMeals: 0, openClaims: 0 })).toBe('COMPLETED'));
  it('EXPIRED when the deadline passes with meals left', () => expect(d({ remainingMeals: 5, safeUntil: mins(-1) })).toBe('EXPIRED'));
  it('EXPIRED exactly at the deadline (boundary)', () => expect(d({ safeUntil: NOW })).toBe('EXPIRED'));
  it('stays FULLY_CLAIMED past the deadline while food is in transit', () => expect(d({ remainingMeals: 0, openClaims: 1, safeUntil: mins(-1) })).toBe('FULLY_CLAIMED'));
  it('CANCELLED wins over everything', () => expect(d({ cancelled: true, remainingMeals: 0 })).toBe('CANCELLED'));
});

describe('claim decision (R2, R3, R4, R8, R9)', () => {
  it('grants the full request when stock and capacity allow', () => {
    expect(decideClaim(claimReq())).toMatchObject({ ok: true, granted: 20, partial: false, limitedBy: null });
  });
  it('R4: grants a partial claim when fewer meals remain', () => {
    const r = decideClaim(claimReq({ listing: listing({ remainingMeals: 15, status: 'PARTIALLY_CLAIMED' }) }));
    expect(r).toMatchObject({ ok: true, granted: 15, partial: true, limitedBy: 'stock' });
    expect(r.explanation).toMatch(/15 of 20/);
  });
  it('refuses a partial grant when the NGO asked for all-or-nothing', () => {
    const r = decideClaim(claimReq({ listing: listing({ remainingMeals: 15 }), allowPartial: false }));
    expect(r).toMatchObject({ ok: false, status: 409, code: 'INSUFFICIENT_MEALS' });
  });
  it('R2: caps the grant at remaining capacity', () => {
    expect(decideClaim(claimReq({ capacityUsed: 92 }))).toMatchObject({ ok: true, granted: 8, limitedBy: 'capacity' });
  });
  it('R2: rejects when capacity is exhausted', () => {
    expect(decideClaim(claimReq({ capacityUsed: 100 }))).toMatchObject({ ok: false, code: 'CAPACITY_REACHED' });
  });
  it('conflicting constraints: the tighter of stock and capacity wins', () => {
    const r = decideClaim(claimReq({ listing: listing({ remainingMeals: 12 }), capacityUsed: 95, requested: 50 }));
    expect(r).toMatchObject({ ok: true, granted: 5, limitedBy: 'capacity' });
  });
  it('R3: rejects sold-out, expired and cancelled listings', () => {
    expect(decideClaim(claimReq({ listing: listing({ remainingMeals: 0, status: 'FULLY_CLAIMED' }) })).code).toBe('SOLD_OUT');
    expect(decideClaim(claimReq({ listing: listing({ status: 'EXPIRED' }) })).code).toBe('LISTING_EXPIRED');
    expect(decideClaim(claimReq({ listing: listing({ status: 'CANCELLED' }) })).code).toBe('LISTING_CANCELLED');
  });
  it('R3: rejects by the clock even if the stored status is stale', () => {
    expect(decideClaim(claimReq({ listing: listing({ status: 'POSTED', safeUntil: mins(-1) }) })).code).toBe('LISTING_EXPIRED');
    expect(decideClaim(claimReq({ listing: listing({ safeUntil: NOW }) })).code).toBe('LISTING_EXPIRED');
  });
  it('R9: refuses a claim that would expire on the road', () => {
    // ~15 km apart in Dhaka → ~62 min travel+handoff; food only safe 40 more minutes.
    const r = decideClaim(
      claimReq({
        listing: listing({ safeUntil: mins(40), donor: { lat: 23.78, lng: 90.41 } }),
        org: ngo({ lat: 23.7, lng: 90.35 }),
        donorCoords: { lat: 23.78, lng: 90.41 },
        ngoCoords: { lat: 23.7, lng: 90.35 },
      }),
    );
    expect(r).toMatchObject({ ok: false, code: 'UNSAFE_ROUTE' });
    expect(r.message).toMatch(/expire on the road/i);
  });
  it('R9: allows a nearby kitchen while food still has time', () => {
    const r = decideClaim(
      claimReq({
        listing: listing({ safeUntil: mins(120), donor: { lat: 23.746, lng: 90.374 } }),
        org: ngo({ lat: 23.754, lng: 90.369 }),
        donorCoords: { lat: 23.746, lng: 90.374 },
        ngoCoords: { lat: 23.754, lng: 90.369 },
      }),
    );
    expect(r).toMatchObject({ ok: true, granted: 20 });
    expect(r.route.travelMinutes).toBeGreaterThan(0);
  });
  it('R8: rejects unverified and suspended organizations', () => {
    expect(decideClaim(claimReq({ org: ngo({ status: 'PENDING' }) }))).toMatchObject({ ok: false, status: 403, code: 'ORG_NOT_VERIFIED' });
    expect(decideClaim(claimReq({ org: ngo({ status: 'SUSPENDED' }) })).code).toBe('ORG_NOT_VERIFIED');
  });
  it('rejects a second open claim by the same NGO', () => {
    expect(decideClaim(claimReq({ hasOpenClaim: true })).code).toBe('ALREADY_CLAIMED');
  });
  it('rejects non-NGO organizations', () => {
    expect(decideClaim(claimReq({ org: ngo({ type: 'donor' }) })).status).toBe(403);
  });
});

describe('R9 route safety helpers', () => {
  it('computes distance and travel minutes', () => {
    const km = haversineKm({ lat: 23.746, lng: 90.374 }, { lat: 23.78, lng: 90.41 });
    expect(km).toBeGreaterThan(3);
    expect(estimateTravelMinutes(km)).toBeGreaterThan(12);
  });
  it('flags an impossible ETA', () => {
    const r = assessRouteSafety({
      donor: { lat: 23.7, lng: 90.3 },
      ngo: { lat: 23.9, lng: 90.5 },
      safeUntil: mins(20),
      now: NOW,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('UNSAFE_ROUTE');
  });
});

describe('listing edit rules', () => {
  const edit = (l, patch, hasClaimHistory = false) => decideListingEdit({ listing: l, patch, now: NOW, hasClaimHistory });
  it('recomputes remaining meals from the new total', () => {
    const r = edit(listing({ remainingMeals: 25, status: 'PARTIALLY_CLAIMED' }), { totalMeals: 60 }, true);
    expect(r).toMatchObject({ ok: true });
    expect(r.next.remainingMeals).toBe(45);
  });
  it('refuses a total below what is already claimed', () => {
    const r = edit(listing({ remainingMeals: 25 }), { totalMeals: 10 }, true);
    expect(r.details.fieldErrors.totalMeals).toMatch(/15 meals already claimed/);
  });
  it('allows a total exactly equal to the claimed amount (boundary)', () => {
    expect(edit(listing({ remainingMeals: 25 }), { totalMeals: 15 }, true).next.remainingMeals).toBe(0);
  });
  it('freezes food facts once something has been claimed', () => {
    const r = edit(listing({ remainingMeals: 25 }), { isVeg: false, foodType: 'bakery' }, true);
    expect(Object.keys(r.details.fieldErrors).sort()).toEqual(['foodType', 'isVeg']);
  });
  it('allows changing food facts before any claim', () => expect(edit(listing(), { isVeg: false }).ok).toBe(true));
  it('refuses edits to closed or expired listings', () => {
    expect(edit(listing({ status: 'CANCELLED' }), { title: 'x' }).code).toBe('LISTING_CLOSED');
    expect(edit(listing({ safeUntil: mins(-1) }), { title: 'x' }).code).toBe('LISTING_EXPIRED');
  });
  it('re-validates the safety window on edit', () => {
    expect(edit(listing(), { safeUntil: mins(8 * 60) }).details.fieldErrors.safeUntil).toMatch(/at most 6 hours/);
  });
});

describe('cancel, delete, pickup and release rules', () => {
  it('R7: a listing with open claims cannot be cancelled', () => {
    expect(decideCancelListing({ listing: listing({ status: 'PARTIALLY_CLAIMED' }), openClaims: 2 })).toMatchObject({ ok: false, code: 'HAS_OPEN_CLAIMS' });
    expect(decideCancelListing({ listing: listing(), openClaims: 0 }).ok).toBe(true);
    expect(decideCancelListing({ listing: listing({ status: 'CANCELLED' }), openClaims: 0 }).code).toBe('ALREADY_CANCELLED');
  });
  it('a listing with claim history cannot be deleted', () => {
    expect(decideDeleteListing({ claimCount: 1 }).code).toBe('HAS_HISTORY');
    expect(decideDeleteListing({ claimCount: 0 }).ok).toBe(true);
  });
  const vol = { id: 'v1', role: 'volunteer', status: 'ACTIVE' };
  it('assign: enforces state, deadline and volunteer workload', () => {
    const base = { claim: { status: 'CLAIMED' }, listing: listing(), volunteer: vol, volunteerActivePickups: 0, now: NOW };
    expect(decideAssign(base).ok).toBe(true);
    expect(decideAssign({ ...base, claim: { status: 'VOLUNTEER_ASSIGNED' } }).code).toBe('ALREADY_ASSIGNED');
    expect(decideAssign({ ...base, volunteerActivePickups: 2 }).code).toBe('VOLUNTEER_BUSY');
    expect(decideAssign({ ...base, listing: listing({ safeUntil: mins(-1) }) }).code).toBe('LISTING_EXPIRED');
    expect(decideAssign({ ...base, volunteer: { ...vol, role: 'ngo' } }).code).toBe('NOT_A_VOLUNTEER');
    expect(decideAssign({ ...base, volunteer: { ...vol, status: 'SUSPENDED' } }).code).toBe('VOLUNTEER_UNAVAILABLE');
  });
  it('R6: pickup needs the right volunteer, the right code and a safe time', () => {
    const base = { claim: { status: 'VOLUNTEER_ASSIGNED', handoverCode: '004200' }, listing: listing(), actorId: 'v1', pickup: { volunteerId: 'v1' }, code: '004200', now: NOW };
    expect(decidePickup(base).ok).toBe(true);
    expect(decidePickup({ ...base, code: '4200' }).code).toBe('WRONG_CODE');
    expect(decidePickup({ ...base, actorId: 'v2' }).status).toBe(403);
    expect(decidePickup({ ...base, listing: listing({ safeUntil: mins(-1) }) }).code).toBe('LISTING_EXPIRED');
    expect(decidePickup({ ...base, claim: { ...base.claim, status: 'CLAIMED' } }).code).toBe('INVALID_STATE');
  });
  it('R5: release only after 30 minutes without a volunteer', () => {
    const c = (minsAgo, status = 'CLAIMED') => ({ status, awaitingVolunteerSince: mins(-minsAgo) });
    expect(shouldRelease({ claim: c(29), listing: listing(), now: NOW })).toBe(false);
    expect(shouldRelease({ claim: c(30), listing: listing(), now: NOW })).toBe(true);
    expect(shouldRelease({ claim: c(45, 'VOLUNTEER_ASSIGNED'), listing: listing(), now: NOW })).toBe(false);
    expect(shouldRelease({ claim: c(45), listing: listing({ safeUntil: mins(-1) }), now: NOW })).toBe(false);
  });
});

describe('state machines', () => {
  it('allows the documented happy paths', () => {
    expect(canTransition('listing', 'POSTED', 'PARTIALLY_CLAIMED')).toBe(true);
    expect(canTransition('listing', 'FULLY_CLAIMED', 'COMPLETED')).toBe(true);
    expect(canTransition('claim', 'CLAIMED', 'VOLUNTEER_ASSIGNED')).toBe(true);
    expect(canTransition('claim', 'PICKED_UP', 'DELIVERED')).toBe(true);
  });
  it('terminal states have no exits', () => {
    for (const s of ['COMPLETED', 'EXPIRED', 'CANCELLED']) expect(LISTING_TRANSITIONS[s]).toEqual([]);
    for (const s of ['DELIVERED', 'RELEASED', 'CANCELLED', 'EXPIRED']) expect(CLAIM_TRANSITIONS[s]).toEqual([]);
  });
  it('throws on illegal jumps', () => {
    expect(() => assertTransition('claim', 'DELIVERED', 'CLAIMED')).toThrow(/Illegal claim transition/);
    expect(() => assertTransition('claim', 'CLAIMED', 'DELIVERED')).toThrow();
    expect(() => assertTransition('listing', 'EXPIRED', 'POSTED')).toThrow();
    expect(() => assertTransition('listing', 'POSTED', 'NOPE')).toThrow();
  });
  it('every transition target is a known state', () => {
    for (const machine of [LISTING_TRANSITIONS, CLAIM_TRANSITIONS]) {
      for (const targets of Object.values(machine)) for (const t of targets) expect(machine).toHaveProperty(t);
    }
  });
});
