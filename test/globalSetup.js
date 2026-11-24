// Starts a throwaway PostgreSQL for the test run (unless TEST_DATABASE_URL points at one).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default async function setup() {
  if (process.env.TEST_DATABASE_URL) return undefined;
  const { startEmbeddedPg } = await import('../scripts/embedded-pg.mjs');
  const db = await startEmbeddedPg({ dir: path.join(root, '.pgdata-test'), port: 54330, database: 'postgres' });

  // Always begin from an empty database so migrations are exercised on every run.
  const admin = new pg.Client({ connectionString: db.url });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS rescueplate_test WITH (FORCE)');
  await admin.query('CREATE DATABASE rescueplate_test');
  await admin.end();

  return async () => {
    await db.stop();
  };
}
