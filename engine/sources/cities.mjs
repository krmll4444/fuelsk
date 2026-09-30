/**
 * Cities available in PWA settings — collector iterates these by default.
 * region = benzin.sk / OSM kraj code (BA, BB, KE, NR, PO, TN, TT, ZA).
 */

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

export function cityById(id) {
  return SK_CITIES.find((c) => c.id === id) || null;
}

/** Resolve city list from CLI / env. */
export function resolveCities({ cityIds, allCities } = {}) {
  if (allCities || !cityIds?.length) return [...SK_CITIES];
  const out = [];
  for (const id of cityIds) {
    const c = cityById(id);
    if (!c) throw new Error(`Unknown city id: ${id}`);
    out.push(c);
  }
  return out;
}

export function uniqueRegions(cities) {
  return [...new Set(cities.map((c) => c.region))];
}
