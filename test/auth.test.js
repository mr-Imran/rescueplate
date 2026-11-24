// M03: authentication, role and resource authorization, session protection.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claim, listingInput, postListing, query, seedId, startTestServer } from './helpers.js';

let s;
beforeAll(async () => {
  s = await startTestServer();
});
afterAll(() => s.close());

const volunteerSignup = (o = {}) => ({ name: 'New Volunteer', email: `vol${Math.random().toString(36).slice(2)}@example.org`, password: 'correct-horse-battery', role: 'volunteer', ...o });

describe('registration', () => {
  it('creates an account, stores only a bcrypt hash, and signs the user in', async () => {
    const c = s.client();
    const input = volunteerSignup();
    const res = await c.post('/auth/register', input);
    expect(res.status).toBe(201);
    const row = (await query('SELECT password_hash FROM users WHERE email = $1', [input.email])).rows[0];
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);
    expect(row.password_hash).not.toContain(input.password);
    expect((await c.get('/me')).body.user.role).toBe('volunteer');
  });

  it('rejects invalid input with a message for each field', async () => {
    const res = await s.client().post('/auth/register', { name: 'A', email: 'not-an-email', password: 'short', role: 'boss' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.details.fieldErrors).sort()).toEqual(['email', 'name', 'password', 'role']);
  });

  it('rejects a duplicate email, ignoring letter case', async () => {
    const input = volunteerSignup();
    expect((await s.client().post('/auth/register', input)).status).toBe(201);
    const again = await s.client().post('/auth/register', { ...input, email: input.email.toUpperCase() });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('two simultaneous sign-ups with one email create exactly one account', async () => {
    const input = volunteerSignup();
    const results = await Promise.all([1, 2, 3, 4].map(() => s.client().post('/auth/register', input)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect((await query('SELECT count(*)::int AS n FROM users WHERE email = $1', [input.email])).rows[0].n).toBe(1);
  });

  it('nobody can self-register as an admin', async () => {
    expect((await s.client().post('/auth/register', volunteerSignup({ role: 'admin' }))).status).toBe(400);
  });

  it('a new organization starts unverified and cannot post until an admin verifies it (R8)', async () => {
    const c = s.client();
    const reg = await c.post('/auth/register', {
      ...volunteerSignup({ role: 'donor' }),
      org: { name: 'Notun Cafe Banani', address: 'House 1, Road 2, Banani, Dhaka', lat: 23.7937, lng: 90.4043 },
    });
    expect(reg.status).toBe(201);
    const blocked = await c.post('/listings', listingInput());
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ORG_NOT_VERIFIED');

    const admin = await s.as('admin');
    const orgId = (await c.get('/me')).body.user.orgId;
    expect((await admin.post(`/admin/organizations/${orgId}/status`, { status: 'VERIFIED' })).status).toBe(200);
    expect((await c.post('/listings', listingInput())).status).toBe(201); // effective immediately, same session
  });

  it('staff can join an existing organization with its join code', async () => {
    const donor = await s.as('donor');
    const { joinCode } = (await donor.get('/org')).body.org;
    const c = s.client();
    expect((await c.post('/auth/register', { ...volunteerSignup({ role: 'donor' }), joinCode })).status).toBe(201);
    expect((await c.get('/me')).body.user.org.name).toBe('Shapla Kitchen');
    const wrongType = await s.client().post('/auth/register', { ...volunteerSignup({ role: 'ngo' }), joinCode });
    expect(wrongType.status).toBe(400);
  });
});

describe('sign-in and sessions', () => {
  it('rejects a wrong password and an unknown email with the same message', async () => {
    const a = await s.client().post('/auth/login', { email: 'donor@rescueplate.demo', password: 'wrong-password' });
    const b = await s.client().post('/auth/login', { email: 'nobody@example.org', password: 'wrong-password' });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('signs in with the right password and sets a protected cookie', async () => {
    const res = await s.client().post('/auth/login', { email: 'DONOR@rescueplate.demo', password: 'test-only-password' });
    expect(res.status).toBe(200);
    const cookie = res.setCookie.find((c) => c.startsWith('rp_session='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Expires=/i);
  });

  it('demo persona sign-in works for listed personas only', async () => {
    const c = s.client();
    expect((await c.post('/auth/demo-login', { persona: 'ngo' })).status).toBe(200);
    expect((await c.get('/me')).body.user).toMatchObject({ name: 'Shirin Sultana', role: 'ngo', org: { name: 'Alor Thikana Shelter', status: 'VERIFIED' } });
    expect((await s.client().post('/auth/demo-login', { persona: 'root' })).status).toBe(404);
    const config = (await s.client().get('/config')).body;
    expect(config.personas.map((p) => p.key)).toEqual(['donor', 'donor2', 'ngo', 'ngo2', 'volunteer', 'admin']);
    expect(JSON.stringify(config)).not.toMatch(/password/i);
  });

  it('stores only a hash of the session token', async () => {
    const c = await s.as('donor');
    const token = c.cookie().split('=')[1];
    const rows = (await query('SELECT token_hash FROM sessions')).rows;
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
  });

  it('protected routes need a session', async () => {
    for (const path of ['/me', '/listings', '/claims', '/stats/impact', '/org', '/admin/audit']) {
      expect((await s.client().get(path)).status, path).toBe(401);
    }
  });

  it('a forged or garbage cookie is rejected', async () => {
    const c = s.client();
    c.setCookie('rp_session=this-token-was-never-issued');
    expect((await c.get('/me')).status).toBe(401);
    c.setCookie(`rp_session=${'x'.repeat(5000)}`);
    expect((await c.get('/me')).status).toBe(401);
  });

  it('logout revokes the session on the server, so a copied cookie stops working', async () => {
    const c = await s.as('ngo');
    const stolen = c.cookie();
    expect((await c.get('/me')).status).toBe(200);
    expect((await c.post('/auth/logout')).status).toBe(200);
    const thief = s.client();
    thief.setCookie(stolen);
    expect((await thief.get('/me')).status).toBe(401);
  });

  it('an expired session is rejected', async () => {
    const c = await s.as('volunteer');
    await query(`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [seedId('user:volunteer')]);
    expect((await c.get('/me')).status).toBe(401);
  });

  it('suspending a user ends their sessions immediately; reactivating does not revive them', async () => {
    const admin = await s.as('admin');
    const victim = await s.as('volunteer3');
    const id = seedId('user:volunteer3');
    expect((await admin.post(`/admin/users/${id}/status`, { status: 'SUSPENDED' })).status).toBe(200);
    expect((await victim.get('/me')).status).toBe(401);
    const relogin = await s.client().post('/auth/login', { email: 'volunteer3@rescueplate.demo', password: 'test-only-password' });
    expect([relogin.status, relogin.body.error.code]).toEqual([403, 'ACCOUNT_SUSPENDED']);
    await admin.post(`/admin/users/${id}/status`, { status: 'ACTIVE' });
    expect((await victim.get('/me')).status).toBe(401); // old session stays dead
  });

  it('an admin cannot suspend themselves', async () => {
    const admin = await s.as('admin');
    expect((await admin.post(`/admin/users/${seedId('user:admin')}/status`, { status: 'SUSPENDED' })).status).toBe(409);
  });

  it('blocks cross-site state-changing requests (CSRF)', async () => {
    const c = await s.as('donor');
    const res = await c.post('/listings', listingInput(), { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
  });
});

describe('role-based authorization', () => {
  it('each role is limited to its own actions', async () => {
    const [donor, ngo, volunteer] = await Promise.all([s.as('donor'), s.as('ngo'), s.as('volunteer')]);
    const listing = await postListing(donor);
    expect((await ngo.post('/listings', listingInput())).status).toBe(403); //               NGO cannot post
    expect((await volunteer.post('/listings', listingInput())).status).toBe(403); //         volunteer cannot post
    expect((await claim(donor, listing.id, 5)).status).toBe(403); //                         donor cannot claim
    expect((await claim(volunteer, listing.id, 5)).status).toBe(403); //                     volunteer cannot claim
    for (const c of [donor, ngo, volunteer]) {
      expect((await c.get('/admin/audit')).status).toBe(403);
      expect((await c.get('/admin/users')).status).toBe(403);
      expect((await c.post('/admin/demo/reset')).status).toBe(403);
      expect((await c.post(`/admin/organizations/${seedId('org:newngo')}/status`, { status: 'VERIFIED' })).status).toBe(403);
    }
  });

  it('a role cannot be escalated through the profile or registration payload', async () => {
    const c = s.client();
    await c.post('/auth/register', { ...volunteerSignup(), role: 'volunteer', isAdmin: true, status: 'ACTIVE', orgId: seedId('org:shapla') });
    const me = (await c.get('/me')).body.user;
    expect(me.role).toBe('volunteer');
    expect(me.orgId).toBeNull();
  });
});

describe('resource-based authorization (another user\'s records)', () => {
  it("a donor cannot edit, cancel or delete another organization's listing", async () => {
    const owner = await s.as('donor');
    const listing = await postListing(owner);
    const intruder = s.client();
    await intruder.post('/auth/login', { email: 'nobanno@rescueplate.demo', password: 'test-only-password' });

    const edit = await intruder.patch(`/listings/${listing.id}`, { expectedVersion: listing.version, totalMeals: 1 });
    expect(edit.status).toBe(403);
    expect(edit.body.error.code).toBe('NOT_OWNER');
    expect(JSON.stringify(edit.body)).not.toContain(listing.title); // no data leaks in the refusal
    expect((await intruder.post(`/listings/${listing.id}/cancel`, {})).status).toBe(403);
    expect((await intruder.del(`/listings/${listing.id}`)).status).toBe(403);

    const after = (await owner.get(`/listings/${listing.id}`)).body.listing;
    expect(after).toMatchObject({ totalMeals: listing.totalMeals, status: 'POSTED', version: listing.version });
  });

  it('a second staff member of the same organization CAN edit it', async () => {
    const listing = await postListing(await s.as('donor'));
    const colleague = await s.as('donor2');
    expect((await colleague.patch(`/listings/${listing.id}`, { expectedVersion: listing.version, totalMeals: 41 })).status).toBe(200);
  });

  it("an NGO cannot cancel, assign or deliver another NGO's claim", async () => {
    const listing = await postListing(await s.as('donor'));
    const owner = await s.as('ngo');
    const claimId = (await claim(owner, listing.id, 10)).body.claim.id;
    const other = await s.as('ngo2');
    expect((await other.post(`/claims/${claimId}/cancel`)).status).toBe(403);
    expect((await other.post(`/claims/${claimId}/assign`, { volunteerId: seedId('user:volunteer') })).status).toBe(403);
    expect((await other.post(`/claims/${claimId}/deliver`)).status).toBe(403);
    expect((await other.get('/claims')).body.items.some((c) => c.id === claimId)).toBe(false); // and cannot even see it
  });

  it('the handover code is visible to the donor only', async () => {
    const donor = await s.as('donor');
    const listing = await postListing(donor);
    const ngo = await s.as('ngo');
    const created = await claim(ngo, listing.id, 10);
    expect(created.body.claim.handoverCode).toBeUndefined();
    const volunteer = await s.as('volunteer2');
    await volunteer.post(`/claims/${created.body.claim.id}/accept`);
    const seenByVolunteer = (await volunteer.get('/claims')).body.items.find((c) => c.id === created.body.claim.id);
    expect(seenByVolunteer.handoverCode).toBeUndefined();
    const seenByDonor = (await donor.get('/claims')).body.items.find((c) => c.id === created.body.claim.id);
    expect(seenByDonor.handoverCode).toMatch(/^\d{6}$/);
  });

  it("only the assigned volunteer can collect; another volunteer's attempt is refused", async () => {
    const donor = await s.as('donor');
    const listing = await postListing(donor);
    const ngo = await s.as('ngo');
    const claimId = (await claim(ngo, listing.id, 10)).body.claim.id;
    const assigned = await s.as('volunteer');
    await assigned.post(`/claims/${claimId}/accept`);
    const code = (await donor.get('/claims')).body.items.find((c) => c.id === claimId).handoverCode;
    const other = await s.as('volunteer2');
    expect((await other.post(`/claims/${claimId}/pickup`, { handoverCode: code })).status).toBe(403);
    expect((await other.post(`/claims/${claimId}/deliver`)).status).toBe(403);
  });

  it('unknown and malformed ids are a clean 404, never a server error', async () => {
    const donor = await s.as('donor');
    expect((await donor.get('/listings/not-a-uuid')).status).toBe(404);
    expect((await donor.get('/listings/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await donor.patch("/listings/1'; DROP TABLE listings;--", { expectedVersion: 1 })).status).toBe(404);
    expect((await donor.get('/no-such-route')).status).toBe(404);
  });
});
