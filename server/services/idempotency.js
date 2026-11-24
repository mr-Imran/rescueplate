import crypto from 'node:crypto';
import { AppError } from '../lib/errors.js';

// Idempotency keys make "claim" safe to retry. The client generates one key per
// user intent and re-sends it on every retry of that intent. The key row is
// written in the SAME transaction as the claim, so there are only two possible
// worlds: the claim and its recorded response both exist, or neither does.

export function hashRequest(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Registers the key. Returns { fresh: true } if this is the first time we see
 * it, or { fresh: false, status, body } with the original response to replay.
 *
 * Two requests with the same key arriving at the same instant: the second
 * INSERT blocks on the primary key until the first transaction finishes, then
 * finds the stored response. It never executes the claim a second time.
 */
export async function beginIdempotent(tx, { userId, scope, key, requestHash }) {
  const inserted = await tx.query(
    `INSERT INTO idempotency_keys (user_id, scope, key, request_hash) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, scope, key) DO NOTHING`,
    [userId, scope, key, requestHash],
  );
  if (inserted.rowCount === 1) return { fresh: true };

  const { rows } = await tx.query(
    'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND scope = $2 AND key = $3',
    [userId, scope, key],
  );
  const row = rows[0];
  if (!row || row.response_status === null) {
    throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'The original request is still being processed. Please retry shortly.');
  }
  if (row.request_hash !== requestHash) {
    throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.');
  }
  return { fresh: false, status: row.response_status, body: row.response_body };
}

export async function completeIdempotent(tx, { userId, scope, key }, status, body) {
  await tx.query(
    'UPDATE idempotency_keys SET response_status = $4, response_body = $5 WHERE user_id = $1 AND scope = $2 AND key = $3',
    [userId, scope, key, status, JSON.stringify(body)],
  );
}
