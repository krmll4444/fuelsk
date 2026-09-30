/**
 * Merge benzin (prices) + OSM (directory) stations.
 * Match by distance + optional brand; prefer benzin fields, keep OSM coords if better.
 */

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function brandsCompatible(a, b) {
  if (!a || !b) return true; // unknown brand → allow distance-only match
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  return na.includes(nb) || nb.includes(na);
}

/**
 * @param {object[]} priced — from benzin
 * @param {object[]} osm — from Overpass
 * @param {number} [maxKm=0.12] — ~120 m
 */
export function mergeStations(priced = [], osm = [], { maxKm = 0.12 } = {}) {
  const usedOsm = new Set();
  const out = [];

  for (const s of priced) {
    let match = null;
    let best = maxKm;
    if (s.lat != null && s.lon != null) {
      for (const o of osm) {
        if (usedOsm.has(o.id)) continue;
        if (!brandsCompatible(s.brand, o.brand)) continue;
        const d = haversineKm(
          { lat: s.lat, lon: s.lon },
          { lat: o.lat, lon: o.lon },
        );
        if (d < best) {
          best = d;
          match = o;
        }
      }
    }
    if (match) {
      usedOsm.add(match.id);
      out.push({
        ...s,
        sources: [...new Set([...(s.sources || []), 'osm'])],
        // Prefer geocoded/OSM coords if benzin had none
        lat: s.lat ?? match.lat,
        lon: s.lon ?? match.lon,
        osmId: match.id,
        hoursSummary: s.hoursSummary || match.hoursSummary || null,
      });
    } else {
      out.push(s);
    }
  }

  for (const o of osm) {
    if (usedOsm.has(o.id)) continue;
    out.push(o);
  }

  return out;
}
