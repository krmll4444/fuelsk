import test from 'node:test';
import assert from 'node:assert/strict';
import {
  unifyFuelKey,
  normalizePricesObject,
  fuelLabel,
  BRAND_PRODUCTS,
} from '../sources/fuel_taxonomy.mjs';
import { parseOpeningHours, isOpenAt } from '../sources/hours.mjs';
import { analyzeNetworkPrices, enrichStations } from '../sources/enrich.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeWin1250 } from '../sources/encoding.mjs';

test('unifyFuelKey maps codes and brand names', () => {
  assert.equal(unifyFuelKey(4096), 'natural95_plus');
  assert.equal(unifyFuelKey(2), 'natural95');
  assert.equal(unifyFuelKey(128), 'natural100');
  assert.equal(unifyFuelKey('natural99_plus'), 'natural100');
  assert.equal(unifyFuelKey('MaxxMotion 95'), 'natural95_plus');
  assert.equal(unifyFuelKey('Efecta Diesel'), 'diesel');
  assert.equal(unifyFuelKey('V-Power Diesel'), 'diesel_plus');
  assert.equal(unifyFuelKey('95 Natural+'), 'natural95_plus');
  assert.equal(fuelLabel('natural95'), '95 звичайний');
});

test('brand product table covers major SK networks', () => {
  for (const brand of ['Slovnaft', 'OMV', 'Shell', 'MOL', 'Orlen']) {
    assert.ok(BRAND_PRODUCTS[brand]?.length >= 2, brand);
  }
});

test('normalizePricesObject merges legacy keys', () => {
  const out = normalizePricesObject({
    natural99_plus: { eur: 1.99, updatedAt: '2026-09-01', source: 'x' },
    natural100: { eur: 1.95, updatedAt: '2026-09-20', source: 'x' },
  });
  assert.equal(out.natural100.eur, 1.95);
  assert.equal(out.natural99_plus, undefined);
});

test('parseOpeningHours + isOpenAt for 24/7 fixture', () => {
  const html = decodeWin1250(
    fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'station_609.html'),
    ),
  );
  const hours = parseOpeningHours(html);
  assert.equal(hours.length, 7);
  const state = isOpenAt(hours, new Date('2026-09-29T12:00:00+02:00'));
  assert.equal(state.open, true);
});

test('analyzeNetworkPrices detects uniform brand', () => {
  const stations = [
    { id: 'a', brand: 'OMV', prices: { natural95_plus: { eur: 1.886 } }, labels: [] },
    { id: 'b', brand: 'OMV', prices: { natural95_plus: { eur: 1.886 } }, labels: [] },
    { id: 'c', brand: 'Shell', prices: { natural95_plus: { eur: 1.79 } }, labels: [] },
    { id: 'd', brand: 'Shell', prices: { natural95_plus: { eur: 1.85 } }, labels: [] },
  ];
  const { networks, stationFlags } = analyzeNetworkPrices(stations);
  assert.equal(networks.OMV.fuels.natural95_plus.uniform, true);
  assert.equal(networks.Shell.fuels.natural95_plus.uniform, false);
  assert.ok(stationFlags.get('a').labels.includes('network_price'));
});

test('enrichStations adds network / open labels', () => {
  const stations = [
    {
      id: 'a',
      brand: 'OMV',
      hours: Array.from({ length: 7 }, (_, day) => ({ day, open: '00:00', close: '24:00' })),
      prices: { natural95_plus: { eur: 1.886, updatedAt: '2026-09-29' } },
      labels: [],
    },
    {
      id: 'b',
      brand: 'OMV',
      hours: Array.from({ length: 7 }, (_, day) => ({ day, open: '08:00', close: '08:01' })),
      prices: { natural95_plus: { eur: 1.886, updatedAt: '2026-09-29' } },
      labels: [],
    },
  ];
  enrichStations(stations, { now: new Date('2026-09-29T12:00:00+02:00') });
  assert.ok(stations[0].labels.includes('network_price'));
  assert.ok(stations[0].labels.includes('open_now'));
  assert.ok(stations[1].labels.includes('closed_now'));
});
