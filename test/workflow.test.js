// M01 (end-to-end workflow across modules) and M04 (state transitions, time-based rules).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sweepOnce } from '../server/jobs/sweeper.js';
import { integrityCheck } from '../server/services/stats.js';
import { claim, dbListing, postListing, query, seedId, startTestServer } from './helpers.js';

let s;
let donor;
let ngo;
let ngo2;
let volunteer;
let admin;
beforeAll(async () => {
  s = await startTestServer();
  [donor, ngo, ngo2, volunteer, admin] = await Promise.all(['donor', 'ngo', 'ngo2', 'volunteer3', 'admin'].map((p) => s.as(p)));
  // These tests make many claims as the same two NGOs; capacity limits are covered elsewhere.
  await query(`UPDATE organizations SET daily_capacity_meals = 100000 WHERE type = 'ngo'`);
});
afterAll(() => s.close());

const dbClaim = async (id) => (await query('SELECT * FROM claims WHERE id = $1', [id])).rows[0];
const codeFor = async (claimId) => (await donor.get('/claims')).body.items.find((c) => c.id === claimId).handoverCode;
const advance = (minutes) => admin.post('/admin/demo/clock', { minutes });
const resetClock = () => admin.post('/admin/demo/clock', { reset: true });

describe('end-to-end: donor posts -> NGO claims -> volunteer delivers -> dashboard updates', () => {
  it('runs the whole workflow across all four modules', async () => {
    const before = (await ngo.get('/stats/impact?days=1')).body.totals;

    // 1. Listings module
    const listing = await postListing(donor, { title: 'End-to-end trays', totalMeals: 50 });
    expect((await ngo.get('/listings?q=End-to-end')).body.items[0].id).toBe(listing.id);

    // 2. Claims module (two NGOs share the listing)
    const c1 = await claim(ngo, listing.id, 30);
    const c2 = await claim(ngo2, listing.id, 30); // only 20 left -> partial grant
    expect(c1.body.decision).toMatchObject({ granted: 30, partial: false });
    expect(c2.body.decision).toMatchObject({ granted: 20, partial: true, limitedBy: 'stock' });
    expect(c2.body.listing).toMatchObject({ remainingMeals: 0, status: 'FULLY_CLAIMED' });

    // 3. Pickups module
    const id = c1.body.claim.id;
    const open = (await volunteer.get('/pickups/open')).body.items;
    expect(open.map((p) => p.id)).toContain(id);
    expect((await volunteer.post(`/claims/${id}/accept`)).body.claim.status).toBe('VOLUNTEER_ASSIGNED');
    expect((await volunteer.post(`/claims/${id}/deliver`)).body.error.code).toBe('INVALID_STATE'); // cannot skip pickup

    const wrong = await volunteer.post(`/claims/${id}/pickup`, { handoverCode: '000000' === (await codeFor(id)) ? '111111' : '000000' });
    expect([wrong.status, wrong.body.error.code]).toEqual([400, 'WRONG_CODE']);
    expect((await dbClaim(id)).status).toBe('VOLUNTEER_ASSIGNED');

    const picked = await volunteer.post(`/claims/${id}/pickup`, { handoverCode: await codeFor(id) });
    expect(picked.body.claim.status).toBe('PICKED_UP');
    expect((await ngo.post(`/claims/${id}/cancel`)).body.error.code).toBe('INVALID_STATE'); // too late to cancel
    expect((await volunteer.post(`/claims/${id}/deliver`)).body.claim.status).toBe('DELIVERED');
    expect((await volunteer.post(`/claims/${id}/deliver`)).body.error.code).toBe('ALREADY_DELIVERED'); // duplicate action

    // Second claim: assigned by the NGO, delivered and confirmed by the NGO.
    const id2 = c2.body.claim.id;
    const volunteers = (await ngo2.get('/volunteers')).body.items;
    expect(volunteers.find((v) => v.id === seedId('user:volunteer3')).available).toBe(true);
    await ngo2.post(`/claims/${id2}/assign`, { volunteerId: seedId('user:volunteer3') });
    await volunteer.post(`/claims/${id2}/pickup`, { handoverCode: await codeFor(id2) });
    expect((await dbListing(listing.id)).status).toBe('FULLY_CLAIMED');
    expect((await ngo2.post(`/claims/${id2}/deliver`)).body.claim.status).toBe('DELIVERED');
    expect((await dbListing(listing.id)).status).toBe('COMPLETED'); // last delivery completes the listing

    // 4. Impact dashboard reflects it immediately
    const after = (await ngo.get('/stats/impact?days=1')).body.totals;
    expect(after.mealsRescued - before.mealsRescued).toBe(50);
    expect(after.deliveries - before.deliveries).toBe(2);

    // The audit trail tells the whole story, in order.
    const trail = (await query(`SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY id`, [id])).rows.map((r) => r.action);
    expect(trail).toEqual(['claim.created', 'pickup.accepted', 'pickup.collected', 'claim.delivered']);
    expect((await admin.get('/admin/audit?entityType=claim&pageSize=5')).body.items.length).toBe(5);
  });

  it('a volunteer can carry at most two pickups, and can hand one back', async () => {
    const listing = await postListing(donor, { totalMeals: 60 });
    const v = await s.as('volunteer');
    // Sam (seed data) already carries one pickup.
    const a = (await claim(ngo, listing.id, 10)).body.claim.id;
    const b = (await claim(ngo2, listing.id, 10)).body.claim.id;
    expect((await v.post(`/claims/${a}/accept`)).status).toBe(200);
    const third = await v.post(`/claims/${b}/accept`);
    expect([third.status, third.body.error.code]).toEqual([409, 'VOLUNTEER_BUSY']);
    const assignBusy = await ngo2.post(`/claims/${b}/assign`, { volunteerId: seedId('user:volunteer') });
    expect(assignBusy.body.error.code).toBe('VOLUNTEER_BUSY');

    expect((await v.post(`/claims/${a}/unassign`)).body.claim.status).toBe('CLAIMED');
    expect((await query(`SELECT status FROM pickups WHERE claim_id = $1`, [a])).rows.map((r) => r.status)).toEqual(['ABANDONED']);
    expect((await v.post(`/claims/${b}/accept`)).status).toBe(200);
    expect((await ngo.post(`/claims/${a}/assign`, { volunteerId: seedId('user:donor') })).body.error.code).toBe('NOT_A_VOLUNTEER');
  });

  it('cancelling a claim returns its meals to the listing', async () => {
    const listing = await postListing(donor, { totalMeals: 30 });
    const id = (await claim(ngo, listing.id, 30)).body.claim.id;
    expect((await dbListing(listing.id)).status).toBe('FULLY_CLAIMED');
    expect((await ngo.post(`/claims/${id}/cancel`)).body.claim.status).toBe('CANCELLED');
    expect(await dbListing(listing.id)).toMatchObject({ remaining_meals: 30, status: 'POSTED' });
    expect((await ngo.post(`/claims/${id}/cancel`)).body.error.code).toBe('ALREADY_CANCELLED');
    expect((await claim(ngo, listing.id, 10)).status).toBe(201); // and the NGO may claim again
  });

  it('editing a listing respects what is already claimed', async () => {
    const listing = await postListing(donor, { totalMeals: 40 });
    await claim(ngo, listing.id, 25);
    const current = (await donor.get(`/listings/${listing.id}`)).body.listing;
    const tooLow = await donor.patch(`/listings/${listing.id}`, { expectedVersion: current.version, totalMeals: 20 });
    expect(tooLow.body.error.details.fieldErrors.totalMeals).toMatch(/25 meals already claimed/);
    const frozen = await donor.patch(`/listings/${listing.id}`, { expectedVersion: current.version, isVeg: false });
    expect(frozen.body.error.details.fieldErrors.isVeg).toMatch(/after food has been claimed/);
    const exact = await donor.patch(`/listings/${listing.id}`, { expectedVersion: current.version, totalMeals: 25 });
    expect(exact.body.listing).toMatchObject({ totalMeals: 25, remainingMeals: 0, status: 'FULLY_CLAIMED' });
  });
});

describe('time-based rules (application clock + sweeper)', () => {
  it('R5: a claim with no volunteer for 30 minutes is released and its meals return', async () => {
    const listing = await postListing(donor, { totalMeals: 40 });
    const waiting = (await claim(ngo, listing.id, 15)).body.claim.id;
    const assigned = (await claim(ngo2, listing.id, 10)).body.claim.id;
    await volunteer.post(`/claims/${assigned}/accept`);

    await advance(29);
    expect((await dbClaim(waiting)).status).toBe('CLAIMED'); // not yet
    const res = await advance(2);
    expect(res.body.sweep.claimsReleased).toBeGreaterThanOrEqual(1);
    expect((await dbClaim(waiting)).status).toBe('RELEASED');
    expect((await dbClaim(assigned)).status).toBe('VOLUNTEER_ASSIGNED'); // has a volunteer, so it is kept
    expect(await dbListing(listing.id)).toMatchObject({ remaining_meals: 30, status: 'PARTIALLY_CLAIMED' });
    const trail = (await query(`SELECT actor_label, action FROM audit_log WHERE entity_id = $1 ORDER BY id DESC LIMIT 1`, [waiting])).rows[0];
    expect(trail).toEqual({ actor_label: 'System', action: 'claim.released' });
    await resetClock();
  });

  it('R3/R6: after the safe-until time nothing can be claimed or collected, and leftovers expire', async () => {
    const listing = await postListing(donor, { totalMeals: 40 }); // safe for 2 hours
    const id = (await claim(ngo, listing.id, 10)).body.claim.id;
    await volunteer.post(`/claims/${id}/accept`);
    const code = await codeFor(id);

    // Move the clock WITHOUT letting the sweeper run, to prove the rules do not depend on it.
    await query(`UPDATE app_settings SET value = '{"seconds": 7500}' WHERE key = 'clock_offset'`);
    expect((await dbListing(listing.id)).status).toBe('PARTIALLY_CLAIMED'); // stored status is stale...
    const lateClaim = await claim(ngo2, listing.id, 5);
    expect([lateClaim.status, lateClaim.body.error.code]).toEqual([409, 'LISTING_EXPIRED']); // ...but the claim is refused
    const latePickup = await volunteer.post(`/claims/${id}/pickup`, { handoverCode: code });
    expect([latePickup.status, latePickup.body.error.code]).toEqual([409, 'LISTING_EXPIRED']);
    const lateEdit = await donor.patch(`/listings/${listing.id}`, { expectedVersion: (await dbListing(listing.id)).version, totalMeals: 45 });
    expect(lateEdit.body.error.code).toBe('LISTING_EXPIRED');

    const sweep = await sweepOnce();
    expect(sweep.errors).toBe(0);
    expect((await dbClaim(id)).status).toBe('EXPIRED');
    expect((await query('SELECT status FROM pickups WHERE claim_id = $1', [id])).rows[0].status).toBe('VOIDED');
    expect(await dbListing(listing.id)).toMatchObject({ status: 'EXPIRED', remaining_meals: 40 }); // all 40 counted as wasted
    expect((await sweepOnce()).listingsExpired).toBe(0); // running it again changes nothing
    await resetClock();
  });

  it('food already collected can still be delivered after the deadline', async () => {
    const listing = await postListing(donor, { totalMeals: 20 });
    const id = (await claim(ngo, listing.id, 20)).body.claim.id;
    await volunteer.post(`/claims/${id}/accept`);
    await volunteer.post(`/claims/${id}/pickup`, { handoverCode: await codeFor(id) });
    await advance(180);
    expect((await dbClaim(id)).status).toBe('PICKED_UP');
    expect((await dbListing(listing.id)).status).toBe('FULLY_CLAIMED');
    expect((await volunteer.post(`/claims/${id}/deliver`)).body.claim.status).toBe('DELIVERED');
    expect((await dbListing(listing.id)).status).toBe('COMPLETED');
    await resetClock();
  });

  it('the clock control reports the shifted time and can be reset', async () => {
    const forward = await advance(90);
    expect(forward.body.clockOffsetSeconds).toBe(5400);
    const me = (await donor.get('/me')).body;
    expect(me.clockOffsetSeconds).toBe(5400);
    expect(Math.abs(me.serverNow - (Date.now() + 5400_000))).toBeLessThan(5000);
    expect((await resetClock()).body.clockOffsetSeconds).toBe(0);
  });

  it('the ledger is balanced after everything above', async () => {
    expect(await integrityCheck()).toMatchObject({ ok: true, mismatches: 0, negative: 0 });
  });
});

describe('administration', () => {
  it('admin verifies and suspends organizations; suspension blocks posting at once', async () => {
    const pending = (await admin.get('/admin/organizations?status=PENDING')).body.items;
    expect(pending.map((o) => o.name).sort()).toEqual(['Notun Shuru Foundation', 'Padma Par Restaurant']);
    const id = seedId('org:newngo');
    expect((await admin.post(`/admin/organizations/${id}/status`, { status: 'VERIFIED' })).body.org.status).toBe('VERIFIED');
    expect((await admin.post(`/admin/organizations/${id}/status`, { status: 'VERIFIED' })).status).toBe(409); // duplicate action

    const nobanno = s.client();
    await nobanno.post('/auth/login', { email: 'nobanno@rescueplate.demo', password: 'test-only-password' });
    await admin.post(`/admin/organizations/${seedId('org:nobanno')}/status`, { status: 'SUSPENDED' });
    const blocked = await nobanno.post('/listings', { title: 'x' });
    expect([blocked.status, blocked.body.error.code]).toEqual([403, 'ORG_SUSPENDED']);
  });

  it('the audit log can be searched and paged', async () => {
    const page = (await admin.get('/admin/audit?action=claim.created&pageSize=3')).body;
    expect(page.items).toHaveLength(3);
    expect(page.items.every((i) => i.action === 'claim.created')).toBe(true);
    expect(page.total).toBeGreaterThan(3);
    expect((await admin.get('/admin/audit?q=System')).body.items.every((i) => i.actor === 'System')).toBe(true);
  });

  it('resetting demo data restores the seed and keeps persona sessions alive', async () => {
    const res = await admin.post('/admin/demo/reset');
    expect(res.body).toMatchObject({ reset: true, integrity: { ok: true } });
    expect((await admin.get('/me')).status).toBe(200);
    expect((await donor.get('/listings?mine=true&status=all&q=End-to-end')).body.total).toBe(0);
    expect((await dbListing(seedId('listing:khichuri'))).remaining_meals).toBe(40);
  });
});
