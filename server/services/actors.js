import { query } from '../db/pool.js';

/** Loads a user in the same shape the auth middleware puts on req.user. */
export async function findActor(userId) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.org_id,
            o.type AS org_type, o.name AS org_name, o.status AS org_status,
            o.daily_capacity_meals, o.lat, o.lng, o.address
       FROM users u LEFT JOIN organizations o ON o.id = u.org_id WHERE u.id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r) throw new Error(`Demo account ${userId} is missing. Reset the demo data.`);
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    orgId: r.org_id,
    org: r.org_id
      ? { id: r.org_id, type: r.org_type, name: r.org_name, status: r.org_status, dailyCapacityMeals: r.daily_capacity_meals, lat: r.lat, lng: r.lng, address: r.address }
      : null,
  };
}
