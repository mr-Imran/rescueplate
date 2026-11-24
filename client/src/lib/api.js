// Thin fetch wrapper. Every failure becomes an ApiError with a message that is safe to show.

export class ApiError extends Error {
  constructor(status, code, message, details, requestId) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
  /** Per-field validation messages from the server, if any. */
  get fieldErrors() {
    return this.details?.fieldErrors || {};
  }
  /** True when retrying the same request later could succeed. */
  get transient() {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

const listeners = new Set();
/** Called when the server says the session is no longer valid. */
export function onUnauthorized(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(method, path, body, headers) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON (for example a proxy error page) */
  }
  if (res.ok) return { data, headers: res.headers };

  const e = data?.error;
  const err = new ApiError(res.status, e?.code || 'HTTP_ERROR', e?.message || `The server returned an error (${res.status}). Please try again.`, e?.details, e?.requestId);
  if (res.status === 401 && !path.startsWith('/auth/')) listeners.forEach((fn) => fn());
  throw err;
}

/**
 * `retries` re-sends the request after a network error or a 502/503/504.
 * Reads are always safe to repeat. Writes are retried only when the caller
 * passes an Idempotency-Key, which makes the repeat harmless.
 */
async function request(method, path, { body, headers = {}, retries = method === 'GET' ? 2 : 0 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await once(method, path, body, headers);
    } catch (err) {
      if (!(err instanceof ApiError) || !err.transient || attempt >= retries) throw err;
      await sleep(400 * 2 ** attempt + Math.random() * 200);
    }
  }
}

export const api = {
  get: async (path) => (await request('GET', path)).data,
  post: async (path, body = {}) => (await request('POST', path, { body })).data,
  patch: async (path, body) => (await request('PATCH', path, { body })).data,
  del: async (path) => (await request('DELETE', path)).data,

  /**
   * Claims meals. The idempotency key identifies this one user intent: if the
   * connection drops mid-request we retry with the same key, and the server
   * guarantees the claim is made at most once.
   */
  claim: async (listingId, body, idempotencyKey) => {
    const res = await request('POST', `/listings/${listingId}/claims`, { body, headers: { 'Idempotency-Key': idempotencyKey }, retries: 3 });
    return { ...res.data, replayed: res.headers.get('Idempotent-Replayed') === 'true' };
  },
};

export const newIdempotencyKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);

/** Builds a query string, skipping empty values. */
export function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}
