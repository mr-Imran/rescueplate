// Realtime event bus built on PostgreSQL LISTEN / NOTIFY.
//
// Services never talk to sockets. Inside a transaction they call tx.notify(),
// which issues pg_notify. PostgreSQL delivers the notification to every
// listening app instance only when the transaction COMMITS, in commit order.
// That gives three guarantees for free:
//   1. a rolled-back change is never broadcast;
//   2. clients never hear about data they cannot yet read;
//   3. it works across several app instances without Redis.
import { EventEmitter } from 'node:events';
import pg from 'pg';
import { config } from '../config.js';
import { EVENTS_CHANNEL } from '../db/pool.js';
import { getClockOffsetSeconds } from '../lib/clock.js';
import { getListing } from '../services/listingState.js';

/** In-process fan-out of committed events (used by the socket layer and by tests). */
export const bus = new EventEmitter();
bus.setMaxListeners(50);

let client = null;
let stopped = false;
let everConnected = false;

async function dispatch(io, event) {
  bus.emit('event', event);
  if (!io) return;
  switch (event.t) {
    case 'listing': {
      if (event.deleted) {
        io.to('feed').emit('listing.removed', { id: event.id });
        break;
      }
      // Send the full current row with its version. Clients keep whichever copy
      // has the higher version, so duplicated or reordered events are harmless.
      const listing = await getListing(event.id);
      if (listing) io.to('feed').emit('listing.upsert', { listing, created: Boolean(event.created) });
      else io.to('feed').emit('listing.removed', { id: event.id });
      break;
    }
    case 'claim': {
      // Claims are private. Only the parties involved get a hint; they then fetch
      // the details over the authorized REST API, so sockets never leak claim data.
      const rooms = [`org:${event.ngoOrgId}`, `org:${event.donorOrgId}`, 'role:admin', 'role:volunteer', ...(event.volunteerIds || []).map((id) => `user:${id}`)];
      io.to(rooms).emit('claim.changed', { claimId: event.id, listingId: event.listingId });
      break;
    }
    case 'org':
      io.to([`org:${event.id}`, 'role:admin']).emit('org.changed', { orgId: event.id });
      break;
    case 'session':
      // Account suspended: drop the user's live connections immediately.
      io.in(`user:${event.userId}`).disconnectSockets(true);
      break;
    case 'clock': {
      const offset = await getClockOffsetSeconds();
      io.emit('clock.changed', { serverNow: Date.now() + offset * 1000, clockOffsetSeconds: offset });
      break;
    }
    case 'reset':
      io.emit('sync.required', { reason: 'Demo data was reset' });
      break;
    default:
      break;
  }
}

async function connect(io) {
  if (stopped) return;
  const c = new pg.Client({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    keepAlive: true,
  });
  const retry = () => {
    if (client === c) client = null;
    c.removeAllListeners();
    c.end().catch(() => {});
    if (!stopped) setTimeout(() => connect(io).catch(() => {}), 1500).unref();
  };
  c.on('error', (err) => {
    console.error('[bus] listener connection error:', err.message);
    retry();
  });
  c.on('end', () => {
    if (client === c && !stopped) retry();
  });
  c.on('notification', (msg) => {
    if (msg.channel !== EVENTS_CHANNEL) return;
    let event;
    try {
      event = JSON.parse(msg.payload);
    } catch {
      return;
    }
    dispatch(io, event).catch((err) => console.error('[bus] dispatch failed:', err.message));
  });
  try {
    await c.connect();
    await c.query(`LISTEN ${EVENTS_CHANNEL}`);
    client = c;
    if (everConnected && io) {
      // We may have missed notifications while disconnected: tell every client to refetch.
      io.emit('sync.required', { reason: 'Realtime connection was restored' });
      console.log('[bus] listener reconnected; clients asked to resync');
    }
    everConnected = true;
  } catch (err) {
    console.error('[bus] could not start listener (retrying):', err.message);
    retry();
  }
}

export async function startBus(io) {
  stopped = false;
  await connect(io);
}

export async function stopBus() {
  stopped = true;
  const c = client;
  client = null;
  if (c) {
    c.removeAllListeners();
    c.on('error', () => {});
    await c.end().catch(() => {});
  }
}

export const busConnected = () => client !== null;
