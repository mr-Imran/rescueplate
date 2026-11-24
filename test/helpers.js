import http from 'node:http';
import { createApp } from '../server/app.js';
import { migrate } from '../server/db/migrate.js';
import { pool, query } from '../server/db/pool.js';
import { resetDemoData, seedId } from '../server/db/seed.js';
import { startBus, stopBus } from '../server/realtime/bus.js';
import { createIo } from '../server/realtime/io.js';

export { query, seedId };

/** Boots the real app on a random port with freshly seeded demo data. */
export async function startTestServer({ realtime = false } = {}) {
  await migrate();
  await resetDemoData();
  const server = http.createServer(createApp());
  let io = null;
  if (realtime) {
    io = createIo(server);
    await startBus(io);
  }
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    io,
    client: () => makeClient(base),
    // Signs in as any seeded account (see server/db/seed.js) with the test-only password.
    as: async (key) => {
      const c = makeClient(base);
      const res = await c.post('/auth/login', { email: `${key}@rescueplate.demo`, password: 'test-only-password' });
      if (res.status !== 200) throw new Error(`login failed for ${key}: ${JSON.stringify(res.body)}`);
      return c;
    },
    close: async () => {
      if (io) {
        io.close();
        await stopBus();
      }
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}

/** Minimal HTTP client with a cookie jar, standing in for one browser. */
export function makeClient(base) {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie();
    for (const c of setCookie) if (c.startsWith('rp_session=')) cookie = c.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    return { status: res.status, body: json, text, headers: res.headers, setCookie };
  };
  return {
    get: (path, headers) => call('GET', path, undefined, headers),
    post: (path, body = {}, headers) => call('POST', path, body, headers),
    patch: (path, body, headers) => call('PATCH', path, body, headers),
    del: (path, headers) => call('DELETE', path, undefined, headers),
    cookie: () => cookie,
    setCookie: (value) => {
      cookie = value;
    },
  };
}

let counter = 0;
export const idemKey = () => `test-key-${Date.now()}-${counter++}`;

/** Claims meals as the given NGO client. */
export const claim = (client, listingId, meals, { allowPartial = true, key = idemKey() } = {}) =>
  client.post(`/listings/${listingId}/claims`, { meals, allowPartial }, { 'Idempotency-Key': key });

/** A valid new-listing payload (prepared 10 minutes ago, safe for 2 more hours). */
export const listingInput = (overrides = {}) => ({
  title: `Test listing ${counter++}`,
  description: 'Created by the test suite',
  foodType: 'cooked_meal',
  isVeg: true,
  totalMeals: 40,
  preparedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  safeUntil: new Date(Date.now() + 2 * 3600_000).toISOString(),
  ...overrides,
});

export async function postListing(donorClient, overrides) {
  const res = await donorClient.post('/listings', listingInput(overrides));
  if (res.status !== 201) throw new Error(`could not create listing: ${JSON.stringify(res.body)}`);
  return res.body.listing;
}

export const dbListing = async (id) => (await query('SELECT * FROM listings WHERE id = $1', [id])).rows[0];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
