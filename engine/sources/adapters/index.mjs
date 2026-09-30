/**
 * Adapter stubs for additional price sources.
 * Each must eventually return stations compatible with stations.json schema
 * and use unifyFuelKey() for fuel ids.
 */

import { unifyFuelKey } from '../fuel_taxonomy.mjs';

/** @typedef {{ id: string, name: string, brand: string|null, address: string|null, lat: number|null, lon: number|null, sources: string[], prices: Record<string, {eur:number, updatedAt:string|null, source:string}> }} Station */

export async function fetchOsmFuelSk(opts) {
  const { fetchOsmFuel } = await import('../osm.mjs');
  const stations = await fetchOsmFuel(opts);
  return { source: 'osm', stations };
}

export async function fetchNetworkListPrices() {
  // Slovnaft / OMV / Shell / MOL / Orlen public pages — often one national price.
  return {
    source: 'networks',
    listPrices: /** @type {Record<string, Record<string, number>>} */ ({}),
    note: 'not implemented — see docs/sources.md',
  };
}

export async function fetchGoogleFuelOptions() {
  return { source: 'google_places', stations: [], note: 'optional; needs API key + SK coverage check' };
}

export function mapRawFuelName(name) {
  return unifyFuelKey(name);
}
