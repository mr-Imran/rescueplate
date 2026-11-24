// M02 (CRUD, persistence, integrity), M05 (search/filter/sort/aggregates), M06 (validation, duplicates).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claim, dbListing, listingInput, postListing, query, seedId, startTestServer } from './helpers.js';

let s;
let donor;
let ngo;
beforeAll(async () => {
  s = await startTestServer();
  donor = await s.as('donor');
  ngo = await s.as('ngo');
});
afterAll(() => s.close());

describe('CRUD and persistence', () => {
  it('creates, reads, updates and deletes a listing', async () => {
    const created = await postListing(donor, { title: 'CRUD test trays', totalMeals: 30 });
    expect(created).toMatchObject({ title: 'CRUD test trays', totalMeals: 30, remainingMeals: 30, status: 'POSTED', version: 1 });
    expect(created.donor.name).toBe('Shapla Kitchen');

    const read = await donor.get(`/listings/${created.id}`);
    expect(read.body.listing.id).toBe(created.id);
    expect(read.body.canEdit).toBe(true);

    const updated = await donor.patch(`/listings/${created.id}`, { expectedVersion: 1, title: 'CRUD test trays (updated)', totalMeals: 35 });
    expect(updated.status).toBe(200);
    expect(updated.body.listing).toMatchObject({ title: 'CRUD test trays (updated)', totalMeals: 35, remainingMeals: 35, version: 2 });
    expect((await dbListing(created.id)).title).toBe('CRUD test trays (updated)'); // really in PostgreSQL

    expect((await donor.del(`/listings/${created.id}`)).status).toBe(200);
    expect((await donor.get(`/listings/${created.id}`)).status).toBe(404);
    expect(await dbListing(created.id)).toBeUndefined();
  });

  it('writes an audit record for every change', async () => {
    const l = await postListing(donor);
    await donor.patch(`/listings/${l.id}`, { expectedVersion: 1, totalMeals: 44 });
    await donor.post(`/listings/${l.id}/cancel`, {});
    const actions = (await query(`SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY id`, [l.id])).rows.map((r) => r.action);
    expect(actions).toEqual(['listing.created', 'listing.updated', 'listing.cancelled']);
  });

  it('a no-change save does not bump the version', async () => {
    const l = await postListing(donor);
    const res = await donor.patch(`/listings/${l.id}`, { expectedVersion: 1, title: l.title });
    expect(res.body.listing.version).toBe(1);
  });

  it('the database itself refuses inconsistent data', async () => {
    const l = await postListing(donor);
    await expect(query('UPDATE listings SET remaining_meals = -1 WHERE id = $1', [l.id])).rejects.toMatchObject({ code: '23514' });
    await expect(query('UPDATE listings SET remaining_meals = total_meals + 1 WHERE id = $1', [l.id])).rejects.toMatchObject({ code: '23514' });
    await expect(query(`INSERT INTO claims (listing_id, ngo_org_id, claimed_by, meals, handover_code) VALUES ($1, $2, $3, 5, '000000')`, ['00000000-0000-4000-8000-000000000000', seedId('org:alor'), seedId('user:ngo')])).rejects.toMatchObject({ code: '23503' });
    // Foreign keys are ON DELETE RESTRICT (reported as 23001 or 23503 depending on the PostgreSQL version).
    await expect(query('DELETE FROM organizations WHERE id = $1', [seedId('org:shapla')])).rejects.toMatchObject({ code: expect.stringMatching(/^23(001|503)$/) });
  });

  it('a listing with claim history cannot be deleted, and one with open claims cannot be cancelled (R7)', async () => {
    const l = await postListing(donor);
    const c = await claim(ngo, l.id, 10);
    expect(c.status).toBe(201);
    const del = await donor.del(`/listings/${l.id}`);
    expect([del.status, del.body.error.code]).toEqual([409, 'HAS_HISTORY']);
    const cancel = await donor.post(`/listings/${l.id}/cancel`, {});
    expect([cancel.status, cancel.body.error.code]).toEqual([409, 'HAS_OPEN_CLAIMS']);

    await ngo.post(`/claims/${c.body.claim.id}/cancel`);
    expect((await donor.post(`/listings/${l.id}/cancel`, {})).body.listing.status).toBe('CANCELLED');
    const second = await donor.post(`/listings/${l.id}/cancel`, {});
    expect([second.status, second.body.error.code]).toEqual([409, 'ALREADY_CANCELLED']);
  });
});

describe('input validation', () => {
  const bad = async (overrides, field, pattern) => {
    const res = await donor.post('/listings', listingInput(overrides));
    expect(res.status, JSON.stringify(overrides)).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fieldErrors[field], JSON.stringify(res.body.error.details)).toMatch(pattern);
  };

  it('rejects zero, negative, fractional, huge and non-numeric quantities', async () => {
    await bad({ totalMeals: 0 }, 'totalMeals', /at least 1/);
    await bad({ totalMeals: -5 }, 'totalMeals', /at least 1/);
    await bad({ totalMeals: 2.5 }, 'totalMeals', /whole number/);
    await bad({ totalMeals: 1e9 }, 'totalMeals', /at most 5000/);
    await bad({ totalMeals: '40' }, 'totalMeals', /must be a number/);
    await bad({ totalMeals: null }, 'totalMeals', /./);
  });

  it('rejects impossible times', async () => {
    const t = (mins) => new Date(Date.now() + mins * 60_000).toISOString();
    await bad({ preparedAt: t(-300), safeUntil: t(-60) }, 'safeUntil', /already passed/);
    await bad({ preparedAt: t(-10), safeUntil: t(-20) }, 'safeUntil', /after the prepared/);
    await bad({ preparedAt: t(-10), safeUntil: t(9 * 60) }, 'safeUntil', /at most 6 hours/);
    await bad({ preparedAt: t(60), safeUntil: t(120) }, 'preparedAt', /future/);
    await bad({ safeUntil: 'tomorrow-ish' }, 'safeUntil', /valid date/);
    await bad({ preparedAt: t(-10), safeUntil: t(5) }, 'safeUntil', /at least 15 more minutes/);
  });

  it('rejects missing, too-short and too-long text', async () => {
    await bad({ title: '' }, 'title', /at least 3/);
    await bad({ title: '   ab   ' }, 'title', /at least 3/);
    await bad({ title: 'x'.repeat(121) }, 'title', /at most 120/);
    await bad({ description: 'x'.repeat(1001) }, 'description', /at most 1000/);
    await bad({ foodType: 'plutonium' }, 'foodType', /food type/);
    await bad({ isVeg: 'yes' }, 'isVeg', /./);
  });

  it('reports every invalid field at once', async () => {
    const res = await donor.post('/listings', { title: 'x' });
    expect(Object.keys(res.body.error.details.fieldErrors).sort()).toEqual(['foodType', 'isVeg', 'preparedAt', 'safeUntil', 'title', 'totalMeals']);
  });

  it('stores script and SQL text as plain text (no injection)', async () => {
    const title = `<script>alert(1)</script> '); DROP TABLE listings;--`;
    const l = await postListing(donor, { title });
    expect((await dbListing(l.id)).title).toBe(title);
    const found = await donor.get(`/listings?mine=true&status=all&q=${encodeURIComponent("'); DROP")}`);
    expect(found.body.items.map((i) => i.id)).toContain(l.id);
    expect((await query('SELECT count(*)::int AS n FROM listings')).rows[0].n).toBeGreaterThan(5);
  });

  it('survives malformed JSON, wrong body types and oversized payloads', async () => {
    const broken = await donor.post('/listings', '{"title": "oops"', { 'Content-Type': 'application/json' });
    expect([broken.status, broken.body.error.code]).toEqual([400, 'INVALID_JSON']);
    expect((await donor.post('/listings', '[1,2,3]', { 'Content-Type': 'application/json' })).status).toBe(400);
    const huge = await donor.post('/listings', listingInput({ description: 'x'.repeat(200_000) }));
    expect(huge.status).toBe(413);
    expect((await donor.get('/health')).status).toBe(200); // still alive
  });

  it('rejects unknown fields and bad values on update', async () => {
    const l = await postListing(donor);
    expect((await donor.patch(`/listings/${l.id}`, { expectedVersion: 1, remainingMeals: 9999 })).status).toBe(400);
    expect((await donor.patch(`/listings/${l.id}`, { expectedVersion: 1, status: 'COMPLETED' })).status).toBe(400);
    expect((await donor.patch(`/listings/${l.id}`, { totalMeals: 5 })).status).toBe(400); // expectedVersion is mandatory
    expect(await dbListing(l.id)).toMatchObject({ remaining_meals: 40, status: 'POSTED', version: 1 });
  });
});

describe('duplicate-action handling', () => {
  it('re-posting the same listing is refused and points at the original', async () => {
    const input = listingInput({ title: 'Duplicate check trays' });
    const first = await donor.post('/listings', input);
    const second = await donor.post('/listings', { ...input, title: 'duplicate CHECK trays' });
    expect(first.status).toBe(201);
    expect([second.status, second.body.error.code]).toEqual([409, 'DUPLICATE_LISTING']);
    expect(second.body.error.details.existingId).toBe(first.body.listing.id);
  });

  it('a double-submitted form (5 identical requests at once) creates exactly one listing', async () => {
    const input = listingInput({ title: 'Double click trays' });
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => donor.post('/listings', input)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect((await query('SELECT count(*)::int AS n FROM listings WHERE title = $1', [input.title])).rows[0].n).toBe(1);
  });
});

describe('search, filtering, sorting and aggregation', () => {
  it('searches title, description and donor name, case-insensitively', async () => {
    const byTitle = await ngo.get('/listings?q=KHICHURI');
    expect(byTitle.body.items.map((i) => i.title)).toEqual(['Shobji khichuri - 60 plates']);
    const byDonor = await ngo.get('/listings?q=ruti%20ghor');
    expect(byDonor.body.items.every((i) => i.donor.name === 'Ruti Ghor Bakery')).toBe(true);
    expect(byDonor.body.total).toBe(2);
    expect((await ngo.get('/listings?q=zzzz-no-match')).body).toMatchObject({ total: 0, items: [] });
  });

  it('treats % and _ in the search box as literal characters', async () => {
    expect((await ngo.get('/listings?q=%25')).body.total).toBe(0);
    expect((await ngo.get('/listings?q=_')).body.total).toBe(0);
  });

  it('filters by diet, food type, quantity and time left', async () => {
    const nonveg = (await ngo.get('/listings?veg=nonveg&pageSize=50')).body.items;
    expect(nonveg.length).toBeGreaterThan(0);
    expect(nonveg.every((i) => i.isVeg === false)).toBe(true);
    const bakery = (await ngo.get('/listings?foodType=bakery')).body.items;
    expect(bakery.map((i) => i.foodType)).toEqual(['bakery']);
    const big = (await ngo.get('/listings?minMeals=50&pageSize=50')).body.items;
    expect(big.length).toBeGreaterThan(0);
    expect(big.every((i) => i.remainingMeals >= 50)).toBe(true);
    const soon = (await ngo.get('/listings?withinMinutes=60&pageSize=50')).body.items;
    expect(soon.length).toBeGreaterThan(0);
    expect(soon.every((i) => new Date(i.safeUntil).getTime() - Date.now() <= 60 * 60_000 + 5000)).toBe(true);
  });

  it('"available" hides sold-out, expired and cancelled listings', async () => {
    const items = (await ngo.get('/listings?pageSize=50')).body.items;
    expect(items.every((i) => ['POSTED', 'PARTIALLY_CLAIMED'].includes(i.status) && i.remainingMeals > 0)).toBe(true);
    const all = (await ngo.get('/listings?status=all&pageSize=50')).body;
    expect(all.total).toBeGreaterThan(items.length);
    const expired = (await ngo.get('/listings?status=EXPIRED&pageSize=50')).body.items;
    expect(expired.length).toBeGreaterThan(0);
    expect(expired.every((i) => i.status === 'EXPIRED')).toBe(true);
  });

  it('sorts by expiry, quantity and distance in both directions', async () => {
    const sorted = (xs) => xs.every((x, i) => i === 0 || xs[i - 1] <= x);
    const expiry = (await ngo.get('/listings?sort=expiry&pageSize=50')).body.items.map((i) => new Date(i.safeUntil).getTime());
    expect(sorted(expiry)).toBe(true);
    const meals = (await ngo.get('/listings?sort=meals&order=desc&pageSize=50')).body.items.map((i) => -i.remainingMeals);
    expect(sorted(meals)).toBe(true);
    const near = (await ngo.get('/listings?sort=distance&pageSize=50')).body;
    expect(near.distanceFrom).toBe('Alor Thikana Shelter');
    expect(sorted(near.items.map((i) => i.distanceKm))).toBe(true);
    expect(near.items[0].distanceKm).toBeLessThan(5);
  });

  it('computes distance correctly and filters by radius', async () => {
    // One degree of latitude is about 111.2 km: a point 0.1 degrees north of a donor is ~11.1 km away.
    const res = await ngo.get(`/listings?q=khichuri&lat=${23.7461 + 0.1}&lng=90.3742`);
    expect(res.body.items[0].distanceKm).toBeCloseTo(11.1, 0);
    expect(res.body.distanceFrom).toBe('your location');
    const within2 = (await ngo.get('/listings?maxKm=2&pageSize=50')).body.items;
    expect(within2.length).toBeGreaterThan(0);
    expect(within2.every((i) => i.distanceKm <= 2)).toBe(true);
  });

  it('paginates consistently and reports aggregates for the whole filtered set', async () => {
    const all = (await ngo.get('/listings?pageSize=50')).body;
    const p1 = (await ngo.get('/listings?pageSize=3&page=1')).body;
    const p2 = (await ngo.get('/listings?pageSize=3&page=2')).body;
    expect(p1.items.length).toBe(3);
    expect(p1.total).toBe(all.total);
    expect(p1.totalPages).toBe(Math.ceil(all.total / 3));
    expect([...p1.items, ...p2.items].map((i) => i.id)).toEqual(all.items.slice(0, 6).map((i) => i.id));
    expect(p1.summary.mealsAvailable).toBe(all.items.reduce((sum, i) => sum + i.remainingMeals, 0)); // sum over all pages
    expect((await ngo.get('/listings?page=999')).body.items).toEqual([]);
  });

  it('rejects invalid query parameters instead of guessing', async () => {
    for (const qs of ['sort=price', 'order=sideways', 'page=0', 'pageSize=1000', 'minMeals=-3', 'veg=maybe', 'status=GONE', 'maxKm=abc']) {
      expect((await ngo.get(`/listings?${qs}`)).status, qs).toBe(400);
    }
  });

  it('"mine" shows only the donor\'s own organization', async () => {
    const mine = (await donor.get('/listings?mine=true&status=all&pageSize=50')).body.items;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((i) => i.donor.name === 'Shapla Kitchen')).toBe(true);
    expect((await ngo.get('/listings?mine=true')).status).toBe(403);
  });
});

describe('impact statistics are accurate', () => {
  it('dashboard totals equal the raw rows', async () => {
    const stats = (await ngo.get('/stats/impact?days=30')).body;
    const raw = await query(
      `SELECT (SELECT COALESCE(sum(meals), 0)::int FROM claims WHERE status = 'DELIVERED' AND closed_at >= now() - interval '30 days') AS rescued,
              (SELECT COALESCE(sum(remaining_meals), 0)::int FROM listings WHERE status = 'EXPIRED' AND safe_until >= now() - interval '30 days') AS expired`,
    );
    expect(stats.totals.mealsRescued).toBe(raw.rows[0].rescued);
    expect(stats.totals.mealsExpired).toBe(raw.rows[0].expired);
    expect(stats.totals.mealsRescued).toBeGreaterThan(500);
    expect(stats.totals.kgDiverted).toBe(Math.round(raw.rows[0].rescued * 0.5));
    const rate = Math.round((raw.rows[0].rescued / (raw.rows[0].rescued + raw.rows[0].expired)) * 1000) / 10;
    expect(stats.totals.rescueRate).toBe(rate);
    expect(stats.daily).toHaveLength(30);
    expect(stats.daily.reduce((sum, d) => sum + d.rescued, 0)).toBe(raw.rows[0].rescued);
    expect(stats.topDonors.reduce((sum, d) => sum + d.meals, 0)).toBeLessThanOrEqual(raw.rows[0].rescued);
    expect(stats.byFoodType.reduce((sum, d) => sum + d.rescued, 0)).toBe(raw.rows[0].rescued);
  });

  it('"mine" is scoped to the viewer\'s organization', async () => {
    const mine = (await ngo.get('/stats/impact?days=30&scope=mine')).body;
    const raw = await query(`SELECT COALESCE(sum(meals), 0)::int AS n FROM claims WHERE status = 'DELIVERED' AND ngo_org_id = $1`, [seedId('org:alor')]);
    expect(mine.scope).toBe('mine');
    expect(mine.totals.mealsRescued).toBe(raw.rows[0].n);
    expect(mine.topNgos.every((n) => n.name === 'Alor Thikana Shelter')).toBe(true);
  });

  it('handles an unknown timezone and an empty range without failing', async () => {
    expect((await ngo.get('/stats/impact?tz=Not/AZone')).body.timezone).toBe('UTC');
    expect((await ngo.get('/stats/impact?tz=Asia/Dhaka')).body.timezone).toBe('Asia/Dhaka');
    const vol = await s.as('volunteer');
    const mine = (await vol.get('/stats/impact?scope=mine&days=1')).body;
    expect(mine.totals.rescueRate === null || typeof mine.totals.rescueRate === 'number').toBe(true);
  });
});
