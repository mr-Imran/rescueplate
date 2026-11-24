import { query } from '../db/pool.js';

// Conversion factors for the impact figures. They are estimates and are labelled as such in the UI.
export const KG_PER_MEAL = 0.5; //       roughly half a kilogram of food per meal
export const CO2E_PER_KG_FOOD = 2.5; //  kg CO2-equivalent avoided per kg of food kept out of landfill

async function safeTimezone(tz) {
  if (!tz || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return 'UTC';
  const { rowCount } = await query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [tz]);
  return rowCount > 0 ? tz : 'UTC';
}

/**
 * Impact dashboard. Everything is aggregated in SQL from the live tables.
 * scope = 'all' (network-wide) or 'mine' (the viewer's organization or, for a volunteer, their own deliveries).
 */
export async function impactStats(viewer, { days, scope, tz }) {
  const zone = await safeTimezone(tz);
  const mine = scope === 'mine' && viewer.role !== 'admin';

  // $1 = days. $2 = the scope id (only when scope is "mine").
  // Scope filters are fixed SQL fragments; user-derived values are always bound parameters.
  const params = [days];
  let listingScope = 'true';
  let claimScope = 'true';
  if (mine && viewer.role === 'donor') {
    params.push(viewer.orgId);
    listingScope = 'l.donor_org_id = $2';
    claimScope = 'l.donor_org_id = $2';
  } else if (mine && viewer.role === 'ngo') {
    params.push(viewer.orgId);
    listingScope = 'EXISTS (SELECT 1 FROM claims cx WHERE cx.listing_id = l.id AND cx.ngo_org_id = $2)';
    claimScope = 'c.ngo_org_id = $2';
  } else if (mine && viewer.role === 'volunteer') {
    params.push(viewer.id);
    listingScope = '$2::uuid IS NULL'; // listing-level figures do not apply to a single volunteer
    claimScope = `EXISTS (SELECT 1 FROM pickups pk WHERE pk.claim_id = c.id AND pk.volunteer_id = $2 AND pk.status = 'DELIVERED')`;
  }
  const since = 'app_now() - make_interval(days => $1)';
  const delivered = `FROM claims c JOIN listings l ON l.id = c.listing_id
                    WHERE c.status = 'DELIVERED' AND c.closed_at >= ${since} AND ${claimScope}`;

  const totals = await query(
    `SELECT
       (SELECT COALESCE(sum(c.meals), 0)::int ${delivered}) AS meals_rescued,
       (SELECT count(*)::int ${delivered}) AS deliveries,
       (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (c.closed_at - c.created_at)) / 60) ${delivered}) AS median_minutes,
       (SELECT COALESCE(sum(c.meals), 0)::int FROM claims c JOIN listings l ON l.id = c.listing_id
         WHERE c.status IN ('CLAIMED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP') AND ${claimScope}) AS meals_in_progress,
       (SELECT COALESCE(sum(l.remaining_meals), 0)::int FROM listings l
         WHERE l.status = 'EXPIRED' AND l.safe_until >= ${since} AND ${listingScope}) AS meals_expired,
       (SELECT COALESCE(sum(l.remaining_meals), 0)::int FROM listings l
         WHERE l.status IN ('POSTED', 'PARTIALLY_CLAIMED') AND l.safe_until > app_now() AND ${listingScope}) AS meals_available,
       (SELECT count(*)::int FROM listings l WHERE l.created_at >= ${since} AND ${listingScope}) AS listings_posted`,
    params,
  );

  // One row per calendar day in the viewer's timezone, including days with no activity.
  const tzRef = `$${params.length + 1}`;
  const daily = await query(
    `WITH days AS (
       SELECT generate_series(
                date_trunc('day', app_now() AT TIME ZONE ${tzRef}) - make_interval(days => $1 - 1),
                date_trunc('day', app_now() AT TIME ZONE ${tzRef}), interval '1 day') AS day
     ), rescued AS (
       SELECT date_trunc('day', c.closed_at AT TIME ZONE ${tzRef}) AS day, sum(c.meals)::int AS meals
         FROM claims c JOIN listings l ON l.id = c.listing_id
        WHERE c.status = 'DELIVERED' AND ${claimScope} GROUP BY 1
     ), expired AS (
       SELECT date_trunc('day', l.safe_until AT TIME ZONE ${tzRef}) AS day, sum(l.remaining_meals)::int AS meals
         FROM listings l WHERE l.status = 'EXPIRED' AND ${listingScope} GROUP BY 1
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(r.meals, 0) AS rescued, COALESCE(e.meals, 0) AS expired
       FROM days d LEFT JOIN rescued r ON r.day = d.day LEFT JOIN expired e ON e.day = d.day
      ORDER BY d.day`,
    [...params, zone],
  );

  const leaders = (orgColumn) =>
    query(
      `SELECT o.name, sum(c.meals)::int AS meals, count(*)::int AS deliveries
         FROM claims c JOIN listings l ON l.id = c.listing_id JOIN organizations o ON o.id = ${orgColumn}
        WHERE c.status = 'DELIVERED' AND c.closed_at >= ${since} AND ${claimScope}
        GROUP BY o.id, o.name ORDER BY meals DESC, o.name LIMIT 5`,
      params,
    );
  const [topDonors, topNgos, byType] = await Promise.all([
    leaders('l.donor_org_id'),
    leaders('c.ngo_org_id'),
    query(`SELECT l.food_type, sum(c.meals)::int AS rescued ${delivered} GROUP BY l.food_type ORDER BY rescued DESC, l.food_type`, params),
  ]);

  const t = totals.rows[0];
  const decided = t.meals_rescued + t.meals_expired;
  return {
    scope: mine ? 'mine' : 'all',
    days,
    timezone: zone,
    totals: {
      mealsRescued: t.meals_rescued,
      deliveries: t.deliveries,
      mealsInProgress: t.meals_in_progress,
      mealsExpired: t.meals_expired,
      mealsAvailable: t.meals_available,
      listingsPosted: t.listings_posted,
      // Share of meals with a final outcome that reached people rather than the bin.
      rescueRate: decided > 0 ? Math.round((t.meals_rescued / decided) * 1000) / 10 : null,
      medianMinutesToDeliver: t.median_minutes === null ? null : Math.round(t.median_minutes),
      kgDiverted: Math.round(t.meals_rescued * KG_PER_MEAL),
      co2eAvoidedKg: Math.round(t.meals_rescued * KG_PER_MEAL * CO2E_PER_KG_FOOD),
    },
    assumptions: { kgPerMeal: KG_PER_MEAL, co2ePerKgFood: CO2E_PER_KG_FOOD },
    daily: daily.rows,
    topDonors: topDonors.rows,
    topNgos: topNgos.rows,
    byFoodType: byType.rows.map((r) => ({ foodType: r.food_type, rescued: r.rescued })),
  };
}

/**
 * Ledger check used by the demo console and the tests. For every listing:
 *   remaining = total - meals held by CLAIMED / VOLUNTEER_ASSIGNED / PICKED_UP / DELIVERED claims
 * Any mismatch would mean meals were created or lost.
 */
export async function integrityCheck(db = { query }) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS listings,
            count(*) FILTER (WHERE l.remaining_meals <> l.total_meals - COALESCE(h.held, 0))::int AS mismatches,
            count(*) FILTER (WHERE l.remaining_meals < 0)::int AS negative
       FROM listings l
       LEFT JOIN (SELECT listing_id, sum(meals)::int AS held FROM claims
                   WHERE status IN ('CLAIMED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP', 'DELIVERED')
                   GROUP BY listing_id) h ON h.listing_id = l.id`,
  );
  return { ...rows[0], ok: rows[0].mismatches === 0 && rows[0].negative === 0 };
}
