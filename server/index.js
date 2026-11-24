import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool, waitForDatabase } from './db/pool.js';
import { ensureAdminFromEnv, seedDemoIfEmpty } from './db/seed.js';
import { startSweeper } from './jobs/sweeper.js';
import { startBus, stopBus } from './realtime/bus.js';
import { createIo } from './realtime/io.js';

// A bug in one request must never take the whole service down.
process.on('unhandledRejection', (reason) => console.error('[process] unhandled rejection:', reason));
process.on('uncaughtException', (err) => console.error('[process] uncaught exception:', err));

async function main() {
  await waitForDatabase();
  await migrate();
  await ensureAdminFromEnv();
  if (config.demoMode && (await seedDemoIfEmpty())) console.log('[db] demo data seeded');

  const app = createApp();
  const server = http.createServer(app);
  const io = createIo(server);
  await startBus(io);
  const stopSweeper = startSweeper();

  server.listen(config.port, () => {
    console.log(`[server] RescuePlate listening on http://localhost:${config.port} (${config.env}${config.demoMode ? ', demo mode' : ''})`);
  });

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`[server] ${signal} received, shutting down`);
    stopSweeper();
    io.close();
    server.close();
    await stopBus();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
