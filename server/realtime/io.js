import { Server } from 'socket.io';
import { readSessionToken } from '../auth/middleware.js';
import { findSessionUser } from '../auth/sessions.js';
import { query } from '../db/pool.js';
import { getClockOffsetSeconds } from '../lib/clock.js';

// listingId -> Map(socketId -> { userId, name }) : who currently has the edit form open.
const editors = new Map();

function editorsOf(listingId) {
  const seen = new Map();
  for (const e of editors.get(listingId)?.values() || []) seen.set(e.userId, e);
  return [...seen.values()];
}

function broadcastEditors(io, listingId, orgId) {
  io.to(`org:${orgId}`).emit('presence.editing', { listingId, editors: editorsOf(listingId) });
}

export function createIo(httpServer) {
  const io = new Server(httpServer, {
    // Same-origin only: no CORS headers are sent, so other sites cannot open a socket with the cookie.
    serveClient: false,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 16 * 1024,
  });

  // Sockets authenticate with the same httpOnly session cookie as the REST API.
  io.use(async (socket, next) => {
    try {
      const user = await findSessionUser(readSessionToken(socket.handshake.headers.cookie));
      if (!user) return next(new Error('UNAUTHENTICATED'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('UNAVAILABLE'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user;
    // Rooms decide who hears what. Membership is set by the server only.
    socket.join(['feed', `user:${user.id}`, `role:${user.role}`]);
    if (user.orgId) socket.join(`org:${user.orgId}`);

    try {
      const offset = await getClockOffsetSeconds();
      socket.emit('hello', { serverNow: Date.now() + offset * 1000, clockOffsetSeconds: offset });
    } catch {
      /* the client falls back to /api/me */
    }

    // Presence: "Tanvir is also editing this listing". Only staff of the owning organization may join.
    socket.on('presence:editing', async (payload) => {
      try {
        const listingId = String(payload?.listingId || '');
        if (!/^[0-9a-f-]{36}$/i.test(listingId) || user.role !== 'donor') return;
        const owner = await query('SELECT donor_org_id FROM listings WHERE id = $1', [listingId]);
        if (owner.rows[0]?.donor_org_id !== user.orgId) return;
        if (payload.editing) {
          if (!editors.has(listingId)) editors.set(listingId, new Map());
          editors.get(listingId).set(socket.id, { userId: user.id, name: user.name });
          socket.data.editing = { ...(socket.data.editing || {}), [listingId]: user.orgId };
        } else {
          editors.get(listingId)?.delete(socket.id);
          if (socket.data.editing) delete socket.data.editing[listingId];
        }
        broadcastEditors(io, listingId, user.orgId);
      } catch {
        /* presence is best-effort */
      }
    });

    socket.on('disconnect', () => {
      for (const [listingId, orgId] of Object.entries(socket.data.editing || {})) {
        editors.get(listingId)?.delete(socket.id);
        if (editors.get(listingId)?.size === 0) editors.delete(listingId);
        broadcastEditors(io, listingId, orgId);
      }
    });
  });

  return io;
}
