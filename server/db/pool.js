import pg from 'pg';
import { config } from '../config.js';

// Return BIGINT / NUMERIC aggregates as JS numbers (our values are far below 2^53).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const EVENTS_CHANNEL = 'rp_events';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX || 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
});

// An idle client can lose its connection (database restart). Without a listener
// that would crash the process; the pool simply discards the client instead.
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set(['40001', '40P01']); // serialization failure, deadlock detected

/**
 * Runs `fn` inside one database transaction.
 *
 * - Everything `fn` writes commits together or not at all.
 * - `tx.notify(event)` queues a realtime event. Events are sent with pg_notify
 *   inside the same transaction, so PostgreSQL delivers them only if the
 *   transaction commits, and in commit order. A rolled-back change can never
 *   be broadcast to clients.
 * - `lock_timeout` bounds how long we wait for a row lock, so a stuck
 *   transaction turns into a clean 503 instead of a hung request.
 * - Deadlocks / serialization failures are retried a few times with jitter.
 */
export async function withTransaction(fn, { retries = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    const events = [];
    const tx = {
      query: (text, params) => client.query(text, params),
      notify: (event) => events.push(event),
    };
    let broken = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '4s'");
      const result = await fn(tx);
      for (const event of events) {
        await client.query('SELECT pg_notify($1, $2)', [EVENTS_CHANNEL, JSON.stringify(event)]);
      }
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true; // connection is gone; make the pool throw this client away
      }
      if (attempt < retries && RETRYABLE.has(err.code)) {
        await sleep(20 * attempt + Math.random() * 40);
        continue;
      }
      throw err;
    } finally {
      client.release(broken);
    }
  }
}

/** Waits for the database to accept connections (it may still be starting). */
export async function waitForDatabase({ attempts = 40, delayMs = 1500 } = {}) {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      if (i === 1 || i % 5 === 0) console.log(`[db] waiting for database (${err.code || err.message})...`);
      await sleep(delayMs);
    }
  }
}
