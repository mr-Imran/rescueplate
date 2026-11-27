/** Dhaka city centre — default map view when no pin is set yet. */
export const DHAKA = { lat: 23.7808, lng: 90.4074 };

/** Same travel model as server R9 (must stay in sync with server/domain/rules.js LIMITS). */
const TRAVEL = { kmPerHour: 18, handoffMinutes: 12, arriveBufferMinutes: 5 };

function haversineKm(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every((n) => Number.isFinite(Number(n)))) return null;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Client preview of R9: would this claim expire on the road?
 * Server remains the authority; this only drives UI warnings.
 */
export function assessRouteSafety(donor, ngo, safeUntil, now = Date.now()) {
  const distanceKm = haversineKm(donor, ngo);
  if (distanceKm == null) return null;
  const travelMinutes = Math.ceil((Math.max(0, distanceKm) / TRAVEL.kmPerHour) * 60) + TRAVEL.handoffMinutes;
  const eta = now + travelMinutes * 60_000;
  const deadline = new Date(safeUntil).getTime();
  const ok = deadline - eta >= TRAVEL.arriveBufferMinutes * 60_000;
  return { ok, distanceKm: Math.round(distanceKm * 10) / 10, travelMinutes };
}

export function parseCoord(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatCoord(n, digits = 5) {
  return Number(n).toFixed(digits);
}

/** Browser geolocation as a promise. Rejects with a short user-facing message. */
export function getCurrentPosition(options = { enableHighAccuracy: true, timeout: 10000 }) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot share a location. Click the map or type coordinates instead.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        const denied = err?.code === 1;
        reject(new Error(denied ? 'Location permission was denied. Click the map or type coordinates instead.' : 'Location was not shared. Click the map or type coordinates instead.'));
      },
      options,
    );
  });
}

/**
 * OpenStreetMap Nominatim reverse geocode. Returns a short address string, or null.
 * Rate-limited by Nominatim; callers should debounce and send a clear User-Agent via the app.
 */
export async function reverseGeocode(lat, lng, { signal } = {}) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=0`;
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data?.display_name;
  return typeof text === 'string' && text.length > 0 ? text.slice(0, 300) : null;
}
