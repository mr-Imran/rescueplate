// One Socket.IO connection per browser tab, plus the shared server clock.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';

let socket = null;
let everConnected = false;
const handlers = new Map(); // event name -> Set<fn>

function emitLocal(name, payload) {
  handlers.get(name)?.forEach((fn) => {
    try {
      fn(payload);
    } catch (err) {
      console.error(`live handler for ${name} failed`, err);
    }
  });
}

/* ------------------------------ connection ------------------------------ */

let connection = { status: 'offline' }; // 'offline' | 'connecting' | 'online' | 'reconnecting'
const connectionSubs = new Set();
function setConnection(status) {
  if (connection.status === status) return;
  connection = { status };
  connectionSubs.forEach((fn) => fn());
}
export function useConnection() {
  return useSyncExternalStore(
    (fn) => (connectionSubs.add(fn), () => connectionSubs.delete(fn)),
    () => connection,
  );
}

/* --------------------------------- clock -------------------------------- */
// Countdowns use the server's clock, not the device's, so a wrong phone clock
// (or the demo console's fast-forward) cannot show a misleading deadline.

let clock = { skewMs: 0, offsetSeconds: 0 };
const clockSubs = new Set();
export function setServerClock(serverNow, offsetSeconds = clock.offsetSeconds) {
  clock = { skewMs: serverNow - Date.now(), offsetSeconds };
  clockSubs.forEach((fn) => fn());
}
export const serverNow = () => Date.now() + clock.skewMs;
export function useClock() {
  return useSyncExternalStore(
    (fn) => (clockSubs.add(fn), () => clockSubs.delete(fn)),
    () => clock,
  );
}

/* -------------------------------- lifecycle ------------------------------ */

export function connectRealtime({ onAuthFailure } = {}) {
  if (socket) return;
  everConnected = false;
  setConnection('connecting');
  socket = io({ reconnectionDelay: 500, reconnectionDelayMax: 5000, randomizationFactor: 0.5 });

  socket.on('connect', () => {
    setConnection('online');
    // After a drop we may have missed events. Every page that shows live data
    // listens for "resync" and refetches a full snapshot from the REST API.
    if (everConnected) emitLocal('resync', { reason: 'reconnected' });
    everConnected = true;
  });
  socket.on('disconnect', (reason) => {
    setConnection('reconnecting');
    // The server closed the connection on purpose (sign-out elsewhere, suspension): check the session.
    if (reason === 'io server disconnect') {
      onAuthFailure?.();
      socket?.connect();
    }
  });
  socket.on('connect_error', (err) => {
    setConnection('reconnecting');
    if (err?.message === 'UNAUTHENTICATED') onAuthFailure?.();
  });
  socket.on('hello', (p) => setServerClock(p.serverNow, p.clockOffsetSeconds));
  socket.on('clock.changed', (p) => {
    setServerClock(p.serverNow, p.clockOffsetSeconds);
    emitLocal('resync', { reason: 'clock' });
  });
  socket.on('sync.required', (p) => emitLocal('resync', p));
  socket.onAny((name, payload) => emitLocal(name, payload));
}

export function disconnectRealtime() {
  socket?.close();
  socket = null;
  setConnection('offline');
}

/** Demo console: cut the connection for a few seconds to show reconnection and resync. */
export function simulateDrop(ms = 5000) {
  if (!socket) return;
  socket.disconnect();
  setConnection('reconnecting');
  setTimeout(() => socket?.connect(), ms);
}

export function sendLive(name, payload) {
  socket?.emit(name, payload);
}

/** Subscribes a component to a live event (or the local "resync" signal). */
export function useLive(name, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (payload) => ref.current(payload);
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name).add(fn);
    return () => handlers.get(name)?.delete(fn);
  }, [name]);
}

/**
 * Applies a live listing snapshot to a list. The copy with the higher version
 * wins, so duplicated or out-of-order events can never roll the UI backwards.
 * Pass `insert: true` for newly created listings so the feed shows them immediately
 * (instead of waiting for a full refetch).
 */
export function applyListing(items, incoming, { insert = false } = {}) {
  const idx = items.findIndex((item) => item.id === incoming.id);
  if (idx === -1) return insert ? [incoming, ...items] : items;
  if (incoming.version <= items[idx].version) return items;
  const next = items.slice();
  next[idx] = { ...incoming, distanceKm: items[idx].distanceKm };
  return next;
}
