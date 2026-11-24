import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { query } from '../db/pool.js';

// Sessions are server-side rows, not self-contained tokens. The browser holds a
// random 256-bit value in an httpOnly cookie; the database stores only its
// SHA-256 hash. Every request re-reads the user, so logout, suspension and
// role or verification changes take effect immediately.

export const hashPassword = (password) => bcrypt.hash(password, config.bcryptCost);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

// Compared against when the email is unknown, so response time does not reveal which emails exist.
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptCost);

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600_000);
  await query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, hashToken(token), expiresAt]);
  return { token, expiresAt };
}

/** Resolves a cookie value to the current user (with organization), or null. */
export async function findSessionUser(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.org_id,
            o.type AS org_type, o.name AS org_name, o.status AS org_status,
            o.daily_capacity_meals, o.lat AS org_lat, o.lng AS org_lng, o.address AS org_address
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN organizations o ON o.id = u.org_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const r = rows[0];
  if (!r || r.status !== 'ACTIVE') return null;
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    orgId: r.org_id,
    org: r.org_id
      ? {
          id: r.org_id,
          type: r.org_type,
          name: r.org_name,
          status: r.org_status,
          dailyCapacityMeals: r.daily_capacity_meals,
          lat: r.org_lat,
          lng: r.org_lng,
          address: r.org_address,
        }
      : null,
  };
}

export async function revokeSession(token) {
  if (!token) return;
  await query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)]);
}

export function sessionCookieOptions(expiresAt) {
  return {
    httpOnly: true, //            not readable from JavaScript (limits XSS impact)
    sameSite: 'lax', //           not sent on cross-site POSTs (CSRF defence, with the Origin check)
    secure: config.isProd, //     HTTPS only in production
    path: '/',
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}
