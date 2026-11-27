// Advanced challenge A01: multi-user live updates, conflict detection, consistent shared state.
import { io as connect } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { withTransaction } from '../server/db/pool.js';
import { claim, dbListing, postListing, query, seedId, sleep, startTestServer } from './helpers.js';

let s;
let donor;
let donor2;
let ngo;
const sockets = [];

beforeAll(async () => {
  s = await startTestServer({ realtime: true });
  [donor, donor2, ngo] = await Promise.all([s.as('donor'), s.as('donor2'), s.as('ngo')]);
});
afterEach(() => {
  while (sockets.length) sockets.pop().close();
});
afterAll(() => s.close());

/** Opens a live connection for a signed-in client and records everything it receives. */
function live(client) {
  const socket = connect(s.base, { transports: ['websocket'], extraHeaders: { Cookie: client?.cookie() || '' }, reconnection: false });
  sockets.push(socket);
  const events = [];
  socket.onAny((name, payload) => events.push({ name, payload }));
  const ready = new Promise((resolve, reject) => {
    socket.on('hello', resolve);
    socket.on('connect_error', reject);
  });
  const waitFor = async (predicate, ms = 4000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = events.find(predicate);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error(`timed out waiting for event; saw: ${events.map((e) => e.name).join(', ') || 'nothing'}`);
      await sleep(15);
    }
  };
  return { socket, events, ready, waitFor };
}
const upsertOf = (id, version) => (e) => e.name === 'listing.upsert' && e.payload.listing.id === id && (version === undefined || e.payload.listing.version === version);

describe('live multi-user updates', () => {
  it('a new listing appears on every connected client without a refresh', async () => {
    const [a, b] = [live(ngo), live(donor2)];
    await Promise.all([a.ready, b.ready]);
    const listing = await postListing(donor, { title: 'Live feed trays' });
    for (const c of [a, b]) {
      const e = await c.waitFor(upsertOf(listing.id));
      expect(e.payload).toMatchObject({ created: true, listing: { title: 'Live feed trays', remainingMeals: 40, version: 1 } });
    }
  });

  it('a claim by one user updates the meal count for everyone else, with a higher version', async () => {
    const listing = await postListing(donor, { totalMeals: 40 });
    const watcher = live(donor2);
    await watcher.ready;
    await claim(ngo, listing.id, 15);
    const e = await watcher.waitFor(upsertOf(listing.id, 2));
    expect(e.payload.listing).toMatchObject({ remainingMeals: 25, status: 'PARTIALLY_CLAIMED', version: 2 });
  });

  it('deleting a listing removes it from other clients', async () => {
    const listing = await postListing(donor);
    const watcher = live(ngo);
    await watcher.ready;
    await donor.del(`/listings/${listing.id}`);
    await watcher.waitFor((e) => e.name === 'listing.removed' && e.payload.id === listing.id);
  });

  it('events from a burst of changes carry strictly increasing versions (so clients can order them)', async () => {
    const listing = await postListing(donor, { totalMeals: 40 });
    const watcher = live(ngo);
    await watcher.ready;
    let version = 1;
    for (const total of [41, 42, 43, 44, 45]) {
      const res = await donor.patch(`/listings/${listing.id}`, { expectedVersion: version, totalMeals: total });
      version = res.body.listing.version;
    }
    await watcher.waitFor(upsertOf(listing.id, 6));
    const versions = watcher.events.filter(upsertOf(listing.id)).map((e) => e.payload.listing.version);
    expect(versions.at(-1)).toBe(6);
    expect(versions.every((v, i) => i === 0 || v >= versions[i - 1])).toBe(true);
    // The last event always matches the database: no client can be left behind.
    const last = watcher.events.filter(upsertOf(listing.id)).at(-1).payload.listing;
    expect(last.totalMeals).toBe((await dbListing(listing.id)).total_meals);
  });

  it('a rolled-back change is never broadcast', async () => {
    const listing = await postListing(donor);
    const watcher = live(ngo);
    await watcher.ready;
    await expect(
      withTransaction(async (tx) => {
        await tx.query('UPDATE listings SET remaining_meals = 1, version = version + 1 WHERE id = $1', [listing.id]);
        tx.notify({ t: 'listing', id: listing.id });
        throw new Error('fail after the write and the notify');
      }),
    ).rejects.toThrow('fail after');
    await sleep(300);
    expect(watcher.events.filter(upsertOf(listing.id))).toHaveLength(0);
    expect((await dbListing(listing.id)).remaining_meals).toBe(40);
  });
});

describe('conflict detection: two users update the same record', () => {
  it('a stale edit is rejected with 409 and the latest data, and nothing is overwritten', async () => {
    const listing = await postListing(donor, { title: 'Conflict trays', totalMeals: 50 });
    // Both staff members load version 1. Farhana saves first.
    const first = await donor.patch(`/listings/${listing.id}`, { expectedVersion: 1, totalMeals: 45 });
    expect(first.status).toBe(200);
    // Tanvir, still looking at version 1, saves a different change.
    const stale = await donor2.patch(`/listings/${listing.id}`, { expectedVersion: 1, title: 'Conflict trays (Tanvir)' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.error.details).toMatchObject({
      yourVersion: 1,
      current: { version: 2, totalMeals: 45, title: 'Conflict trays' },
      lastChange: { actor: 'Farhana Akter (donor)', action: 'listing.updated' },
    });
    expect(await dbListing(listing.id)).toMatchObject({ title: 'Conflict trays', total_meals: 45, version: 2 });

    // Tanvir merges onto the latest version and retries: both changes survive.
    const merged = await donor2.patch(`/listings/${listing.id}`, { expectedVersion: 2, title: 'Conflict trays (Tanvir)' });
    expect(merged.body.listing).toMatchObject({ title: 'Conflict trays (Tanvir)', totalMeals: 45, version: 3 });
  });

  it('truly simultaneous edits: exactly one wins, every time', async () => {
    for (let round = 0; round < 8; round++) {
      const listing = await postListing(donor, { totalMeals: 50 });
      const [a, b] = await Promise.all([
        donor.patch(`/listings/${listing.id}`, { expectedVersion: 1, totalMeals: 45 }),
        donor2.patch(`/listings/${listing.id}`, { expectedVersion: 1, totalMeals: 60 }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const winner = a.status === 200 ? a : b;
      const row = await dbListing(listing.id);
      expect(row.version).toBe(2);
      expect(row.total_meals).toBe(winner.body.listing.totalMeals); // the loser did not overwrite the winner
    }
  });

  it('an edit based on data from before a claim is also a conflict', async () => {
    const listing = await postListing(donor, { totalMeals: 40 });
    await claim(ngo, listing.id, 30); // bumps the version to 2
    const stale = await donor.patch(`/listings/${listing.id}`, { expectedVersion: 1, totalMeals: 20 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.current).toMatchObject({ remainingMeals: 10, version: 2 });
    expect(stale.body.error.details.lastChange.actor).toBe('Shirin Sultana (ngo)');
  });

  it('a stale cancel is a conflict too', async () => {
    const listing = await postListing(donor);
    await donor2.patch(`/listings/${listing.id}`, { expectedVersion: 1, totalMeals: 41 });
    expect((await donor.post(`/listings/${listing.id}/cancel`, { expectedVersion: 1 })).status).toBe(409);
    expect((await donor.post(`/listings/${listing.id}/cancel`, { expectedVersion: 2 })).status).toBe(200);
  });

  it('both editors hear about the winning save in real time', async () => {
    const listing = await postListing(donor, { totalMeals: 50 });
    const [a, b] = [live(donor), live(donor2)];
    await Promise.all([a.ready, b.ready]);
    await Promise.all([
      donor.patch(`/listings/${listing.id}`, { expectedVersion: 1, totalMeals: 45 }),
      donor2.patch(`/listings/${listing.id}`, { expectedVersion: 1, totalMeals: 60 }),
    ]);
    const [ea, eb] = await Promise.all([a.waitFor(upsertOf(listing.id, 2)), b.waitFor(upsertOf(listing.id, 2))]);
    expect(ea.payload.listing.totalMeals).toBe(eb.payload.listing.totalMeals); // one shared truth
  });

  it('shows who else has the listing open for editing', async () => {
    const listing = await postListing(donor);
    const [a, b, outsider] = [live(donor), live(donor2), live(ngo)];
    await Promise.all([a.ready, b.ready, outsider.ready]);
    a.socket.emit('presence:editing', { listingId: listing.id, editing: true });
    const seen = await b.waitFor((e) => e.name === 'presence.editing' && e.payload.listingId === listing.id);
    expect(seen.payload.editors.map((e) => e.name)).toEqual(['Farhana Akter']);
    outsider.socket.emit('presence:editing', { listingId: listing.id, editing: true }); // not this org: ignored
    a.socket.close();
    await b.waitFor((e) => e.name === 'presence.editing' && e.payload.editors.length === 0);
    expect(outsider.events.some((e) => e.name === 'presence.editing')).toBe(false);
  });
});

describe('conflict detection also covers organization details', () => {
  // Farhana (donor) and Tanvir (donor2) both work at Shapla Kitchen.
  const myOrg = async (c) => (await c.get('/org')).body.org;
  const dbOrg = async () => (await query('SELECT * FROM organizations WHERE id = $1', [seedId('org:shapla')])).rows[0];

  it('a stale save by a colleague is rejected with 409 and the latest data, and nothing is overwritten', async () => {
    const v = (await myOrg(donor)).version;
    const first = await donor.patch('/org', { expectedVersion: v, address: 'House 14A, Road 7, Dhanmondi, Dhaka' });
    expect(first.status).toBe(200);
    expect(first.body.org.version).toBe(v + 1);

    // Tanvir still has the old version open and saves a different field.
    const stale = await donor2.patch('/org', { expectedVersion: v, lat: 23.75 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.error.details).toMatchObject({
      yourVersion: v,
      current: { version: v + 1, address: 'House 14A, Road 7, Dhanmondi, Dhaka', lat: 23.7461 },
      lastChange: { actor: 'Farhana Akter (donor)', action: 'org.updated' },
    });
    expect(await dbOrg()).toMatchObject({ address: 'House 14A, Road 7, Dhanmondi, Dhaka', lat: 23.7461, version: v + 1 });

    // He merges onto the latest version and retries: both changes survive.
    const merged = await donor2.patch('/org', { expectedVersion: v + 1, lat: 23.75 });
    expect(merged.body.org).toMatchObject({ address: 'House 14A, Road 7, Dhanmondi, Dhaka', lat: 23.75, version: v + 2 });
  });

  it('truly simultaneous saves by two staff: exactly one wins, every time', async () => {
    for (let round = 0; round < 6; round++) {
      const v = (await myOrg(donor)).version;
      const [a, b] = await Promise.all([
        donor.patch('/org', { expectedVersion: v, address: `Kitchen entrance A, round ${round}, Dhaka` }),
        donor2.patch('/org', { expectedVersion: v, address: `Kitchen entrance B, round ${round}, Dhaka` }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const winner = a.status === 200 ? a : b;
      const row = await dbOrg();
      expect(row.version).toBe(v + 1);
      expect(row.address).toBe(winner.body.org.address); // the loser did not overwrite the winner
    }
  });

  it('a change by an admin is detected too, and the edit succeeds on the new version', async () => {
    const admin = await s.as('admin');
    const v = (await myOrg(donor)).version;
    await admin.post(`/admin/organizations/${seedId('org:shapla')}/status`, { status: 'SUSPENDED' });
    await admin.post(`/admin/organizations/${seedId('org:shapla')}/status`, { status: 'VERIFIED' });

    const stale = await donor.patch('/org', { expectedVersion: v, lng: 90.375 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details).toMatchObject({ current: { version: v + 2, status: 'VERIFIED' }, lastChange: { action: 'org.verified' } });
    const retry = await donor.patch('/org', { expectedVersion: v + 2, lng: 90.375 });
    expect(retry.body.org).toMatchObject({ lng: 90.375, status: 'VERIFIED', version: v + 3 });
  });

  it('the version is required, and a save that changes nothing does not bump it', async () => {
    const org = await myOrg(donor);
    const missing = await donor.patch('/org', { address: 'No version given, Dhaka' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.fieldErrors).toHaveProperty('expectedVersion');
    const same = await donor.patch('/org', { expectedVersion: org.version, address: org.address, lat: org.lat });
    expect(same.status).toBe(200);
    expect((await dbOrg()).version).toBe(org.version);
  });

  it('colleagues hear about the change in real time', async () => {
    const colleague = live(donor2);
    const outsider = live(ngo);
    await Promise.all([colleague.ready, outsider.ready]);
    const v = (await myOrg(donor)).version;
    await donor.patch('/org', { expectedVersion: v, address: 'House 14, Road 7, Dhanmondi, Dhaka' });
    const e = await colleague.waitFor((x) => x.name === 'org.changed');
    expect(e.payload).toEqual({ orgId: seedId('org:shapla') });
    expect(outsider.events.some((x) => x.name === 'org.changed')).toBe(false); // other organizations are not told
  });
});

describe('realtime access control', () => {
  it('refuses a socket without a valid session', async () => {
    await expect(live(null).ready).rejects.toThrow(/UNAUTHENTICATED/);
    const fake = s.client();
    fake.setCookie('rp_session=forged-token');
    await expect(live(fake).ready).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('claim events reach only the parties involved and carry no private data', async () => {
    const listing = await postListing(donor);
    const [ours, theirs, donorSide, volunteer] = [live(ngo), live(await s.as('ngo2')), live(donor2), live(await s.as('volunteer'))];
    await Promise.all([ours.ready, theirs.ready, donorSide.ready, volunteer.ready]);
    const created = await claim(ngo, listing.id, 10);
    const hint = await ours.waitFor((e) => e.name === 'claim.changed');
    await donorSide.waitFor((e) => e.name === 'claim.changed');
    expect(hint.payload).toEqual({ claimId: created.body.claim.id, listingId: listing.id }); // ids only
    await theirs.waitFor(upsertOf(listing.id, 2)); // the other NGO sees the public meal count change...
    expect(theirs.events.some((e) => e.name === 'claim.changed')).toBe(false); // ...but nothing about the claim
    const board = await volunteer.waitFor((e) => e.name === 'pickup.board');
    expect(board.payload).toEqual({ claimId: created.body.claim.id, listingId: listing.id });
    expect(theirs.events.some((e) => e.name === 'pickup.board')).toBe(false);
  });

  it('suspending a user disconnects their live session at once', async () => {
    const victim = await s.as('volunteer2');
    const conn = live(victim);
    await conn.ready;
    const dropped = new Promise((resolve) => conn.socket.on('disconnect', resolve));
    const admin = await s.as('admin');
    await admin.post(`/admin/users/${seedId('user:volunteer2')}/status`, { status: 'SUSPENDED' });
    await expect(Promise.race([dropped, sleep(4000).then(() => 'timeout')])).resolves.not.toBe('timeout');
    await expect(live(victim).ready).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('tells clients to resynchronise after a demo reset, and the snapshot is complete', async () => {
    const watcher = live(ngo);
    await watcher.ready;
    const admin = await s.as('admin');
    await admin.post('/admin/demo/reset');
    await watcher.waitFor((e) => e.name === 'sync.required');
    const snapshot = (await ngo.get('/listings?pageSize=50')).body;
    expect(snapshot.total).toBe((await query(`SELECT count(*)::int AS n FROM listings WHERE status IN ('POSTED', 'PARTIALLY_CLAIMED') AND safe_until > now()`)).rows[0].n);
  });
});
