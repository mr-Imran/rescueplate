import { z } from 'zod';
import { FOOD_TYPES, LIMITS } from '../domain/rules.js';
import { notFound, validationError } from './errors.js';

/** Validates `data` against a zod schema; throws a 400 with per-field messages on failure. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fieldErrors = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (fieldErrors[path]) continue; // keep the first message per field
    // Our schemas attach friendly messages; only zod's generic defaults are replaced here.
    const generic = issue.message.startsWith('Invalid input');
    const missing = /received (undefined|null)/.test(issue.message);
    fieldErrors[path] = !generic ? issue.message : missing ? 'This field is required.' : 'This value is not valid.';
  }
  throw validationError(fieldErrors);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Route ids that are not UUIDs cannot exist, so they are a 404 rather than a database error. */
export function parseId(value, what = 'Record') {
  if (typeof value !== 'string' || !UUID.test(value)) throw notFound(what);
  return value.toLowerCase();
}

// Strings are trimmed and stripped of control characters before length checks.
const text = (min, max, label) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
    .pipe(
      z
        .string()
        .min(min, min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
        .max(max, `${label} must be at most ${max} characters.`),
    );

const wholeNumber = (min, max, label) =>
  z
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be at most ${max}.`);

const date = (label) => z.coerce.date({ error: `${label} must be a valid date and time.` });
const latitude = z.number({ error: 'Latitude must be a number.' }).min(-90, 'Latitude must be between -90 and 90.').max(90, 'Latitude must be between -90 and 90.');
const longitude = z.number({ error: 'Longitude must be a number.' }).min(-180, 'Longitude must be between -180 and 180.').max(180, 'Longitude must be between -180 and 180.');
const capacity = wholeNumber(1, 100000, 'Daily capacity');
const foodType = z.enum(Object.keys(FOOD_TYPES), { error: 'Choose a food type from the list.' });
const email = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.email('Enter a valid email address.').max(254, 'Email is too long.'));

const orgSchema = z.object({
  name: text(2, 120, 'Organization name'),
  address: text(5, 300, 'Address'),
  lat: latitude,
  lng: longitude,
  dailyCapacityMeals: capacity.optional(),
});

export const schemas = {
  register: z
    .object({
      name: text(2, 80, 'Name'),
      email,
      password: z.string().min(8, 'Password must be at least 8 characters.').max(200, 'Password is too long.'),
      role: z.enum(['donor', 'ngo', 'volunteer'], { error: 'Choose donor, NGO or volunteer.' }),
      joinCode: z.string().trim().min(4, 'Join code is too short.').max(20, 'Join code is too long.').optional(),
      org: orgSchema.optional(),
    })
    .superRefine((v, ctx) => {
      // bcrypt only reads the first 72 bytes; reject longer passwords instead of silently truncating them.
      if (Buffer.byteLength(v.password, 'utf8') > 72) {
        ctx.addIssue({ code: 'custom', path: ['password'], message: 'Password must be at most 72 bytes.' });
      }
      if (v.role !== 'volunteer' && !v.joinCode && !v.org) {
        ctx.addIssue({ code: 'custom', path: ['org.name'], message: 'Enter your organization details or a join code.' });
      }
      if (v.role === 'ngo' && !v.joinCode && v.org && v.org.dailyCapacityMeals === undefined) {
        ctx.addIssue({ code: 'custom', path: ['org.dailyCapacityMeals'], message: 'Enter how many meals you can accept per day.' });
      }
    }),

  login: z.object({ email, password: z.string().min(1, 'Password is required.').max(200) }),
  demoLogin: z.object({ persona: z.string().max(30), accessCode: z.string().max(100).optional() }),

  listingCreate: z.object({
    title: text(3, 120, 'Title'),
    description: text(0, 1000, 'Description').default(''),
    foodType,
    isVeg: z.boolean({ error: 'Say whether the food is vegetarian.' }),
    totalMeals: wholeNumber(1, LIMITS.MAX_MEALS, 'Number of meals'),
    preparedAt: date('Prepared time'),
    safeUntil: date('Safe-until time'),
  }),

  listingUpdate: z
    .object({
      expectedVersion: wholeNumber(1, 2_000_000_000, 'Version'),
      title: text(3, 120, 'Title').optional(),
      description: text(0, 1000, 'Description').optional(),
      foodType: foodType.optional(),
      isVeg: z.boolean().optional(),
      totalMeals: wholeNumber(1, LIMITS.MAX_MEALS, 'Number of meals').optional(),
      preparedAt: date('Prepared time').optional(),
      safeUntil: date('Safe-until time').optional(),
    })
    .strict(),

  listingCancel: z.object({ expectedVersion: wholeNumber(1, 2_000_000_000, 'Version').optional() }),

  listingQuery: z.object({
    q: z.string().trim().max(100, 'Search text is too long.').optional(),
    foodType: foodType.optional(),
    veg: z.enum(['veg', 'nonveg']).optional(),
    status: z.enum(['available', 'all', 'POSTED', 'PARTIALLY_CLAIMED', 'FULLY_CLAIMED', 'COMPLETED', 'EXPIRED', 'CANCELLED']).default('available'),
    minMeals: z.coerce.number().int().min(1).max(LIMITS.MAX_MEALS).optional(),
    withinMinutes: z.coerce.number().int().min(1).max(10080).optional(),
    maxKm: z.coerce.number().min(0.1).max(20000).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    mine: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    sort: z.enum(['expiry', 'meals', 'newest', 'distance']).default('expiry'),
    order: z.enum(['asc', 'desc']).default('asc'),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(12),
  }),

  claimCreate: z.object({
    meals: wholeNumber(1, LIMITS.MAX_MEALS, 'Number of meals'),
    allowPartial: z.boolean().default(true),
  }),
  idempotencyKey: z
    .string({ error: 'An Idempotency-Key header is required for this request.' })
    .regex(/^[A-Za-z0-9_\-:.]{8,128}$/, 'Idempotency-Key must be 8-128 letters, digits, dashes or underscores.'),

  claimQuery: z.object({
    state: z.enum(['open', 'closed', 'all']).default('all'),
    listingId: z.string().regex(UUID).optional(),
  }),
  assign: z.object({ volunteerId: z.string().regex(UUID, 'Choose a volunteer.') }),
  pickup: z.object({ handoverCode: z.string().trim().regex(/^\d{6}$/, 'The handover code is 6 digits.') }),

  orgUpdate: z
    .object({
      expectedVersion: wholeNumber(1, 2_000_000_000, 'Version'),
      address: text(5, 300, 'Address').optional(),
      lat: latitude.optional(),
      lng: longitude.optional(),
      dailyCapacityMeals: capacity.optional(),
    })
    .strict(),

  statsQuery: z.object({
    days: z.coerce.number().int().min(1).max(90).default(14),
    scope: z.enum(['all', 'mine']).default('all'),
    tz: z.string().max(64).optional(),
  }),

  adminOrgQuery: z.object({ status: z.enum(['PENDING', 'VERIFIED', 'SUSPENDED']).optional(), q: z.string().trim().max(100).optional() }),
  adminOrgStatus: z.object({ status: z.enum(['VERIFIED', 'SUSPENDED', 'PENDING']) }),
  adminUserQuery: z.object({ q: z.string().trim().max(100).optional() }),
  adminUserStatus: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }),
  auditQuery: z.object({
    entityType: z.enum(['listing', 'claim', 'organization', 'user', 'system']).optional(),
    action: z.string().trim().max(60).optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  }),

  demoRace: z.object({
    meals: wholeNumber(1, 500, 'Meals').default(40),
    contenders: wholeNumber(2, 8, 'Contenders').default(6),
    requestEach: wholeNumber(1, 500, 'Request size').default(15),
    keep: z.boolean().default(false),
  }),
  demoIdempotency: z.object({ copies: wholeNumber(2, 10, 'Copies').default(5) }),
  demoClock: z.object({ minutes: wholeNumber(1, 1440, 'Minutes').default(180), reset: z.boolean().default(false) }),
};
