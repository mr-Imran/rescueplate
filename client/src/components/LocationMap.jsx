import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DHAKA } from '../lib/geo.js';

// Vite does not rewrite Leaflet's default PNG icon URLs; draw markers as CSS pins instead.
const pin = (color, label) =>
  L.divIcon({
    className: 'rp-pin',
    html: `<span class="rp-pin__dot" style="--pin:${color}" title="${label || ''}"></span>${label ? `<span class="rp-pin__label">${label}</span>` : ''}`,
    iconSize: [28, 36],
    iconAnchor: [14, 34],
    popupAnchor: [0, -30],
  });

// Free raster tiles (no API key). OSM's own tile.openstreetmap.org and CARTO free CDN both block apps.
const TILES = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  attribution:
    'Tiles &copy; <a href="https://www.esri.com/">Esri</a> · Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};

/**
 * OpenStreetMap view.
 * - interactive: click (and optional drag) sets a single pin via onPick({lat,lng})
 * - markers: [{ lat, lng, label?, color?, popup? }] for read-only or multi-point views
 * - track: optional live { lat, lng } (e.g. volunteer GPS) shown as a distinct pin
 * - path: draw a polyline between marker positions in order
 */
export function LocationMap({
  lat,
  lng,
  markers = null,
  track = null,
  path = false,
  interactive = false,
  onPick,
  className = '',
  height = '14rem',
  zoom = 14,
}) {
  const host = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  // Create the map once.
  useEffect(() => {
    if (!host.current || mapRef.current) return undefined;
    const map = L.map(host.current, {
      center: [lat ?? DHAKA.lat, lng ?? DHAKA.lng],
      zoom,
      scrollWheelZoom: false,
      attributionControl: true,
    });
    L.tileLayer(TILES.url, { attribution: TILES.attribution, maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    if (interactive) {
      map.on('click', (e) => pickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    }

    // Leaflet needs a layout pass after the container is in the DOM.
    const t = setTimeout(() => map.invalidateSize(), 50);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep markers / track / path in sync.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const points = [];

    const list =
      markers ||
      (lat != null && lng != null
        ? [{ lat: Number(lat), lng: Number(lng), color: '#047857', label: interactive ? 'Pickup point' : 'Location', draggable: interactive }]
        : []);

    for (const m of list) {
      if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
      const marker = L.marker([m.lat, m.lng], {
        icon: pin(m.color || '#047857', m.label),
        draggable: Boolean(m.draggable && interactive),
        title: m.label || '',
      });
      if (m.popup) marker.bindPopup(m.popup);
      if (m.draggable && interactive) {
        marker.on('dragend', () => {
          const p = marker.getLatLng();
          pickRef.current?.({ lat: p.lat, lng: p.lng });
        });
      }
      marker.addTo(layer);
      points.push([m.lat, m.lng]);
    }

    if (track && Number.isFinite(track.lat) && Number.isFinite(track.lng)) {
      L.marker([track.lat, track.lng], { icon: pin('#2563eb', 'You'), title: 'Your location' }).addTo(layer);
      points.push([track.lat, track.lng]);
    }

    if (path && points.length >= 2) {
      L.polyline(points.slice(0, list.length), { color: '#047857', weight: 3, opacity: 0.75, dashArray: '6 6' }).addTo(layer);
    }

    if (points.length >= 2) {
      map.fitBounds(L.latLngBounds(points).pad(0.25), { maxZoom: 15, animate: false });
    } else if (points.length === 1) {
      map.setView(points[0], zoom, { animate: false });
    }
    map.invalidateSize();
  }, [lat, lng, markers, track, path, interactive, zoom]);

  return (
    <div
      ref={host}
      className={`rp-map overflow-hidden rounded-lg border border-stone-200 ${className}`}
      style={{ height }}
      role="img"
      aria-label={interactive ? 'Map: click to set the location pin' : 'Map of location'}
    />
  );
}
