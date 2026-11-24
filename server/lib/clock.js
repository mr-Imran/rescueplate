import { query } from '../db/pool.js';

/** Current application time (real time plus the demo clock offset). `db` may be a transaction. */
export async function appNow(db = { query }) {
  const { rows } = await db.query('SELECT app_now() AS now');
  return rows[0].now;
}

export async function getClockOffsetSeconds(db = { query }) {
  const { rows } = await db.query("SELECT (value->>'seconds')::double precision AS s FROM app_settings WHERE key = 'clock_offset'");
  return rows[0]?.s ?? 0;
}

export async function setClockOffsetSeconds(db, seconds) {
  await db.query(
    `INSERT INTO app_settings (key, value) VALUES ('clock_offset', jsonb_build_object('seconds', $1::double precision))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [seconds],
  );
}
