// Starts a real PostgreSQL server from the `embedded-postgres` dev dependency.
// Used for local development and for the test suite, so that row locks,
// transactions and LISTEN/NOTIFY behave exactly as they do in production.
import fs from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

async function ensureDatabase(adminUrl, database) {
  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 2000 });
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${database}"`);
  await client.end();
}

export async function startEmbeddedPg({ dir, port, database = 'rescueplate', quiet = true }) {
  const adminUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/${database}`;

  // A server left running by an earlier session (for example after the terminal
  // was closed) is simply reused instead of failing on its lock file.
  try {
    await ensureDatabase(adminUrl, database);
    return { url, reused: true, stop: async () => {} };
  } catch {
    /* nothing is listening on the port: start our own below */
  }

  const firstRun = !fs.existsSync(`${dir}/PG_VERSION`);
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
    onLog: quiet ? () => {} : (m) => process.stdout.write(String(m)),
    onError: (m) => {
      const text = String(m);
      // Postgres writes its normal startup log to stderr; only show real problems.
      if (!quiet || /FATAL|PANIC/.test(text)) process.stderr.write(text);
    },
  });
  if (firstRun) await server.initialise();
  await server.start();

  await ensureDatabase(adminUrl, database);
  return { url, reused: false, stop: () => server.stop() };
}
