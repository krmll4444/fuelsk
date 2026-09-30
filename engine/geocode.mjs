import fs from 'node:fs';
import path from 'node:path';

const PHOTON = 'https://photon.komoot.io/api/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export function normalizeAddress(address) {
  return String(address || '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function loadGeocache(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

export function saveGeocache(filePath, cache) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

async function photonGeocode(address, { fetchFn = fetch } = {}) {
  const url = new URL(PHOTON);
  url.searchParams.set('q', `${address}, Slovakia`);
  url.searchParams.set('limit', '1');
  url.searchParams.set('lang', 'en');
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
  const data = await res.json();
  const feat = data?.features?.[0];
  if (!feat) return null;
  const [lon, lat] = feat.geometry.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Prefer SK results
  const cc = feat.properties?.countrycode;
  if (cc && cc.toUpperCase() !== 'SK') return null;
  return { lat, lon, source: 'photon' };
}

async function nominatimGeocode(address, { email, userAgent, fetchFn = fetch } = {}) {
  const url = new URL(NOMINATIM);
  url.searchParams.set('q', address);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'sk');
  if (email) url.searchParams.set('email', email);

  const res = await fetchFn(url, {
    headers: {
      // Nominatim blocks bare bot UAs; keep app id in the comment.
      'User-Agent':
        userAgent ||
        `Mozilla/5.0 (compatible; FuelSK/0.1; +https://github.com/krmll/fuelsk; ${email || 'local'})`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;
  const lat = Number(data[0].lat);
  const lon = Number(data[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, source: 'nominatim' };
}

/** Geocode address: Photon first, Nominatim fallback. */
export async function geocodeAddress(address, opts = {}) {
  const q = String(address || '').trim();
  if (!q) return null;
  try {
    const hit = await photonGeocode(q, opts);
    if (hit) return hit;
  } catch {
    /* fall through */
  }
  return nominatimGeocode(q, opts);
}

/**
 * Apply cache / geocoder to stations missing coordinates.
 * Mutates stations in place. Saves cache.
 */
export async function geocodeStations(
  stations,
  {
    cachePath,
    email = process.env.NOMINATIM_EMAIL,
    userAgent = process.env.USER_AGENT,
    delayMs = 1100,
    log = console.log,
    seed = {},
    offline = false,
  } = {},
) {
  const cache = { ...seed, ...loadGeocache(cachePath) };
  let lookedUp = 0;
  let fromCache = 0;
  let failed = 0;
  let lastAt = 0;

  async function throttle() {
    const wait = delayMs - (Date.now() - lastAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
  }

  for (const s of stations) {
    if (s.lat != null && s.lon != null) continue;
    const key = normalizeAddress(s.address || s.name);
    if (!key) {
      failed++;
      continue;
    }

    if (cache[key]?.lat != null && cache[key]?.lon != null) {
      s.lat = cache[key].lat;
      s.lon = cache[key].lon;
      fromCache++;
      continue;
    }

    if (offline) {
      failed++;
      continue;
    }

    try {
      await throttle();
      log(`geocode: ${s.address || s.name}`);
      const hit = await geocodeAddress(s.address || s.name, { email, userAgent });
      lookedUp++;
      if (!hit) {
        failed++;
        log(`  miss`);
        continue;
      }
      cache[key] = hit;
      s.lat = hit.lat;
      s.lon = hit.lon;
      log(`  → ${hit.lat}, ${hit.lon} (${hit.source})`);
    } catch (err) {
      failed++;
      log(`  error: ${err.message}`);
    }
  }

  if (cachePath) saveGeocache(cachePath, cache);
  log(`geocode done: cacheHits=${fromCache} lookups=${lookedUp} failed=${failed}`);
  return { fromCache, lookedUp, failed, cache };
}

/** Fixture / known coords for dry-run (Košice - Barca). */
export const FIXTURE_GEOSEED = {
  [normalizeAddress('Osloboditeľov, 040 17, Košice - Barca')]: {
    lat: 48.6635,
    lon: 21.2668,
    source: 'fixture',
  },
};
