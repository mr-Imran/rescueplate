import crypto from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { createSession, DUMMY_HASH, hashPassword, verifyPassword } from '../auth/sessions.js';
import { audit } from '../lib/audit.js';
import { AppError, conflict, forbidden, notFound, unauthorized, validationError } from '../lib/errors.js';

const newJoinCode = () => crypto.randomBytes(5).toString('hex').toUpperCase();

export async function register(input) {
  const passwordHash = await hashPassword(input.password);
  try {
    return await withTransaction(async (tx) => {
      let orgId = null;
      if (input.role === 'donor' || input.role === 'ngo') {
        if (input.joinCode) {
          // Join an existing organization as staff, using the code its members can see.
          const org = await tx.query('SELECT id, type FROM organizations WHERE join_code = $1', [input.joinCode.toUpperCase()]);
          if (org.rowCount === 0 || org.rows[0].type !== input.role) {
            throw validationError({ joinCode: 'That join code does not match any organization of this type.' });
          }
          orgId = org.rows[0].id;
        } else {
          const o = input.org;
          const created = await tx.query(
            `INSERT INTO organizations (type, name, address, lat, lng, daily_capacity_meals, join_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [input.role, o.name, o.address, o.lat, o.lng, input.role === 'ngo' ? o.dailyCapacityMeals : null, newJoinCode()],
          );
          orgId = created.rows[0].id;
          tx.notify({ t: 'org', id: orgId });
        }
      }
      const user = await tx.query(
        'INSERT INTO users (name, email, password_hash, role, org_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, role',
        [input.name, input.email, passwordHash, input.role, orgId],
      );
      await audit(tx, user.rows[0], 'user.registered', 'user', user.rows[0].id, { after: { role: input.role, orgId } });
      return user.rows[0];
    });
  } catch (err) {
    // Unique indexes are the source of truth for duplicates, including two sign-ups racing each other.
    if (err.code === '23505' && err.constraint === 'users_email_key') {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Try signing in instead.', {
        fieldErrors: { email: 'An account with this email already exists.' },
      });
    }
    if (err.code === '23505' && err.constraint === 'organizations_type_name_key') {
      throw new AppError(409, 'ORG_NAME_TAKEN', 'An organization with this name is already registered.', {
        fieldErrors: { 'org.name': 'This organization is already registered. Ask a colleague for its join code.' },
      });
    }
    throw err;
  }
}

export async function login({ email, password }) {
  const { rows } = await query('SELECT id, password_hash, status FROM users WHERE lower(email) = lower($1)', [email]);
  const user = rows[0];
  // Always run one bcrypt comparison so timing does not reveal whether the email exists.
  const valid = await verifyPassword(password, user?.password_hash || DUMMY_HASH);
  if (!user || !valid) throw unauthorized('Email or password is incorrect.');
  if (user.status !== 'ACTIVE') throw forbidden('This account has been suspended. Contact an administrator.', 'ACCOUNT_SUSPENDED');
  return createSession(user.id);
}

/* ---------------------------- organization ---------------------------- */

const toOrg = (r) => ({
  id: r.id,
  type: r.type,
  name: r.name,
  address: r.address,
  lat: r.lat,
  lng: r.lng,
  dailyCapacityMeals: r.daily_capacity_meals,
  status: r.status,
  version: r.version,
  createdAt: r.created_at,
});

/** Who last changed this organization, for the conflict message. */
async function lastOrgChange(tx, orgId) {
  const { rows } = await tx.query(
    `SELECT actor_label, action, created_at FROM audit_log
      WHERE entity_type = 'organization' AND entity_id = $1 ORDER BY id DESC LIMIT 1`,
    [orgId],
  );
  return rows[0] ? { actor: rows[0].actor_label, action: rows[0].action, at: rows[0].created_at } : null;
}

export async function getMyOrg(viewer) {
  if (!viewer.orgId) throw notFound('Organization');
  const org = await query('SELECT * FROM organizations WHERE id = $1', [viewer.orgId]);
  const members = await query('SELECT id, name, email, status FROM users WHERE org_id = $1 ORDER BY created_at', [viewer.orgId]);
  let capacity = null;
  if (org.rows[0].type === 'ngo') {
    const used = await query(
      `SELECT COALESCE(sum(meals), 0)::int AS used FROM claims
        WHERE ngo_org_id = $1 AND status IN ('CLAIMED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP', 'DELIVERED')
          AND created_at > app_now() - interval '24 hours'`,
      [viewer.orgId],
    );
    capacity = { daily: org.rows[0].daily_capacity_meals, used: used.rows[0].used, left: Math.max(0, org.rows[0].daily_capacity_meals - used.rows[0].used) };
  }
  return { org: { ...toOrg(org.rows[0]), joinCode: org.rows[0].join_code }, members: members.rows, capacity };
}

/**
 * Staff edit their organization's details, with optimistic concurrency (the
 * same scheme as listings). The request carries the version the edit was based
 * on. If a colleague or an admin changed the organization in the meantime,
 * nothing is written and the caller gets 409 VERSION_CONFLICT with the latest
 * data, so the browser can merge instead of silently overwriting.
 */
export async function updateMyOrg(actor, { expectedVersion, ...patch }) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM organizations WHERE id = $1 FOR UPDATE', [actor.orgId]);
    const before = rows[0];
    if (!before) throw notFound('Organization');
    if (before.version !== expectedVersion) {
      throw conflict('VERSION_CONFLICT', 'Your organization was changed by someone else while you were editing. Review the latest version.', {
        current: toOrg(before),
        yourVersion: expectedVersion,
        lastChange: await lastOrgChange(tx, actor.orgId),
      });
    }
    if (patch.dailyCapacityMeals !== undefined && before.type !== 'ngo') {
      throw validationError({ dailyCapacityMeals: 'Only NGOs have a daily capacity.' });
    }
    const next = {
      address: patch.address ?? before.address,
      lat: patch.lat ?? before.lat,
      lng: patch.lng ?? before.lng,
      capacity: patch.dailyCapacityMeals ?? before.daily_capacity_meals,
    };
    const changed = next.address !== before.address || next.lat !== before.lat || next.lng !== before.lng || next.capacity !== before.daily_capacity_meals;
    if (!changed) return toOrg(before); // nothing to do; do not bump the version

    const updated = await tx.query(
      `UPDATE organizations SET address = $2, lat = $3, lng = $4, daily_capacity_meals = $5,
              version = version + 1, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [actor.orgId, next.address, next.lat, next.lng, next.capacity],
    );
    await audit(tx, actor, 'org.updated', 'organization', actor.orgId, { before: toOrg(before), after: toOrg(updated.rows[0]) });
    tx.notify({ t: 'org', id: actor.orgId });
    return toOrg(updated.rows[0]);
  });
}

/* -------------------------------- admin -------------------------------- */

export async function adminListOrganizations({ status, q }) {
  const where = [];
  const params = [];
  if (status) where.push(`o.status = $${params.push(status)}`);
  if (q) where.push(`o.name ILIKE $${params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`);
  const { rows } = await query(
    `SELECT o.*, (SELECT count(*)::int FROM users u WHERE u.org_id = o.id) AS members
       FROM organizations o ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (o.status = 'PENDING') DESC, o.created_at DESC LIMIT 200`,
    params,
  );
  return rows.map((r) => ({ ...toOrg(r), members: r.members }));
}

export async function adminSetOrgStatus(actor, orgId, status) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM organizations WHERE id = $1 FOR UPDATE', [orgId]);
    if (!rows[0]) throw notFound('Organization');
    if (rows[0].status === status) throw conflict('NO_CHANGE', `This organization is already ${status.toLowerCase()}.`);
    // Every change to the row bumps its version, so staff editing at the same moment are told about it.
    const updated = await tx.query('UPDATE organizations SET status = $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *', [orgId, status]);
    await audit(tx, actor, `org.${status.toLowerCase()}`, 'organization', orgId, { before: { status: rows[0].status }, after: { status } });
    tx.notify({ t: 'org', id: orgId });
    return toOrg(updated.rows[0]);
  });
}

export async function adminListUsers({ q }) {
  const params = [];
  const where = q ? `WHERE u.name ILIKE $${params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)} OR u.email ILIKE $1` : '';
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at, o.name AS org_name
       FROM users u LEFT JOIN organizations o ON o.id = u.org_id ${where}
      ORDER BY u.created_at DESC LIMIT 300`,
    params,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, status: r.status, orgName: r.org_name, createdAt: r.created_at }));
}

export async function adminSetUserStatus(actor, userId, status) {
  if (userId === actor.id) throw conflict('SELF_CHANGE', 'You cannot suspend your own account.');
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT id, name, role, status FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!rows[0]) throw notFound('User');
    if (rows[0].status === status) throw conflict('NO_CHANGE', `This account is already ${status.toLowerCase()}.`);
    await tx.query('UPDATE users SET status = $2 WHERE id = $1', [userId, status]);
    if (status === 'SUSPENDED') {
      // Kill every session now; the realtime bus also disconnects the user's live sockets.
      await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      tx.notify({ t: 'session', userId });
    }
    await audit(tx, actor, `user.${status.toLowerCase()}`, 'user', userId, { before: { status: rows[0].status }, after: { status } });
    return { id: userId, status };
  });
}

export async function adminListAudit({ entityType, action, q, page, pageSize }) {
  const where = [];
  const params = [];
  if (entityType) where.push(`entity_type = $${params.push(entityType)}`);
  if (action) where.push(`action = $${params.push(action)}`);
  if (q) where.push(`(actor_label ILIKE $${params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)} OR action ILIKE $${params.length})`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await query(`SELECT count(*)::int AS n FROM audit_log ${whereSql}`, params);
  const { rows } = await query(
    `SELECT id, actor_label, action, entity_type, entity_id, before, after, meta, request_id, created_at
       FROM audit_log ${whereSql} ORDER BY id DESC LIMIT $${params.push(pageSize)} OFFSET $${params.push((page - 1) * pageSize)}`,
    params,
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      actor: r.actor_label,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      before: r.before,
      after: r.after,
      meta: r.meta,
      requestId: r.request_id,
      at: r.created_at,
    })),
    total: total.rows[0].n,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total.rows[0].n / pageSize)),
  };
}
