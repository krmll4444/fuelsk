import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeStations } from '../sources/merge.mjs';

test('mergeStations keeps unmatched OSM and links nearby same brand', () => {
  const priced = [
    {
      id: 'bsk-1',
      brand: 'OMV',
      lat: 48.67,
      lon: 21.27,
      sources: ['benzin.sk'],
      prices: { natural95_plus: { eur: 1.8 } },
    },
  ];
  const osm = [
    {
      id: 'osm-n1',
      brand: 'OMV',
      lat: 48.6701,
      lon: 21.2701,
      sources: ['osm'],
      prices: {},
    },
    {
      id: 'osm-n2',
      brand: 'Shell',
      lat: 48.71,
      lon: 21.25,
      sources: ['osm'],
      prices: {},
    },
  ];
  const out = mergeStations(priced, osm);
  assert.equal(out.length, 2);
  const omv = out.find((s) => s.id === 'bsk-1');
  assert.ok(omv.sources.includes('osm'));
  assert.ok(out.some((s) => s.id === 'osm-n2'));
});
