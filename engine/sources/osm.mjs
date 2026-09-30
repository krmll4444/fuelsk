/**
 * OpenStreetMap / Overpass: amenity=fuel in Slovakia (or a kraj bbox).
 * Used as a directory of stations — usually without prices.
 */

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Approx bounding boxes for SK kraje (south,west,north,east). */
export const REGION_BBOX = {
  KE: [48.35, 20.15, 49.05, 22.15],
  PO: [48.75, 20.55, 49.55, 22.65],
  BA: [48.00, 16.80, 48.55, 17.55],
  BB: [48.10, 18.85, 49.05, 20.15],
  NR: [47.70, 17.60, 48.65, 19.15],
  TN: [48.55, 17.55, 49.25, 18.85],
  TT: [48.15, 17.15, 48.85, 18.15],
  ZA: [48.85, 18.35, 49.65, 20.05],
  SK: [47.70, 16.80, 49.65, 22.65],
};

function brandFromTags(tags = {}) {
  const raw = tags.brand || tags.operator || tags.name || null;
  if (!raw) return null;
  const s = String(raw);
  const known = ['Slovnaft', 'OMV', 'Shell', 'MOL', 'Orlen', 'Benzina', 'Tescoma', 'Avanti', 'Tank ONO'];
  for (const k of known) {
    if (s.toLowerCase().includes(k.toLowerCase())) return k;
  }
  return s.split(/[,(/]/)[0].trim().slice(0, 40) || null;
}

function normalizeOsmStation(el) {
  const tags = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const brand = brandFromTags(tags);
  const name =
    tags.name ||
    (brand ? `${brand}` : null) ||
    `OSM ${el.type}/${el.id}`;
  const address = [tags['addr:street'], tags['addr:housenumber'], tags['addr:city']]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || null;

  return {
    id: `osm-${el.type[0]}${el.id}`,
    name,
    brand,
    address,
    lat: Number(lat),
    lon: Number(lon),
    region: null,
    sources: ['osm'],
    hours: null,
    hoursSummary: tags.opening_hours || null,
    labels: [],
    openNow: null,
    prices: {},
    osm: {
      type: el.type,
      id: el.id,
      opening_hours: tags.opening_hours || null,
    },
  };
}

export function buildOverpassQuery({ region = 'KE' } = {}) {
  const bbox = REGION_BBOX[region] || REGION_BBOX.KE;
  const [s, w, n, e] = bbox;
  return `
[out:json][timeout:90];
(
  node["amenity"="fuel"](${s},${w},${n},${e});
  way["amenity"="fuel"](${s},${w},${n},${e});
);
out center tags;
`.trim();
}

export async function fetchOsmFuel({
  region = 'KE',
  fetchFn = fetch,
  log = console.log,
} = {}) {
  const query = buildOverpassQuery({ region });
  let lastErr;
  for (const url of OVERPASS_URLS) {
    try {
      log(`osm: overpass ${url} region=${region}`);
      const res = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'FuelSK/0.1 (https://github.com/krmll/fuelsk)',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const stations = (data.elements || [])
        .map(normalizeOsmStation)
        .filter(Boolean);
      log(`osm: ${stations.length} fuel POIs`);
      return stations;
    } catch (err) {
      lastErr = err;
      log(`osm: ${url} failed: ${err.message}`);
    }
  }
  throw lastErr || new Error('Overpass failed');
}
