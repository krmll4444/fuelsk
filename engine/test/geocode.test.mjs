import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddress, FIXTURE_GEOSEED, geocodeStations } from '../geocode.mjs';

test('normalizeAddress collapses whitespace and case', () => {
  assert.equal(normalizeAddress('  Košice   Barca '), 'košice barca');
});

test('offline geocode applies fixture seed', async () => {
  const stations = [
    {
      id: 'bsk-609',
      name: 'OMV',
      address: 'Osloboditeľov, 040 17, Košice - Barca',
      lat: null,
      lon: null,
    },
  ];
  const result = await geocodeStations(stations, {
    offline: true,
    seed: FIXTURE_GEOSEED,
    cachePath: undefined,
    log: () => {},
  });
  assert.equal(result.fromCache, 1);
  assert.ok(stations[0].lat);
  assert.ok(stations[0].lon);
});
