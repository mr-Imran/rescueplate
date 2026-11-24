// `npm run db` — runs a local PostgreSQL for development (data kept in ./.pgdata).
// Not needed if you already have a DATABASE_URL pointing at your own Postgres.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEmbeddedPg } from './embedded-pg.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.DEV_DB_PORT || 54329);

const db = await startEmbeddedPg({ dir: path.join(root, '.pgdata'), port });
console.log(`[db] PostgreSQL ready at ${db.url}${db.reused ? ' (reusing the server that was already running)' : ''}`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await db.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Keep the process alive while the database runs.
setInterval(() => {}, 1 << 30);
