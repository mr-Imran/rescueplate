// Demo mode keeps itself usable for the next visitor: a reset keeps accounts that
// people registered, and the sample data restores itself once nobody is using it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoIdleMinutes, resetDemoData, resetDemoIfIdle } from '../server/db/seed.js';
import { integrityCheck } from '../server/services/stats.js';
import { postListing, query, seedId, startTestServer } from './helpers.js';

let s;
let admin;
let donor;
beforeAll(async () => {
  s = await startTestServer();
  [admin, donor] = await Promise.all(['admin', 'donor'].map((p) => s.as(p)));
});
afterAll(() => s.close());

/** Pretends the last change by any user happened `minutes` earlier. */
const ageActivity = (minutes) => query('UPDATE audit_log SET created_at = created_at - make_interval(mins => $1)', [minutes]);
const claimable = async () =>
  (await query(`SELECT count(*)::int AS n FROM listings WHERE status IN ('POSTED', 'PARTIALLY_CLAIMED') AND safe_until > now()`)).rows[0].n;
const clockOffset = async () => (await query(`SELECT (value->>'seconds')::float AS s FROM app_settings WHERE key = 'clock_offset'`)).rows[0].s;
const statusOf = async (key) => (await query('SELECT status FROM users WHERE id = $1', [seedId(`user:${key}`)])).rows[0].status;

describe('reset keeps what visitors registered', () => {
  it('carries registered accounts, their organization and their sign-in across a reset, and clears their listings', async () => {
    const kitchen = s.client();
    const signup = {
      name: 'Visiting Judge',
      email: 'judge@example.org',
      password: 'correct-horse-battery',
      role: 'donor',
      org: { name: 'Judge Test Kitchen', address: '1 Test Road, Dhaka', lat: 23.78, lng: 90.4 },
    };
    expect((await kitchen.post('/auth/register', signup)).status).toBe(201);
    const before = (await kitchen.get('/org')).body.org;
    expect((await admin.post(`/admin/organizations/${before.id}/status`, { status: 'VERIFIED' })).status).toBe(200);
    const listing = await postListing(kitchen, { title: 'Posted before the reset' });

    const helper = s.client();
    expect((await helper.post('/auth/register', { name: 'Visiting Helper', email: 'helper@example.org', password: 'correct-horse-battery', role: 'volunteer' })).status).toBe(201);

    await resetDemoData();

    // The same browser is still signed in, and the organization kept its verification and join code.
    const after = (await kitchen.get('/org')).body.org;
    expect(after).toMatchObject({ id: before.id, name: 'Judge Test Kitchen', status: 'VERIFIED', joinCode: before.joinCode, version: before.version + 1 });
    expect((await helper.get('/me')).body.user).toMatchObject({ name: 'Visiting Helper', role: 'volunteer' });

    // The password still works from a new browser.
    const fresh = s.client();
    expect((await fresh.post('/auth/login', { email: signup.email, password: signup.password })).status).toBe(200);

    // Their listing was demo activity and is cleared with the rest; the seed is back and consistent.
    expect((await kitchen.get(`/listings/${listing.id}`)).status).toBe(404);
    expect(await claimable()).toBeGreaterThanOrEqual(6);
    expect((await integrityCheck()).ok).toBe(true);
  });

  it('demo personas stay signed in and get their original state back', async () => {
    await admin.post(`/admin/users/${seedId('user:ngo2')}/status`, { status: 'SUSPENDED' });
    expect(await statusOf('ngo2')).toBe('SUSPENDED');
    await resetDemoData();
    expect(await statusOf('ngo2')).toBe('ACTIVE');
    expect((await admin.get('/me')).status).toBe(200);
    expect((await donor.get('/me')).status).toBe(200);
  });
});

describe('sample data restores itself when nobody is using the app', () => {
  it('tells the sign-in page how long the idle period is', async () => {
    expect((await s.client().get('/config')).body.demoAutoResetMinutes).toBe(120);
  });

  it('does nothing while someone is working', async () => {
    const listing = await postListing(donor, { title: 'Work in progress' });
    expect(await demoIdleMinutes()).toBeLessThan(1);
    expect(await resetDemoIfIdle(120)).toBe(false);
    expect((await donor.get(`/listings/${listing.id}`)).status).toBe(200);

    // 119 minutes of silence is still not enough.
    await ageActivity(119);
    expect(await resetDemoIfIdle(120)).toBe(false);
    expect((await donor.get(`/listings/${listing.id}`)).status).toBe(200);
  });

  it('restores a stale, tampered demo once the idle period has passed', async () => {
    // What a previous visitor might leave behind: clock a day ahead (all food expired), a persona suspended.
    await admin.post('/admin/demo/clock', { minutes: 1440 });
    await admin.post('/admin/demo/clock', { minutes: 1440 });
    await admin.post(`/admin/users/${seedId('user:volunteer')}/status`, { status: 'SUSPENDED' });
    expect(await clockOffset()).toBe(2880 * 60);
    expect((await query(`SELECT count(*)::int AS n FROM listings WHERE status IN ('POSTED', 'PARTIALLY_CLAIMED') AND safe_until > app_now()`)).rows[0].n).toBe(0);

    await ageActivity(121);
    expect(await resetDemoIfIdle(120)).toBe(true);

    expect(await clockOffset()).toBe(0);
    expect(await statusOf('volunteer')).toBe('ACTIVE');
    expect(await claimable()).toBeGreaterThanOrEqual(6);
    expect((await integrityCheck()).ok).toBe(true);
    expect((await admin.get('/me')).status).toBe(200); // still signed in

    // It has just been restored, so it does not fire again.
    expect(await resetDemoIfIdle(120)).toBe(false);
  });

  it('food expiring by itself does not count as someone using the app', async () => {
    await ageActivity(300);
    await query(`INSERT INTO audit_log (actor_label, action, entity_type) VALUES ('System', 'listing.expired', 'listing')`);
    expect(await demoIdleMinutes()).toBeGreaterThanOrEqual(300);
    expect(await resetDemoIfIdle(120)).toBe(true);
  });

  it('two app instances noticing at the same moment restore it only once', async () => {
    await ageActivity(121);
    const results = await Promise.all([resetDemoIfIdle(120), resetDemoIfIdle(120), resetDemoIfIdle(120)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'demo.seeded'`)).rows[0].n).toBe(1);
    expect((await integrityCheck()).ok).toBe(true);
  });

  it('can be switched off, and never touches a database that does not hold the demo world', async () => {
    await ageActivity(500);
    expect(await resetDemoIfIdle(0)).toBe(false);

    // Without the seeded accounts this is somebody's real data: leave it alone.
    await query('DELETE FROM users WHERE id = $1', [seedId('user:admin')]);
    expect(await demoIdleMinutes()).toBeNull();
    expect(await resetDemoIfIdle(120)).toBe(false);

    await resetDemoData(); // put the demo world back for whatever runs next
    expect(await demoIdleMinutes()).toBeLessThan(1);
  });
});
