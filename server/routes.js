import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { requireAuth, requireRole, requireVerifiedOrg } from './auth/middleware.js';
import { createSession, revokeSession, sessionCookieOptions } from './auth/sessions.js';
import { config } from './config.js';
import { query } from './db/pool.js';
import { PERSONAS, seedId } from './db/seed.js';
import { FOOD_TYPES, LIMITS } from './domain/rules.js';
import { getClockOffsetSeconds } from './lib/clock.js';
import { AppError, forbidden, notFound } from './lib/errors.js';
import { parse, parseId, schemas } from './lib/validate.js';
import { busConnected } from './realtime/bus.js';
import * as accounts from './services/accounts.js';
import * as claims from './services/claims.js';
import * as demo from './services/demo.js';
import * as listings from './services/listings.js';
import { impactStats } from './services/stats.js';

const tooMany = (message) => (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', message));
const limiter = (options, message) =>
  rateLimit({ standardHeaders: 'draft-7', legacyHeaders: false, skip: () => config.isTest, handler: tooMany(message), ...options });

// Slows password guessing: 10 attempts per 15 minutes for each IP + email pair.
const loginLimiter = limiter(
  { windowMs: 15 * 60_000, limit: 10, keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || '').toLowerCase()}` },
  'Too many sign-in attempts. Please wait a few minutes and try again.',
);
const personaLimiter = limiter({ windowMs: 15 * 60_000, limit: 120 }, 'Too many demo sign-ins. Please wait a few minutes.');
const registerLimiter = limiter({ windowMs: 60 * 60_000, limit: 20 }, 'Too many accounts created from this address. Please try again later.');
// Stops brute-forcing the 6-digit handover code: 5 wrong codes per claim per 10 minutes.
const handoverLimiter = limiter(
  { windowMs: 10 * 60_000, limit: 5, skipSuccessfulRequests: true, keyGenerator: (req) => `${req.user.id}:${req.params.id}` },
  'Too many incorrect handover codes. Please wait 10 minutes or ask the donor to check the code.',
);

export function buildRoutes() {
  const r = Router();

  /* ------------------------------ public ------------------------------ */

  r.get('/health', async (_req, res) => {
    await query('SELECT 1'); // a database failure becomes a 503 via the error handler
    res.json({ status: 'ok', database: true, realtime: busConnected(), time: new Date().toISOString() });
  });

  r.get('/config', (_req, res) => {
    res.json({
      demoMode: config.demoMode,
      demoAccessCodeRequired: config.demoMode && Boolean(config.demoAccessCode),
      demoAutoResetMinutes: config.demoMode ? config.demoAutoResetMinutes : 0,
      personas: config.demoMode ? PERSONAS : [],
      foodTypes: FOOD_TYPES,
      limits: LIMITS,
    });
  });

  /* ------------------------------- auth ------------------------------- */

  const startSession = async (res, userId) => {
    const session = await createSession(userId);
    res.cookie(config.cookieName, session.token, sessionCookieOptions(session.expiresAt));
  };

  r.post('/auth/register', registerLimiter, async (req, res) => {
    const user = await accounts.register(parse(schemas.register, req.body));
    await startSession(res, user.id);
    res.status(201).json({ ok: true });
  });

  r.post('/auth/login', loginLimiter, async (req, res) => {
    const session = await accounts.login(parse(schemas.login, req.body));
    res.cookie(config.cookieName, session.token, sessionCookieOptions(session.expiresAt));
    res.json({ ok: true });
  });

  // One-click sign-in as a seeded persona, so judges can try every role. Demo mode only.
  r.post('/auth/demo-login', personaLimiter, async (req, res) => {
    if (!config.demoMode) throw notFound('Route');
    const { persona, accessCode } = parse(schemas.demoLogin, req.body);
    if (config.demoAccessCode && accessCode !== config.demoAccessCode) throw forbidden('That demo access code is not correct.', 'BAD_ACCESS_CODE');
    if (!PERSONAS.some((p) => p.key === persona)) throw notFound('Persona');
    const user = await query(`SELECT id FROM users WHERE id = $1 AND status = 'ACTIVE'`, [seedId(`user:${persona}`)]);
    if (user.rowCount === 0) throw new AppError(409, 'PERSONA_UNAVAILABLE', 'This demo account is unavailable (it may be suspended). An admin can reset the demo data.');
    await startSession(res, user.rows[0].id);
    res.json({ ok: true });
  });

  r.post('/auth/logout', async (req, res) => {
    await revokeSession(req.sessionToken); // server-side revocation: the token is dead even if copied
    res.clearCookie(config.cookieName, sessionCookieOptions());
    res.json({ ok: true });
  });

  r.get('/me', requireAuth, async (req, res) => {
    const offset = await getClockOffsetSeconds();
    const { requestId, ...user } = req.user;
    res.set('Cache-Control', 'no-store');
    res.json({ user, serverNow: Date.now() + offset * 1000, clockOffsetSeconds: offset });
  });

  /* ----------------------------- listings ----------------------------- */

  r.get('/listings', requireAuth, async (req, res) => {
    res.json(await listings.listListings(req.user, parse(schemas.listingQuery, req.query)));
  });

  r.get('/listings/:id', requireAuth, async (req, res) => {
    res.json(await listings.getListingDetail(req.user, parseId(req.params.id, 'Listing')));
  });

  r.post('/listings', requireRole('donor'), requireVerifiedOrg, async (req, res) => {
    res.status(201).json({ listing: await listings.createListing(req.user, parse(schemas.listingCreate, req.body)) });
  });

  r.patch('/listings/:id', requireRole('donor'), requireVerifiedOrg, async (req, res) => {
    res.json({ listing: await listings.updateListing(req.user, parseId(req.params.id, 'Listing'), parse(schemas.listingUpdate, req.body)) });
  });

  r.post('/listings/:id/cancel', requireRole('donor'), async (req, res) => {
    res.json({ listing: await listings.cancelListing(req.user, parseId(req.params.id, 'Listing'), parse(schemas.listingCancel, req.body)) });
  });

  r.delete('/listings/:id', requireRole('donor'), async (req, res) => {
    res.json(await listings.deleteListing(req.user, parseId(req.params.id, 'Listing')));
  });

  /* --------------------------- claims & pickups --------------------------- */

  r.post('/listings/:id/claims', requireRole('ngo'), async (req, res) => {
    const listingId = parseId(req.params.id, 'Listing');
    const body = parse(schemas.claimCreate, req.body);
    const key = parse(schemas.idempotencyKey, req.get('Idempotency-Key'));
    const result = await claims.createClaim(req.user, listingId, body, key);
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.status >= 400 ? { error: { ...result.body.error, requestId: req.id } } : result.body);
  });

  r.get('/claims', requireAuth, async (req, res) => {
    res.json({ items: await claims.listClaims(req.user, parse(schemas.claimQuery, req.query)) });
  });

  r.get('/pickups/open', requireRole('volunteer', 'admin'), async (req, res) => {
    res.json({ items: await claims.listOpenPickups(req.user) });
  });

  r.get('/volunteers', requireRole('ngo', 'admin'), async (_req, res) => {
    res.json({ items: await claims.listVolunteers() });
  });

  r.post('/claims/:id/assign', requireRole('ngo'), async (req, res) => {
    const { volunteerId } = parse(schemas.assign, req.body);
    res.json({ claim: await claims.assignVolunteer(req.user, parseId(req.params.id, 'Claim'), volunteerId) });
  });

  r.post('/claims/:id/accept', requireRole('volunteer'), async (req, res) => {
    res.json({ claim: await claims.assignVolunteer(req.user, parseId(req.params.id, 'Claim'), req.user.id) });
  });

  r.post('/claims/:id/unassign', requireRole('volunteer', 'ngo'), async (req, res) => {
    res.json({ claim: await claims.unassignVolunteer(req.user, parseId(req.params.id, 'Claim')) });
  });

  r.post('/claims/:id/pickup', requireRole('volunteer'), handoverLimiter, async (req, res) => {
    const { handoverCode } = parse(schemas.pickup, req.body);
    res.json({ claim: await claims.confirmPickup(req.user, parseId(req.params.id, 'Claim'), handoverCode) });
  });

  r.post('/claims/:id/deliver', requireRole('volunteer', 'ngo'), async (req, res) => {
    res.json({ claim: await claims.confirmDelivery(req.user, parseId(req.params.id, 'Claim')) });
  });

  r.post('/claims/:id/cancel', requireRole('ngo'), async (req, res) => {
    res.json({ claim: await claims.cancelClaim(req.user, parseId(req.params.id, 'Claim')) });
  });

  /* ---------------------------- organization ---------------------------- */

  r.get('/org', requireRole('donor', 'ngo'), async (req, res) => {
    res.json(await accounts.getMyOrg(req.user));
  });

  r.patch('/org', requireRole('donor', 'ngo'), async (req, res) => {
    res.json({ org: await accounts.updateMyOrg(req.user, parse(schemas.orgUpdate, req.body)) });
  });

  /* -------------------------------- stats -------------------------------- */

  r.get('/stats/impact', requireAuth, async (req, res) => {
    res.json(await impactStats(req.user, parse(schemas.statsQuery, req.query)));
  });

  /* -------------------------------- admin -------------------------------- */

  const admin = Router();
  admin.use(requireRole('admin'));

  admin.get('/organizations', async (req, res) => {
    res.json({ items: await accounts.adminListOrganizations(parse(schemas.adminOrgQuery, req.query)) });
  });
  admin.post('/organizations/:id/status', async (req, res) => {
    const { status } = parse(schemas.adminOrgStatus, req.body);
    res.json({ org: await accounts.adminSetOrgStatus(req.user, parseId(req.params.id, 'Organization'), status) });
  });
  admin.get('/users', async (req, res) => {
    res.json({ items: await accounts.adminListUsers(parse(schemas.adminUserQuery, req.query)) });
  });
  admin.post('/users/:id/status', async (req, res) => {
    const { status } = parse(schemas.adminUserStatus, req.body);
    res.json(await accounts.adminSetUserStatus(req.user, parseId(req.params.id, 'User'), status));
  });
  admin.get('/audit', async (req, res) => {
    res.json(await accounts.adminListAudit(parse(schemas.auditQuery, req.query)));
  });
  admin.get('/integrity', async (_req, res) => {
    res.json(await demo.integrityCheck());
  });

  // Demo console: reproduces the judges' test scenarios on demand.
  const demoOnly = (_req, _res, next) => (config.demoMode ? next() : next(notFound('Route')));
  admin.post('/demo/race', demoOnly, async (req, res) => {
    res.json(await demo.runRace(parse(schemas.demoRace, req.body)));
  });
  admin.post('/demo/idempotency', demoOnly, async (req, res) => {
    res.json(await demo.runIdempotency(parse(schemas.demoIdempotency, req.body)));
  });
  admin.post('/demo/conflict', demoOnly, async (_req, res) => {
    res.json(await demo.runConflict());
  });
  admin.post('/demo/clock', demoOnly, async (req, res) => {
    res.json(await demo.advanceClock(req.user, parse(schemas.demoClock, req.body)));
  });
  admin.post('/demo/reset', demoOnly, async (_req, res) => {
    res.json(await demo.resetDemo());
  });

  r.use('/admin', admin);
  return r;
}
