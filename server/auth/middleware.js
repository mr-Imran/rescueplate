import crypto from 'node:crypto';
import { parseCookie } from 'cookie';
import { config } from '../config.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { findSessionUser } from './sessions.js';

export function readSessionToken(cookieHeader) {
  if (typeof cookieHeader !== 'string' || cookieHeader.length > 4096) return null;
  return parseCookie(cookieHeader)[config.cookieName] || null;
}

/** Tags every request with an id that appears in error responses, logs and the audit trail. */
export function requestId(req, res, next) {
  req.id = crypto.randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', req.id);
  next();
}

/** Loads the signed-in user (if any) onto req.user. Never rejects by itself. */
export async function loadUser(req, _res, next) {
  const token = readSessionToken(req.headers.cookie);
  const user = await findSessionUser(token);
  if (user) req.user = { ...user, requestId: req.id };
  req.sessionToken = token;
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) throw unauthorized();
  next();
}

/** Role-based authorization. Resource ownership is checked separately inside each service. */
export const requireRole = (...roles) =>
  function roleGuard(req, _res, next) {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) {
      throw forbidden(`This action is only available to ${roles.join(' or ')} accounts.`);
    }
    next();
  };

/** R8 - donors and NGOs must be verified by an admin before they can post or claim. */
export function requireVerifiedOrg(req, _res, next) {
  const status = req.user?.org?.status;
  if (status === 'VERIFIED') return next();
  if (status === 'SUSPENDED') throw forbidden('Your organization has been suspended. Contact an administrator.', 'ORG_SUSPENDED');
  throw forbidden('Your organization must be verified by an admin before it can do this.', 'ORG_NOT_VERIFIED');
}

/**
 * CSRF defence in depth. The session cookie is SameSite=Lax, and in addition any
 * state-changing request that carries an Origin header must come from our own origin.
 */
export function sameOriginOnly(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw forbidden('Cross-site requests are not allowed.', 'BAD_ORIGIN');
    }
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (originHost !== host) throw forbidden('Cross-site requests are not allowed.', 'BAD_ORIGIN');
  }
  next();
}
