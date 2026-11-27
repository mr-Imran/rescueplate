// Advanced challenge A05: atomic claims, race-condition prevention, idempotency, transaction consistency.
// Every request here goes through real HTTP to the real app and a real PostgreSQL.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrityCheck } from '../server/services/stats.js';
import { claim, dbListing, idemKey, postListing, query, startTestServer } from './helpers.js';

const NGOS = ['ngo', 'ngo2', 'eldercare', 'womens', 'streetkids', 'stars', 'nightmeal', 'relief'];
let s;
let donor;
let ngos;
beforeAll(async () => {
  s = await startTestServer();
  donor = await s.as('donor');
  ngos = await Promise.all(NGOS.map((k) => s.as(k)));
  // Take NGO capacity out of the picture here, so these tests isolate stock contention.
  // (The capacity race has its own test below.)
  await query(`UPDATE organizations SET daily_capacity_meals = 100000 WHERE type = 'ngo'`);
});
afterAll(() => s.close());

const heldMeals = async (listingId) =>
  (await query(`SELECT COALESCE(sum(meals), 0)::int AS n FROM claims WHERE listing_id = $1 AND status IN ('CLAIMED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP', 'DELIVERED')`, [listingId])).rows[0].n;

describe('multiple users request the final available resource', () => {
  it('8 NGOs race for the last 40 meals: exactly 40 are granted, never more', async () => {
    const l = await postListing(donor, { totalMeals: 40 });
    const results = await Promise.all(ngos.map((c) => claim(c, l.id, 15)));

    const granted = results.filter((r) => r.status === 201).map((r) => r.body.decision.granted);
    const rejected = results.filter((r) => r.status !== 201);
    expect(granted.reduce((a, b) => a + b, 0)).toBe(40);
    expect(granted.sort((a, b) => a - b)).toEqual([10, 15, 15]); // two full grants and one partial (R4)
    expect(rejected).toHaveLength(5);
    expect(rejected.every((r) => r.status === 409 && r.body.error.code === 'SOLD_OUT')).toBe(true);

    const row = await dbListing(l.id);
    expect(row.remaining_meals).toBe(0);
    expect(row.status).toBe('FULLY_CLAIMED');
    expect(row.version).toBe(4); // one bump per successful claim, none for rejections
    expect(await heldMeals(l.id)).toBe(40);
  });

  it('a single last meal goes to exactly one of 8 simultaneous requests', async () => {
    const l = await postListing(donor, { totalMeals: 1 });
    const results = await Promise.all(ngos.map((c) => claim(c, l.id, 1)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.body.error?.code === 'SOLD_OUT')).toHaveLength(7);
    expect((await dbListing(l.id)).remaining_meals).toBe(0);
  });

  it('all-or-nothing requests under contention never split a grant', async () => {
    const l = await postListing(donor, { totalMeals: 25 });
    const results = await Promise.all(ngos.slice(0, 4).map((c) => claim(c, l.id, 10, { allowPartial: false })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    const refused = results.filter((r) => r.status === 409);
    expect(refused.map((r) => r.body.error.code)).toEqual(['INSUFFICIENT_MEALS', 'INSUFFICIENT_MEALS']);
    expect(refused[0].body.error.details).toMatchObject({ available: 5, limitedBy: 'stock' });
    expect((await dbListing(l.id)).remaining_meals).toBe(5);
  });

  it('repeated races keep the whole ledger balanced', async () => {
    for (let round = 0; round < 5; round++) {
      const l = await postListing(donor, { totalMeals: 7 + round * 3 });
      const results = await Promise.all(ngos.map((c) => claim(c, l.id, 4)));
      const total = results.filter((r) => r.status === 201).reduce((sum, r) => sum + r.body.decision.granted, 0);
      // Whatever was granted is exactly what left the listing (NGO capacity may stop some grants).
      expect(total).toBe(7 + round * 3 - (await dbListing(l.id)).remaining_meals);
      expect(total).toBeLessThanOrEqual(7 + round * 3);
    }
    expect(await integrityCheck()).toMatchObject({ ok: true, mismatches: 0, negative: 0 });
  });

  it('one NGO claiming two listings at once cannot exceed its daily capacity (R2)', async () => {
    // Give Chhoto Tara room for exactly 20 more meals, then ask for 20 on two listings at once.
    const stars = ngos[NGOS.indexOf('stars')];
    const mine = (await stars.get('/org')).body;
    const used = mine.capacity.used;
    expect((await stars.patch('/org', { expectedVersion: mine.org.version, dailyCapacityMeals: used + 20 })).status).toBe(200);
    const [a, b] = await Promise.all([postListing(donor, { totalMeals: 100 }), postListing(donor, { totalMeals: 100 })]);
    const results = await Promise.all([claim(stars, a.id, 20), claim(stars, b.id, 20)]);
    const granted = results.filter((r) => r.status === 201).reduce((sum, r) => sum + r.body.decision.granted, 0);
    expect(granted).toBe(20); // not 40
    expect(results.filter((r) => r.body.error?.code === 'CAPACITY_REACHED')).toHaveLength(1);
    expect((await stars.get('/org')).body.capacity.left).toBe(0);
  });

  it('the same NGO double-claiming one listing in parallel gets one claim', async () => {
    const l = await postListing(donor, { totalMeals: 50 });
    const c = ngos[1];
    const results = await Promise.all([claim(c, l.id, 5), claim(c, l.id, 5), claim(c, l.id, 5)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.body.error?.code === 'ALREADY_CLAIMED')).toHaveLength(2);
    expect((await dbListing(l.id)).remaining_meals).toBe(45);
  });

  it('claims racing a donor edit stay consistent', async () => {
    const l = await postListing(donor, { totalMeals: 30 });
    const [c1, c2, edit] = await Promise.all([
      claim(ngos[0], l.id, 10),
      claim(ngos[3], l.id, 10),
      donor.patch(`/listings/${l.id}`, { expectedVersion: 1, totalMeals: 15 }),
    ]);
    // Either the edit landed first (version 1) or it hit a version conflict / "below claimed" rule.
    expect([200, 400, 409]).toContain(edit.status);
    const row = await dbListing(l.id);
    expect(row.remaining_meals).toBe(row.total_meals - (await heldMeals(l.id)));
    expect(row.remaining_meals).toBeGreaterThanOrEqual(0);
    expect([c1.status, c2.status].every((st) => st === 201 || st === 409)).toBe(true);
  });

  it('two volunteers accepting the same pickup: one wins, one is told it is taken', async () => {
    const l = await postListing(donor, { totalMeals: 20 });
    const claimId = (await claim(ngos[4], l.id, 10)).body.claim.id;
    const [v1, v2] = await Promise.all([s.as('volunteer2'), s.as('volunteer3')]);
    const results = await Promise.all([v1.post(`/claims/${claimId}/accept`), v2.post(`/claims/${claimId}/accept`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409).body.error.code).toBe('ALREADY_ASSIGNED');
    expect((await query(`SELECT count(*)::int AS n FROM pickups WHERE claim_id = $1 AND status = 'ASSIGNED'`, [claimId])).rows[0].n).toBe(1);
  });
});

describe('idempotency', () => {
  it('requires an Idempotency-Key and validates its format', async () => {
    const l = await postListing(donor);
    const missing = await ngos[0].post(`/listings/${l.id}/claims`, { meals: 5 });
    expect(missing.status).toBe(400);
    const bad = await ngos[0].post(`/listings/${l.id}/claims`, { meals: 5 }, { 'Idempotency-Key': 'short' });
    expect(bad.status).toBe(400);
    expect((await dbListing(l.id)).remaining_meals).toBe(40);
  });

  it('a retried request returns the original result and does not claim twice', async () => {
    const l = await postListing(donor, { totalMeals: 30 });
    const key = idemKey();
    const first = await claim(ngos[0], l.id, 10, { key });
    const retry = await claim(ngos[0], l.id, 10, { key });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(first.headers.get('Idempotent-Replayed')).toBeNull();
    expect(retry.headers.get('Idempotent-Replayed')).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect((await dbListing(l.id)).remaining_meals).toBe(20);
    expect((await query('SELECT count(*)::int AS n FROM claims WHERE listing_id = $1', [l.id])).rows[0].n).toBe(1);
  });

  it('10 copies of one request sent at the same instant execute exactly once', async () => {
    const l = await postListing(donor, { totalMeals: 30 });
    const key = idemKey();
    const results = await Promise.all(Array.from({ length: 10 }, () => claim(ngos[3], l.id, 10, { key })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.claim.id)).size).toBe(1);
    expect(results.filter((r) => r.headers.get('Idempotent-Replayed') === 'true')).toHaveLength(9);
    expect((await dbListing(l.id)).remaining_meals).toBe(20);
    expect((await query('SELECT count(*)::int AS n FROM claims WHERE listing_id = $1', [l.id])).rows[0].n).toBe(1);
  });

  it('a rejected request is also replayed faithfully', async () => {
    const l = await postListing(donor, { totalMeals: 5 });
    await claim(ngos[0], l.id, 5);
    const key = idemKey();
    const first = await claim(ngos[3], l.id, 5, { key });
    expect([first.status, first.body.error.code]).toEqual([409, 'SOLD_OUT']);
    // Meals come back, but a retry of the SAME request must still report the original outcome.
    const openClaim = (await ngos[0].get('/claims?state=open')).body.items.find((c) => c.listing.id === l.id);
    await ngos[0].post(`/claims/${openClaim.id}/cancel`);
    const retry = await claim(ngos[3], l.id, 5, { key });
    expect([retry.status, retry.body.error.code]).toEqual([409, 'SOLD_OUT']);
    expect(retry.headers.get('Idempotent-Replayed')).toBe('true');
    // A new intent (new key) sees the current state.
    expect((await claim(ngos[3], l.id, 5)).status).toBe(201);
  });

  it('reusing a key for a different request is refused', async () => {
    const l = await postListing(donor, { totalMeals: 30 });
    const key = idemKey();
    expect((await claim(ngos[0], l.id, 10, { key })).status).toBe(201);
    const different = await claim(ngos[0], l.id, 12, { key });
    expect([different.status, different.body.error.code]).toEqual([422, 'IDEMPOTENCY_KEY_REUSED']);
    expect((await dbListing(l.id)).remaining_meals).toBe(20);
  });

  it('keys are scoped per user: another NGO can use the same key string', async () => {
    const l = await postListing(donor, { totalMeals: 30 });
    const key = idemKey();
    const a = await claim(ngos[0], l.id, 10, { key });
    const b = await claim(ngos[4], l.id, 10, { key });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.claim.id).not.toBe(b.body.claim.id);
  });
});

describe('atomicity: a failure part-way through leaves nothing behind', () => {
  it('if the audit write fails after the meals were decremented, everything rolls back', async () => {
    const l = await postListing(donor, { totalMeals: 30 });
    // Simulate a mid-transaction failure: make the audit insert for claims blow up.
    await query(`CREATE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
                 BEGIN IF NEW.action = 'claim.created' THEN RAISE EXCEPTION 'simulated storage failure'; END IF; RETURN NEW; END $$`);
    await query('CREATE TRIGGER test_fail_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_fail_audit()');
    const key = idemKey();
    let failed;
    try {
      failed = await claim(ngos[0], l.id, 10, { key });
    } finally {
      await query('DROP TRIGGER test_fail_audit ON audit_log');
      await query('DROP FUNCTION test_fail_audit()');
    }
    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe('INTERNAL_ERROR');
    expect(failed.text).not.toMatch(/simulated|audit_log|at .*\.js/); // no internals leak to the client

    expect(await dbListing(l.id)).toMatchObject({ remaining_meals: 30, status: 'POSTED', version: 1 });
    expect((await query('SELECT count(*)::int AS n FROM claims WHERE listing_id = $1', [l.id])).rows[0].n).toBe(0);
    expect((await query('SELECT count(*)::int AS n FROM idempotency_keys WHERE key = $1', [key])).rows[0].n).toBe(0);

    // Recovery: the very same request (same key) now succeeds, once.
    const retry = await claim(ngos[0], l.id, 10, { key });
    expect(retry.status).toBe(201);
    expect(retry.headers.get('Idempotent-Replayed')).toBeNull();
    expect((await dbListing(l.id)).remaining_meals).toBe(20);
  });

  it('a claim on a listing that does not exist changes nothing', async () => {
    const res = await claim(ngos[0], '00000000-0000-4000-8000-000000000000', 5);
    expect(res.status).toBe(404);
  });

  it('the demo console race, duplicate, atomicity and conflict scenarios all pass', async () => {
    const admin = await s.as('admin');
    const race = (await admin.post('/admin/demo/race', { meals: 40, contenders: 6, requestEach: 15 })).body;
    expect(race).toMatchObject({ passed: true, totalGranted: 40 });
    expect(race.ledger).toMatchObject({ oversold: false, balanced: true, remainingMeals: 0 });
    const idem = (await admin.post('/admin/demo/idempotency', { copies: 5 })).body;
    expect(idem).toMatchObject({ passed: true, claimsCreated: 1, executedOnce: true, sameClaimReturned: true });
    const atomic = (await admin.post('/admin/demo/atomicity')).body;
    expect(atomic).toMatchObject({
      passed: true,
      afterFailure: { remainingMeals: 30, claims: 0, idempotencyKeys: 0 },
      retry: { status: 201, remainingMeals: 20 },
    });
    const conflict = (await admin.post('/admin/demo/conflict')).body;
    expect(conflict.passed).toBe(true);
    expect(conflict.results.map((r) => r.outcome).sort()).toEqual(['SAVED', 'VERSION_CONFLICT']);
    expect((await admin.get('/admin/integrity')).body).toMatchObject({ ok: true, mismatches: 0 });
  });
});

describe('the same guarantees with a larger crowd', () => {
  it('30 NGOs race for the final meal, then for the final 40 meals: never oversold', async () => {
    // 30 separate organizations, each signed in as its own user (one browser each).
    const crowd = await Promise.all(
      Array.from({ length: 30 }, async (_, i) => {
        const c = s.client();
        const res = await c.post('/auth/register', {
          name: `Crowd Member ${i}`,
          email: `crowd${i}@example.org`,
          password: 'correct-horse-battery',
          role: 'ngo',
          org: { name: `Crowd Shelter ${i}`, address: `${i + 1} Race Road, Dhaka`, lat: 23.75, lng: 90.39, dailyCapacityMeals: 1000 },
        });
        expect(res.status).toBe(201);
        return c;
      }),
    );
    await query(`UPDATE organizations SET status = 'VERIFIED' WHERE name LIKE 'Crowd Shelter %'`);

    // One meal, 30 simultaneous requests: exactly one winner.
    const one = await postListing(donor, { totalMeals: 1 });
    const single = await Promise.all(crowd.map((c) => claim(c, one.id, 1)));
    expect(single.filter((r) => r.status === 201)).toHaveLength(1);
    expect(single.filter((r) => r.status === 409 && r.body.error.code === 'SOLD_OUT')).toHaveLength(29);
    expect(await dbListing(one.id)).toMatchObject({ remaining_meals: 0, status: 'FULLY_CLAIMED' });

    // 40 meals, 30 requests for 3 each (90 wanted): 13 full grants and one partial grant of 1.
    const forty = await postListing(donor, { totalMeals: 40 });
    const many = await Promise.all(crowd.map((c) => claim(c, forty.id, 3)));
    const grants = many.filter((r) => r.status === 201).map((r) => r.body.decision.granted);
    expect(grants.reduce((a, b) => a + b, 0)).toBe(40);
    expect(grants.sort((a, b) => a - b)).toEqual([1, ...Array(13).fill(3)]);
    expect(many.filter((r) => r.status === 409 && r.body.error.code === 'SOLD_OUT')).toHaveLength(16);
    expect((await dbListing(forty.id)).remaining_meals).toBe(0);
    expect(await heldMeals(forty.id)).toBe(40);
    expect(await integrityCheck()).toMatchObject({ ok: true, mismatches: 0, negative: 0 });
  });
});
