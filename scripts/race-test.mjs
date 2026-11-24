#!/usr/bin/env node
// Black-box concurrency test over real HTTP, for a local or a deployed instance.
//
//   npm run race                                   (http://localhost:3000)
//   npm run race -- https://your-app.example.com   (the live deployment)
//   DEMO_ACCESS_CODE=... npm run race -- <url>     (if the deployment requires a code)
//
// It signs in as the demo donor and two demo NGOs, then checks:
//   1. the last meals are never oversold when claims arrive together;
//   2. one request repeated with the same Idempotency-Key is executed once;
//   3. two simultaneous edits of one listing produce one winner and one 409.
// Needs DEMO_MODE on the target. Uses only Node's built-in fetch.
import crypto from 'node:crypto';

const base = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const accessCode = process.env.DEMO_ACCESS_CODE || undefined;

async function signIn(persona) {
  const res = await fetch(`${base}/api/auth/demo-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona, accessCode }) });
  if (!res.ok) throw new Error(`Could not sign in as ${persona}: HTTP ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('rp_session=')).split(';')[0];
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(`${base}/api${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, replayed: r.headers.get('Idempotent-Replayed') === 'true', body: await r.json().catch(() => null) };
  };
  return { persona, call };
}

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

async function newListing(donor, totalMeals) {
  const now = (await donor.call('GET', '/me')).body.serverNow; // respect a fast-forwarded demo clock
  const res = await donor.call('POST', '/listings', {
    title: `[Race test] ${crypto.randomUUID().slice(0, 8)}`,
    description: 'Created by scripts/race-test.mjs',
    foodType: 'cooked_meal',
    isVeg: true,
    totalMeals,
    preparedAt: new Date(now - 10 * 60_000).toISOString(),
    safeUntil: new Date(now + 2 * 3600_000).toISOString(),
  });
  if (res.status !== 201) throw new Error(`Could not create a listing: ${JSON.stringify(res.body)}`);
  return res.body.listing;
}
const claim = (ngo, listingId, meals, key = crypto.randomUUID()) => ngo.call('POST', `/listings/${listingId}/claims`, { meals, allowPartial: true }, { 'Idempotency-Key': key });
const current = async (donor, id) => (await donor.call('GET', `/listings/${id}`)).body.listing;

async function cleanup(donor, ngos, listingId) {
  for (const ngo of ngos) {
    const open = (await ngo.call('GET', `/claims?listingId=${listingId}`)).body.items.filter((c) => c.status === 'CLAIMED');
    for (const c of open) await ngo.call('POST', `/claims/${c.id}/cancel`);
  }
  await donor.call('POST', `/listings/${listingId}/cancel`, {});
}

console.log(`RescuePlate concurrency test against ${base}\n`);
const [donor, donor2, ngoA, ngoB] = await Promise.all(['donor', 'donor2', 'ngo', 'ngo2'].map(signIn));

console.log('1. Two NGOs request the last meals at the same instant (10 rounds)');
let oversold = 0;
let unbalanced = 0;
for (let round = 0; round < 10; round++) {
  const listing = await newListing(donor, 10);
  const [a, b] = await Promise.all([claim(ngoA, listing.id, 7), claim(ngoB, listing.id, 7)]);
  const granted = [a, b].reduce((sum, r) => sum + (r.status === 201 ? r.body.decision.granted : 0), 0);
  const after = await current(donor, listing.id);
  if (granted > 10 || after.remainingMeals < 0) oversold += 1;
  if (granted + after.remainingMeals !== 10) unbalanced += 1;
  await cleanup(donor, [ngoA, ngoB], listing.id);
}
check('never granted more than was available', oversold === 0, `${oversold} of 10 rounds oversold`);
check('granted + remaining always equals the total', unbalanced === 0, `${unbalanced} of 10 rounds unbalanced`);

console.log('\n2. One claim sent 8 times at once with the same Idempotency-Key');
{
  const listing = await newListing(donor, 30);
  const key = crypto.randomUUID();
  const results = await Promise.all(Array.from({ length: 8 }, () => claim(ngoA, listing.id, 10, key)));
  const after = await current(donor, listing.id);
  check('every copy got the same successful answer', results.every((r) => r.status === 201) && new Set(results.map((r) => r.body.claim.id)).size === 1);
  check('the claim was executed exactly once', results.filter((r) => !r.replayed).length === 1 && after.remainingMeals === 20, `${after.remainingMeals} of 30 meals left`);
  await cleanup(donor, [ngoA], listing.id);
}

console.log('\n3. Two staff members save different edits of the same version (10 rounds)');
let badRounds = 0;
for (let round = 0; round < 10; round++) {
  const listing = await newListing(donor, 50);
  const [a, b] = await Promise.all([
    donor.call('PATCH', `/listings/${listing.id}`, { expectedVersion: 1, totalMeals: 45 }),
    donor2.call('PATCH', `/listings/${listing.id}`, { expectedVersion: 1, totalMeals: 60 }),
  ]);
  const statuses = [a.status, b.status].sort().join(',');
  const winner = a.status === 200 ? a : b;
  const after = await current(donor, listing.id);
  if (statuses !== '200,409' || after.totalMeals !== winner.body.listing.totalMeals || after.version !== 2) badRounds += 1;
  await cleanup(donor, [], listing.id);
}
check('exactly one save wins and the other gets 409 VERSION_CONFLICT', badRounds === 0, `${badRounds} of 10 rounds wrong`);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
