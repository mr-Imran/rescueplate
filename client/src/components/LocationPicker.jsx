import { useEffect, useRef, useState } from 'react';
import { formatCoord, getCurrentPosition, parseCoord, reverseGeocode } from '../lib/geo.js';
import { Button, Field } from './ui.jsx';
import { LocationMap } from './LocationMap.jsx';

/**
 * OpenStreetMap pin picker used when registering or editing an organization.
 * Keeps address / lat / lng in sync: click or drag the pin, use GPS, or type numbers.
 * Optionally reverse-geocodes via Nominatim to fill a blank address.
 */
export function LocationPicker({
  lat,
  lng,
  address,
  onChange,
  errors = {},
  fillAddress = true,
  errorKeys = { lat: 'lat', lng: 'lng', address: 'address' },
}) {
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const abortRef = useRef(null);

  const latN = parseCoord(lat);
  const lngN = parseCoord(lng);
  const hasPin = latN != null && lngN != null && latN >= -90 && latN <= 90 && lngN >= -180 && lngN <= 180;

  const applyPin = async ({ lat: nextLat, lng: nextLng }, { reverse = true } = {}) => {
    const patch = { lat: formatCoord(nextLat), lng: formatCoord(nextLng) };
    onChange(patch);
    setGeoError(null);

    if (!fillAddress || !reverse) return;
    // Only auto-fill when the address is empty, so we never overwrite a typed one.
    if (address && address.trim().length >= 5) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLookingUp(true);
    try {
      const found = await reverseGeocode(nextLat, nextLng, { signal: ctrl.signal });
      if (found && !ctrl.signal.aborted) onChange({ ...patch, address: found });
    } catch {
      // Nominatim is best-effort; coordinates are enough to save.
    } finally {
      if (!ctrl.signal.aborted) setLookingUp(false);
    }
  };

  useEffect(() => () => abortRef.current?.abort(), []);

  const locate = async () => {
    setLocating(true);
    setGeoError(null);
    try {
      const pos = await getCurrentPosition();
      await applyPin(pos);
    } catch (err) {
      setGeoError(err.message);
    } finally {
      setLocating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="label">Location on map</p>
        <p className="mb-2 text-xs text-stone-600">Click the map or drag the pin. Used to measure distance for NGOs and volunteers.</p>
        <LocationMap
          lat={hasPin ? latN : null}
          lng={hasPin ? lngN : null}
          interactive
          onPick={(p) => applyPin(p)}
          height="16rem"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={locate} busy={locating}>
            Use my current location
          </Button>
          {lookingUp && <span className="text-xs text-stone-500">Looking up address…</span>}
          {hasPin && (
            <span className="tabular text-xs text-stone-500">
              {formatCoord(latN)}, {formatCoord(lngN)}
            </span>
          )}
        </div>
        {(geoError || errors[errorKeys.lat] || errors[errorKeys.lng]) && (
          <p className="mt-1 text-sm text-red-700" role="alert">
            {geoError || errors[errorKeys.lat] || errors[errorKeys.lng]}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude" required error={errors[errorKeys.lat]}>
          {(p) => (
            <input
              {...p}
              className="input"
              inputMode="decimal"
              placeholder="23.7461"
              value={lat}
              onChange={(e) => onChange({ lat: e.target.value })}
              onBlur={() => {
                if (hasPin) applyPin({ lat: latN, lng: lngN }, { reverse: false });
              }}
            />
          )}
        </Field>
        <Field label="Longitude" required error={errors[errorKeys.lng]}>
          {(p) => (
            <input
              {...p}
              className="input"
              inputMode="decimal"
              placeholder="90.3742"
              value={lng}
              onChange={(e) => onChange({ lng: e.target.value })}
              onBlur={() => {
                if (hasPin) applyPin({ lat: latN, lng: lngN }, { reverse: false });
              }}
            />
          )}
        </Field>
      </div>
    </div>
  );
}

/**
 * Live GPS track for volunteers on an open pickup. Polls the browser location
 * and shows it on the OpenStreetMap route from donor to NGO.
 */
export function LiveTrackMap({ donor, ngo, height = '12rem' }) {
  const [track, setTrack] = useState(null);
  const [error, setError] = useState(null);
  const [watching, setWatching] = useState(false);
  const watchRef = useRef(null);

  const stop = () => {
    if (watchRef.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    setWatching(false);
  };

  useEffect(() => () => stop(), []);

  const start = () => {
    setError(null);
    if (!navigator.geolocation) {
      setError('This browser cannot share a location.');
      return;
    }
    setWatching(true);
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => setTrack({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        setError('Could not track your location. Check browser permission.');
        stop();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  };

  const markers = [
    { lat: donor.lat, lng: donor.lng, label: 'Collect', color: '#b45309', popup: `${donor.name}<br>${donor.address}` },
    { lat: ngo.lat, lng: ngo.lng, label: 'Deliver', color: '#047857', popup: `${ngo.name}<br>${ngo.address}` },
  ];

  return (
    <div>
      <LocationMap markers={markers} track={track} path height={height} zoom={13} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {watching ? (
          <Button variant="secondary" onClick={stop}>
            Stop tracking
          </Button>
        ) : (
          <Button variant="secondary" onClick={start}>
            Track my location
          </Button>
        )}
        {watching && track && (
          <span className="tabular text-xs text-stone-500">
            Live · {formatCoord(track.lat)}, {formatCoord(track.lng)}
          </span>
        )}
        {error && (
          <span className="text-xs text-red-700" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
