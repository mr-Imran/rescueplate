// Demo data: organizations, one account per role, live listings in every state
// and two weeks of history for the impact dashboard. Deterministic (fixed ids,
// seeded random numbers), so "Reset demo data" always restores the same world.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { hashPassword } from '../auth/sessions.js';
import { query, withTransaction } from './pool.js';

/** Stable UUID derived from a label, so seeded rows keep their ids across resets. */
export const seedId = (label) => {
  const h = crypto.createHash('md5').update(`rescueplate:${label}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// One-click personas shown on the sign-in page in demo mode.
export const PERSONAS = [
  { key: 'donor', label: 'Donor', name: 'Farhana Akter', org: 'Shapla Kitchen', hint: 'Posts surplus food' },
  { key: 'donor2', label: 'Donor (2nd staff)', name: 'Tanvir Ahmed', org: 'Shapla Kitchen', hint: 'Same kitchen - for edit conflicts' },
  { key: 'ngo', label: 'NGO', name: 'Shirin Sultana', org: 'Alor Thikana Shelter', hint: 'Claims food' },
  { key: 'ngo2', label: 'NGO (2nd)', name: 'Mahmudul Hasan', org: 'Sobar Jonno Khabar', hint: 'Competes for the same food' },
  { key: 'volunteer', label: 'Volunteer', name: 'Sabbir Hossain', org: null, hint: 'Collects and delivers' },
  { key: 'admin', label: 'Admin', name: 'Admin', org: null, hint: 'Verifies, audits, demo console' },
];

export const personaEmail = (key) => `${key}@rescueplate.demo`;

// The demo network is set in Dhaka. Organizations are fictional; the coordinates are
// real neighbourhoods, so the distances shown in the app are realistic.
const DONORS = [
  { key: 'shapla', name: 'Shapla Kitchen', address: 'House 14, Road 7, Dhanmondi, Dhaka', lat: 23.7461, lng: 90.3742, status: 'VERIFIED' },
  { key: 'nobanno', name: 'Nobanno Convention Hall', address: 'Plot 22, Gulshan Avenue, Gulshan-1, Dhaka', lat: 23.7925, lng: 90.4078, status: 'VERIFIED' },
  { key: 'canteen', name: 'Shahbag Campus Hall Canteen', address: 'Hall Dining Block C, Shahbag, Dhaka', lat: 23.7386, lng: 90.3956, status: 'VERIFIED' },
  { key: 'bakery', name: 'Ruti Ghor Bakery', address: '8 Tajmahal Road, Mohammadpur, Dhaka', lat: 23.7658, lng: 90.3584, status: 'VERIFIED' },
  { key: 'padma', name: 'Padma Par Restaurant', address: 'House 3, Road 12, Sector 7, Uttara, Dhaka', lat: 23.8759, lng: 90.3795, status: 'PENDING' },
];
const NGOS = [
  { key: 'alor', name: 'Alor Thikana Shelter', address: 'House 55, Block D, Lalmatia, Dhaka', lat: 23.754, lng: 90.369, cap: 150, status: 'VERIFIED' },
  { key: 'sobar', name: 'Sobar Jonno Khabar', address: 'Road 9, Section 10, Mirpur, Dhaka', lat: 23.8069, lng: 90.3687, cap: 120, status: 'VERIFIED' },
  { key: 'stars', name: 'Chhoto Tara Shishu Nibash', address: 'House 31, Road 3, Shyamoli, Dhaka', lat: 23.774, lng: 90.3654, cap: 60, status: 'VERIFIED' },
  { key: 'eldercare', name: 'Shanti Nibash Probin Kendro', address: 'Plot 77, Agargaon, Dhaka', lat: 23.7779, lng: 90.3794, cap: 80, status: 'VERIFIED' },
  { key: 'nightmeal', name: 'Raater Khabar Project', address: 'Station Road, Kamalapur, Dhaka', lat: 23.733, lng: 90.426, cap: 200, status: 'VERIFIED' },
  { key: 'womens', name: "Nirapod Ashroy Women's Shelter", address: 'House 18, Block C, Khilgaon, Dhaka', lat: 23.7509, lng: 90.427, cap: 70, status: 'VERIFIED' },
  { key: 'streetkids', name: 'Khola Duar Youth Centre', address: '40 Lalbagh Road, Old Dhaka', lat: 23.7189, lng: 90.3882, cap: 90, status: 'VERIFIED' },
  { key: 'relief', name: 'Protibeshi Relief Circle', address: 'House 6, Link Road, Middle Badda, Dhaka', lat: 23.7805, lng: 90.4267, cap: 100, status: 'VERIFIED' },
  { key: 'newngo', name: 'Notun Shuru Foundation', address: 'House 12, Block B, Bashundhara R/A, Dhaka', lat: 23.8195, lng: 90.4526, cap: 50, status: 'PENDING' },
];
const USERS = [
  { key: 'donor', name: 'Farhana Akter', role: 'donor', org: 'shapla' },
  { key: 'donor2', name: 'Tanvir Ahmed', role: 'donor', org: 'shapla' },
  { key: 'nobanno', name: 'Nusrat Jahan', role: 'donor', org: 'nobanno' },
  { key: 'canteen', name: 'Rakib Hasan', role: 'donor', org: 'canteen' },
  { key: 'bakery', name: 'Sumaiya Islam', role: 'donor', org: 'bakery' },
  { key: 'padma', name: 'Arif Chowdhury', role: 'donor', org: 'padma' },
  { key: 'ngo', name: 'Shirin Sultana', role: 'ngo', org: 'alor' },
  { key: 'ngo2', name: 'Mahmudul Hasan', role: 'ngo', org: 'sobar' },
  ...['stars', 'eldercare', 'nightmeal', 'womens', 'streetkids', 'relief', 'newngo'].map((org, i) => ({
    key: org,
    name: ['Jannatul Ferdous', 'Abdul Karim', 'Sadia Rahman', 'Rokeya Begum', 'Shakil Mahmud', 'Taslima Khatun', 'Kamrul Islam'][i],
    role: 'ngo',
    org,
  })),
  { key: 'volunteer', name: 'Sabbir Hossain', role: 'volunteer' },
  { key: 'volunteer2', name: 'Mitu Akter', role: 'volunteer' },
  { key: 'volunteer3', name: 'Rafiq Uddin', role: 'volunteer' },
  { key: 'admin', name: 'Admin', role: 'admin' },
];

/** NGO users used as contenders by the demo console's race test. */
export const RACE_NGO_KEYS = ['ngo', 'ngo2', 'eldercare', 'womens', 'streetkids', 'stars', 'nightmeal', 'relief'];

// Small deterministic random generator (mulberry32).
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const HISTORY_TITLES = [
  ['Shobji khichuri trays', 'cooked_meal', true],
  ['Rice, dal and mixed shobji', 'cooked_meal', true],
  ['Morog polao', 'cooked_meal', false],
  ['Beef tehari', 'cooked_meal', false],
  ['Lunch buffet surplus', 'cooked_meal', false],
  ['Bread loaves and buns', 'bakery', true],
  ['Assorted pitha', 'bakery', true],
  ['Seasonal fruit crates', 'produce', true],
  ['Singara and samosa', 'cooked_meal', true],
  ['Mishti doi cups', 'dairy', true],
];

async function insertListing(tx, l) {
  await tx.query(
    `INSERT INTO listings (id, donor_org_id, created_by, title, description, food_type, is_veg, total_meals,
                           remaining_meals, prepared_at, safe_until, status, version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [l.id, l.donorOrgId, l.createdBy, l.title, l.description || '', l.foodType, l.isVeg, l.total, l.remaining, l.preparedAt, l.safeUntil, l.status, l.version || 1, l.createdAt, l.updatedAt || l.createdAt],
  );
}

async function insertClaim(tx, c) {
  await tx.query(
    `INSERT INTO claims (id, listing_id, ngo_org_id, claimed_by, meals, status, handover_code,
                         awaiting_volunteer_since, created_at, updated_at, closed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [c.id, c.listingId, c.ngoOrgId, c.claimedBy, c.meals, c.status, c.code, c.awaiting || null, c.createdAt, c.closedAt || c.createdAt, c.closedAt || null],
  );
  if (c.pickup) {
    await tx.query(
      `INSERT INTO pickups (claim_id, volunteer_id, assigned_by, status, assigned_at, picked_up_at, delivered_at, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [c.id, c.pickup.volunteerId, c.claimedBy, c.pickup.status, c.pickup.assignedAt, c.pickup.pickedUpAt || null, c.pickup.deliveredAt || null, c.pickup.deliveredAt || null],
    );
  }
}

async function seedInto(tx) {
  const now = Date.now();
  const rand = rng(20260);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const code = () => String(between(0, 999999)).padStart(6, '0');
  const orgId = (key) => seedId(`org:${key}`);
  const userId = (key) => seedId(`user:${key}`);

  for (const d of DONORS) {
    await tx.query(
      `INSERT INTO organizations (id, type, name, address, lat, lng, status, join_code) VALUES ($1, 'donor', $2, $3, $4, $5, $6, $7)`,
      [orgId(d.key), d.name, d.address, d.lat, d.lng, d.status, seedId(`join:${d.key}`).slice(0, 10).replace('-', '').toUpperCase()],
    );
  }
  for (const n of NGOS) {
    await tx.query(
      `INSERT INTO organizations (id, type, name, address, lat, lng, daily_capacity_meals, status, join_code)
       VALUES ($1, 'ngo', $2, $3, $4, $5, $6, $7, $8)`,
      [orgId(n.key), n.name, n.address, n.lat, n.lng, n.cap, n.status, seedId(`join:${n.key}`).slice(0, 10).replace('-', '').toUpperCase()],
    );
  }
  // Demo accounts share DEMO_PASSWORD if it is set; otherwise each gets a random
  // password nobody knows and the accounts are reachable only via persona login.
  const sharedHash = config.demoPassword ? await hashPassword(config.demoPassword) : null;
  for (const u of USERS) {
    const hash = sharedHash || (await hashPassword(crypto.randomBytes(24).toString('base64url')));
    await tx.query('INSERT INTO users (id, name, email, password_hash, role, org_id) VALUES ($1, $2, $3, $4, $5, $6)', [
      userId(u.key),
      u.name,
      personaEmail(u.key),
      hash,
      u.role,
      u.org ? orgId(u.org) : null,
    ]);
  }

  const donorUser = { shapla: 'donor', nobanno: 'nobanno', canteen: 'canteen', bakery: 'bakery' };
  const activeDonors = ['shapla', 'nobanno', 'canteen', 'bakery'];
  const activeNgos = NGOS.filter((n) => n.status === 'VERIFIED').map((n) => n.key);
  const volunteers = ['volunteer', 'volunteer2', 'volunteer3'];

  // ---- History: 14 days of finished listings (older than 24h, so today's NGO capacity is untouched).
  let n = 0;
  for (let day = 14; day >= 2; day--) {
    const count = between(3, 6);
    for (let i = 0; i < count; i++) {
      const [title, foodType, isVeg] = pick(HISTORY_TITLES);
      const donor = pick(activeDonors);
      const total = between(2, 14) * 5;
      const createdAt = new Date(now - day * DAY + between(-5, 5) * HOUR);
      const safeUntil = new Date(createdAt.getTime() + between(2, 5) * HOUR);
      const id = seedId(`hist:${n++}`);
      const outcome = rand();
      // ~78% fully rescued, ~14% partly rescued then expired, ~8% never claimed.
      const claimedMeals = outcome < 0.78 ? total : outcome < 0.92 ? Math.max(5, Math.floor((total * between(3, 7)) / 10 / 5) * 5) : 0;
      await insertListing(tx, {
        id,
        donorOrgId: orgId(donor),
        createdBy: userId(donorUser[donor]),
        title,
        foodType,
        isVeg,
        total,
        remaining: total - claimedMeals,
        preparedAt: new Date(createdAt.getTime() - 30 * MIN),
        safeUntil,
        status: claimedMeals === total ? 'COMPLETED' : 'EXPIRED',
        version: claimedMeals > 0 ? 3 : 2,
        createdAt,
        updatedAt: safeUntil,
      });
      if (claimedMeals > 0) {
        const ngo = pick(activeNgos);
        const claimedAt = new Date(createdAt.getTime() + between(4, 40) * MIN);
        const deliveredAt = new Date(claimedAt.getTime() + between(35, 95) * MIN);
        await insertClaim(tx, {
          id: seedId(`hist-claim:${n}`),
          listingId: id,
          ngoOrgId: orgId(ngo),
          claimedBy: userId(ngo === 'alor' ? 'ngo' : ngo === 'sobar' ? 'ngo2' : ngo),
          meals: claimedMeals,
          status: 'DELIVERED',
          code: code(),
          createdAt: claimedAt,
          closedAt: deliveredAt,
          pickup: {
            volunteerId: userId(pick(volunteers)),
            status: 'DELIVERED',
            assignedAt: new Date(claimedAt.getTime() + 6 * MIN),
            pickedUpAt: new Date(claimedAt.getTime() + 25 * MIN),
            deliveredAt,
          },
        });
      }
    }
  }

  // ---- Live listings, relative to now, covering every state the UI can show.
  const live = [
    { key: 'khichuri', donor: 'shapla', title: 'Shobji khichuri - 60 plates', description: 'Packed in 6 steel trays. Bring your own containers if possible.', foodType: 'cooked_meal', isVeg: true, total: 60, madeAgo: 40 * MIN, safeIn: 2.5 * HOUR },
    { key: 'polao', donor: 'shapla', title: 'Morog polao with chicken roast', description: 'From the lunch service. Kept hot.', foodType: 'cooked_meal', isVeg: false, total: 40, madeAgo: 90 * MIN, safeIn: 55 * MIN },
    { key: 'feast', donor: 'nobanno', title: 'Wedding feast surplus', description: 'Plain polao, dal, mixed shobji and firni.', foodType: 'cooked_meal', isVeg: true, total: 120, madeAgo: 60 * MIN, safeIn: 3.5 * HOUR },
    { key: 'hall', donor: 'canteen', title: 'Hall dinner: rice, dal and alu bhorta', description: 'Collect from the kitchen back door, Dining Block C.', foodType: 'cooked_meal', isVeg: true, total: 80, madeAgo: 30 * MIN, safeIn: 4 * HOUR },
    { key: 'bread', donor: 'bakery', title: 'Day-end bread, buns and bakarkhani', description: 'About 45 portions of loaves, buns and bakarkhani.', foodType: 'bakery', isVeg: true, total: 45, madeAgo: 5 * HOUR, safeIn: 15 * HOUR },
    { key: 'fruit', donor: 'nobanno', title: 'Cut fruit platters from an event', description: 'Mango, papaya and banana. Kept chilled.', foodType: 'produce', isVeg: true, total: 30, madeAgo: 2 * HOUR, safeIn: 28 * MIN },
    { key: 'dim', donor: 'canteen', title: 'Dim bhuna with ruti', description: 'Egg curry and ruti, packed per person.', foodType: 'cooked_meal', isVeg: false, total: 25, madeAgo: 2 * HOUR, safeIn: 1.5 * HOUR },
    { key: 'bhaji', donor: 'shapla', title: 'Begun bhaji and luchi', description: 'Two large containers.', foodType: 'cooked_meal', isVeg: true, total: 35, madeAgo: 70 * MIN, safeIn: 3 * HOUR },
    { key: 'juice', donor: 'bakery', title: 'Sealed mango juice packs', description: 'Short-dated but unopened.', foodType: 'beverages', isVeg: true, total: 50, madeAgo: 6 * HOUR, safeIn: 30 * HOUR },
  ];
  // Open claims at different stages, so every role has something to act on immediately.
  const liveClaims = [
    { listing: 'khichuri', ngo: 'sobar', user: 'ngo2', meals: 20, status: 'CLAIMED', ago: 8 * MIN },
    { listing: 'feast', ngo: 'alor', user: 'ngo', meals: 40, status: 'VOLUNTEER_ASSIGNED', ago: 20 * MIN, volunteer: 'volunteer' },
    { listing: 'hall', ngo: 'alor', user: 'ngo', meals: 30, status: 'CLAIMED', ago: 4 * MIN },
    { listing: 'bhaji', ngo: 'stars', user: 'stars', meals: 35, status: 'PICKED_UP', ago: 45 * MIN, volunteer: 'volunteer2' },
    { listing: 'dim', ngo: 'eldercare', user: 'eldercare', meals: 10, status: 'CLAIMED', ago: 12 * MIN },
  ];
  for (const l of live) {
    const claimed = liveClaims.filter((c) => c.listing === l.key).reduce((s, c) => s + c.meals, 0);
    const remaining = l.total - claimed;
    await insertListing(tx, {
      id: seedId(`listing:${l.key}`),
      donorOrgId: orgId(l.donor),
      createdBy: userId(donorUser[l.donor]),
      title: l.title,
      description: l.description,
      foodType: l.foodType,
      isVeg: l.isVeg,
      total: l.total,
      remaining,
      preparedAt: new Date(now - l.madeAgo),
      safeUntil: new Date(now + l.safeIn),
      status: remaining === l.total ? 'POSTED' : remaining === 0 ? 'FULLY_CLAIMED' : 'PARTIALLY_CLAIMED',
      version: 1 + liveClaims.filter((c) => c.listing === l.key).length,
      createdAt: new Date(now - l.madeAgo + 10 * MIN),
    });
  }
  for (const c of liveClaims) {
    const createdAt = new Date(now - c.ago);
    await insertClaim(tx, {
      id: seedId(`claim:${c.listing}:${c.ngo}`),
      listingId: seedId(`listing:${c.listing}`),
      ngoOrgId: orgId(c.ngo),
      claimedBy: userId(c.user),
      meals: c.meals,
      status: c.status,
      code: code(),
      awaiting: c.status === 'CLAIMED' ? createdAt : null,
      createdAt,
      pickup: c.volunteer
        ? {
            volunteerId: userId(c.volunteer),
            status: c.status === 'PICKED_UP' ? 'PICKED_UP' : 'ASSIGNED',
            assignedAt: new Date(createdAt.getTime() + 5 * MIN),
            pickedUpAt: c.status === 'PICKED_UP' ? new Date(createdAt.getTime() + 25 * MIN) : null,
          }
        : null,
    });
  }

  // A few finished items from earlier today, so "today" is not empty on the dashboard.
  const today = [
    { key: 'today1', donor: 'nobanno', title: 'Breakfast surplus: paratha and shobji bhaji', total: 50, ngo: 'nightmeal', hoursAgo: 7 },
    { key: 'today2', donor: 'canteen', title: 'Hall lunch surplus: rice, dal and shobji', total: 70, ngo: 'relief', hoursAgo: 4 },
  ];
  for (const t of today) {
    const createdAt = new Date(now - t.hoursAgo * HOUR);
    const deliveredAt = new Date(createdAt.getTime() + 80 * MIN);
    const id = seedId(`listing:${t.key}`);
    await insertListing(tx, {
      id,
      donorOrgId: orgId(t.donor),
      createdBy: userId(donorUser[t.donor]),
      title: t.title,
      foodType: 'cooked_meal',
      isVeg: true,
      total: t.total,
      remaining: 0,
      preparedAt: new Date(createdAt.getTime() - 20 * MIN),
      safeUntil: new Date(createdAt.getTime() + 3 * HOUR),
      status: 'COMPLETED',
      version: 3,
      createdAt,
      updatedAt: deliveredAt,
    });
    await insertClaim(tx, {
      id: seedId(`claim:${t.key}`),
      listingId: id,
      ngoOrgId: orgId(t.ngo),
      claimedBy: userId(t.ngo),
      meals: t.total,
      status: 'DELIVERED',
      code: code(),
      createdAt: new Date(createdAt.getTime() + 10 * MIN),
      closedAt: deliveredAt,
      pickup: {
        volunteerId: userId('volunteer3'),
        status: 'DELIVERED',
        assignedAt: new Date(createdAt.getTime() + 15 * MIN),
        pickedUpAt: new Date(createdAt.getTime() + 40 * MIN),
        deliveredAt,
      },
    });
  }

  await tx.query(
    `INSERT INTO audit_log (actor_label, action, entity_type, meta) VALUES ('System', 'demo.seeded', 'system', $1)`,
    [JSON.stringify({ listings: live.length + today.length + n, note: 'Demo data created' })],
  );
}

/** Creates the demo data if the database is empty. Returns true if it seeded. */
export async function seedDemoIfEmpty() {
  const { rows } = await query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return false;
  await withTransaction(seedInto);
  return true;
}

/**
 * Restores the demo world. Runs in one transaction, so other users never see a
 * half-reset database. Existing sign-ins of demo personas keep working because
 * seeded user ids are stable and their sessions are carried across.
 */
export async function resetDemoData() {
  await withTransaction(async (tx) => {
    const sessions = await tx.query('SELECT * FROM sessions WHERE revoked_at IS NULL AND expires_at > now()');
    await tx.query('TRUNCATE audit_log, idempotency_keys, pickups, claims, listings, sessions, users, organizations RESTART IDENTITY CASCADE');
    await tx.query(`UPDATE app_settings SET value = '{"seconds": 0}' WHERE key = 'clock_offset'`);
    await seedInto(tx);
    for (const s of sessions.rows) {
      await tx.query(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
         SELECT $1, $2, $3, $4, $5 WHERE EXISTS (SELECT 1 FROM users WHERE id = $2)`,
        [s.id, s.user_id, s.token_hash, s.created_at, s.expires_at],
      );
    }
    tx.notify({ t: 'reset' });
  });
}

/** Optional real administrator for non-demo deployments (ADMIN_EMAIL / ADMIN_PASSWORD). */
export async function ensureAdminFromEnv() {
  if (!config.adminEmail || !config.adminPassword) return;
  const hash = await hashPassword(config.adminPassword);
  await query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ('Administrator', $1, $2, 'admin')
     ON CONFLICT (lower(email)) DO NOTHING`,
    [config.adminEmail, hash],
  );
}
