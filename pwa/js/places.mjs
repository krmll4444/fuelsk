/** SK city presets (must stay in sync with engine/sources/cities.mjs). */

export const SK_CITIES = [
  { id: 'kosice', name: 'Košice', region: 'KE', lat: 48.7164, lon: 21.2611, bbox: [48.55, 21.05, 48.85, 21.45] },
  { id: 'bratislava', name: 'Bratislava', region: 'BA', lat: 48.1486, lon: 17.1077, bbox: [48.05, 16.95, 48.25, 17.30] },
  { id: 'presov', name: 'Prešov', region: 'PO', lat: 48.9985, lon: 21.2419, bbox: [48.92, 21.12, 49.08, 21.38] },
  { id: 'zilina', name: 'Žilina', region: 'ZA', lat: 49.2231, lon: 18.7394, bbox: [49.15, 18.60, 49.30, 18.90] },
  { id: 'nitra', name: 'Nitra', region: 'NR', lat: 48.3061, lon: 18.0863, bbox: [48.24, 17.98, 48.38, 18.20] },
  { id: 'banska_bystrica', name: 'Banská Bystrica', region: 'BB', lat: 48.7363, lon: 19.1462, bbox: [48.68, 19.05, 48.80, 19.25] },
  { id: 'trnava', name: 'Trnava', region: 'TT', lat: 48.3774, lon: 17.5883, bbox: [48.32, 17.50, 48.43, 17.68] },
  { id: 'trencin', name: 'Trenčín', region: 'TN', lat: 48.8945, lon: 18.0444, bbox: [48.84, 17.95, 48.95, 18.15] },
  { id: 'poprad', name: 'Poprad', region: 'PO', lat: 49.0614, lon: 20.2983, bbox: [49.02, 20.22, 49.10, 20.40] },
  { id: 'martin', name: 'Martin', region: 'ZA', lat: 49.0665, lon: 18.922, bbox: [49.02, 18.85, 49.12, 19.00] },
  { id: 'michalovce', name: 'Michalovce', region: 'KE', lat: 48.7543, lon: 21.9135, bbox: [48.70, 21.84, 48.81, 22.00] },
  { id: 'spisska_nova_ves', name: 'Spišská Nová Ves', region: 'KE', lat: 48.9446, lon: 20.5615, bbox: [48.90, 20.48, 48.99, 20.65] },
];

const boundaryCache = new Map();

export function cityById(id) {
  return SK_CITIES.find((c) => c.id === id) || null;
}

export function suggestAddresses(query, { limit = 6, lat, lon, lang = 'sk' } = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return Promise.resolve([]);
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('lang', lang === 'en' ? 'en' : 'sk');
  if (lat != null && lon != null) {
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
  }
  return fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`Photon ${res.status}`);
      return res.json();
    })
    .then((data) =>
      (data.features || [])
        .filter((f) => {
          const cc = f.properties?.countrycode;
          return !cc || cc.toUpperCase() === 'SK';
        })
        .map((f) => {
          const p = f.properties || {};
          const [lonV, latV] = f.geometry.coordinates;
          const label =
            [
              p.name,
              p.street && p.housenumber ? `${p.street} ${p.housenumber}` : p.street,
              p.city || p.town || p.village,
            ]
              .filter(Boolean)
              .join(', ') || p.name;
          return { label, lat: latV, lon: lonV, city: p.city || p.town || p.village || null };
        }),
    );
}

export function debounce(fn, ms = 280) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Ray casting for [lng, lat] rings (GeoJSON order). */
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInGeoJSON(lat, lon, geojson) {
  if (!geojson) return true;
  const type = geojson.type;
  if (type === 'Polygon') {
    const [outer, ...holes] = geojson.coordinates;
    if (!pointInRing(lon, lat, outer)) return false;
    for (const hole of holes) {
      if (pointInRing(lon, lat, hole)) return false;
    }
    return true;
  }
  if (type === 'MultiPolygon') {
    return geojson.coordinates.some((poly) =>
      pointInGeoJSON(lat, lon, { type: 'Polygon', coordinates: poly }),
    );
  }
  return true;
}

function bboxPolygon(bbox) {
  const [s, w, n, e] = bbox;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}

async function nominatimBoundary(cityName) {
  const attempts = [
    () => {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('city', cityName);
      url.searchParams.set('country', 'Slovakia');
      url.searchParams.set('format', 'json');
      url.searchParams.set('polygon_geojson', '1');
      url.searchParams.set('limit', '3');
      return url;
    },
    () => {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('q', `${cityName}, Slovakia`);
      url.searchParams.set('format', 'json');
      url.searchParams.set('polygon_geojson', '1');
      url.searchParams.set('limit', '3');
      url.searchParams.set('countrycodes', 'sk');
      return url;
    },
  ];

  let lastErr;
  for (const makeUrl of attempts) {
    try {
      const res = await fetch(makeUrl(), { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      const data = await res.json();
      const hit = (data || []).find(
        (h) =>
          h.geojson &&
          (h.geojson.type === 'Polygon' || h.geojson.type === 'MultiPolygon') &&
          (h.type === 'administrative' ||
            h.class === 'boundary' ||
            h.class === 'place' ||
            h.type === 'city' ||
            h.type === 'town'),
      ) || (data || []).find((h) => h.geojson && (h.geojson.type === 'Polygon' || h.geojson.type === 'MultiPolygon'));
      if (!hit?.geojson) throw new Error('no geojson');
      return { geojson: hit.geojson, source: 'nominatim', bbox: hit.boundingbox };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('nominatim failed');
}

/**
 * Returns { geojson, source } for a city id. Cached.
 * Falls back to city bbox rectangle if OSM boundary is unavailable.
 */
export async function fetchCityBoundary(cityId) {
  if (boundaryCache.has(cityId)) return boundaryCache.get(cityId);
  const city = cityById(cityId);
  if (!city) throw new Error('unknown city');

  let result;
  try {
    result = await nominatimBoundary(city.name);
  } catch {
    result = { geojson: bboxPolygon(city.bbox), source: 'bbox' };
  }
  boundaryCache.set(cityId, result);
  return result;
}
