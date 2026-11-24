/** An error that is safe to show to the client. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Please sign in to continue.') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to do that.', code = 'FORBIDDEN') =>
  new AppError(403, code, message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} was not found.`);
export const conflict = (code, message, details) => new AppError(409, code, message, details);

export function validationError(fieldErrors, message = 'Please correct the highlighted fields.') {
  return new AppError(400, 'VALIDATION_ERROR', message, { fieldErrors });
}

// PostgreSQL error codes that mean "the database is unavailable or busy", not "our bug".
const UNAVAILABLE_PG = new Set(['55P03', '57014', '57P01', '57P02', '57P03', '53300', '08000', '08003', '08006', '08001', '08004']);
const UNAVAILABLE_NODE = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND']);

/**
 * Converts any thrown value into { status, body } for the HTTP response.
 * Unknown errors become a generic 500: no stack trace or SQL ever reaches the client.
 */
export function toHttpError(err, requestId) {
  const wrap = (status, code, message, details) => ({
    status,
    body: { error: { code, message, ...(details ? { details } : {}), requestId } },
  });

  if (err instanceof AppError) return wrap(err.status, err.code, err.message, err.details);

  // Malformed JSON body or oversized payload (raised by express.json()).
  if (err?.type === 'entity.parse.failed') return wrap(400, 'INVALID_JSON', 'The request body is not valid JSON.');
  if (err?.type === 'entity.too.large') return wrap(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');

  // Database constraint violations that slipped past application checks (for example under a race).
  if (err?.code === '23505') {
    return wrap(409, 'DUPLICATE', 'That already exists, or the same action was just performed.', { constraint: err.constraint });
  }
  if (err?.code === '23503' || err?.code === '23001') {
    return wrap(409, 'REFERENCE_CONFLICT', 'This record is linked to other records, so the change is not allowed.');
  }
  if (err?.code === '23514' || err?.code === '22003' || err?.code === '22P02' || err?.code === '22001') {
    return wrap(400, 'INVALID_DATA', 'One of the values is not allowed.');
  }
  const isPoolTimeout = /timeout exceeded when trying to connect|Connection terminated/i.test(err?.message || '');
  if (UNAVAILABLE_PG.has(err?.code) || UNAVAILABLE_NODE.has(err?.code) || isPoolTimeout) {
    return {
      ...wrap(503, 'SERVICE_BUSY', 'The service is busy or temporarily unavailable. Nothing was changed. Please try again in a moment.'),
      retryAfter: 2,
    };
  }
  return wrap(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Nothing was changed. Please try again.');
}
