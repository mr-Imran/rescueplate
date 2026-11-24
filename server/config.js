// Central configuration. Every value comes from the environment; nothing secret is hard-coded.
const env = process.env;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  isTest,
  port: Number(env.PORT || 3000),
  // Default matches `npm run db` (the bundled local PostgreSQL).
  databaseUrl: env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:54329/rescueplate',
  databaseSsl: bool(env.DATABASE_SSL, false),
  cookieName: 'rp_session',
  sessionTtlHours: Number(env.SESSION_TTL_HOURS || 12),
  bcryptCost: isTest ? 4 : Number(env.BCRYPT_COST || 10),
  // Demo mode seeds sample data and enables one-click persona login plus the /demo console.
  demoMode: bool(env.DEMO_MODE, !isProd),
  // Optional shared code that judges must enter before one-click persona login works.
  demoAccessCode: env.DEMO_ACCESS_CODE || '',
  // Password for the seeded demo accounts. If unset, each account gets a random
  // password, so the accounts are reachable only through persona login.
  demoPassword: env.DEMO_PASSWORD || '',
  // Demo mode only: after this many minutes with no change made by any user, the
  // sample data is restored, so the feed never sits empty once the seeded food
  // has passed its safe-until time. 0 switches this off.
  demoAutoResetMinutes: Math.max(0, Number(env.DEMO_AUTO_RESET_MINUTES ?? 120) || 0),
  adminEmail: env.ADMIN_EMAIL || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  sweepIntervalMs: Number(env.SWEEP_INTERVAL_MS || 10_000),
  logRequests: bool(env.LOG_REQUESTS, !isTest),
};
