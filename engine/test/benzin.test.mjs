import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeWin1250Query, decodeWin1250 } from '../sources/encoding.mjs';
import { ocrPricePng } from '../sources/price_ocr.mjs';
import {
  parseSearchResults,
  parseStationPage,
  parseSkDate,
  buildSearchUrl,
  REGION_CODES,
  FUEL_CODES,
} from '../sources/benzin.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function readCp1250(name) {
  return decodeWin1250(fs.readFileSync(path.join(FIXTURES, name)));
}

test('win1250 encodes Košice and Vyhľadať like benzin.sk', () => {
  const qs = encodeWin1250Query({
    price_search_town: 'Košice',
    price_submit: 'Vyhľadať',
  });
  assert.match(qs, /price_search_town=Ko%9Aice/);
  assert.match(qs, /price_submit=Vyh%BEada%9D/);
});

test('buildSearchUrl uses KE region code 3 and Natural95+', () => {
  const url = buildSearchUrl({ town: 'Košice', region: REGION_CODES.KE });
  assert.match(url, /price_search_region=3/);
  assert.match(url, /price_search_fuel=4096/);
  assert.match(url, /selected_id=118/);
});

test('parseSkDate', () => {
  assert.equal(parseSkDate('25.09.2026'), '2026-09-25');
  assert.equal(parseSkDate('bogus'), null);
});

test('parseSearchResults from Košice fixture', () => {
  const html = readCp1250('search_kosice_natural95plus.html');
  const rows = parseSearchResults(html);
  assert.ok(rows.length >= 10, `expected many rows, got ${rows.length}`);

  const omv = rows.find((r) => r.pumpId === 609);
  assert.ok(omv);
  assert.equal(omv.brand, 'OMV');
  assert.match(omv.place, /Košice/);
  assert.match(omv.street, /Oslobod/i);
  assert.equal(omv.updatedAt, '2026-09-25');
  assert.equal(omv.fresh, true);

  const slovnaft = rows.find((r) => r.pumpId === 221);
  assert.ok(slovnaft);
  assert.equal(slovnaft.brand, 'Slovnaft');
});

test('parseSearchResults from empty-town KE fixture', () => {
  const html = readCp1250('search_ke_empty_town_natural95plus.html');
  const rows = parseSearchResults(html);
  assert.ok(rows.length > 20, `expected region-wide list, got ${rows.length}`);
});

test('parseStationPage extracts address, fuels and hours', () => {
  const html = readCp1250('station_609.html');
  const meta = parseStationPage(html, { pumpId: 609 });
  assert.equal(meta.brand, 'OMV');
  assert.match(meta.street, /Oslobod/i);
  assert.match(meta.place, /Barca/);
  assert.ok(meta.fuels.length >= 3);
  const keys = meta.fuels.map((f) => f.fuelKey);
  assert.ok(keys.includes('natural95_plus'));
  assert.ok(keys.includes('diesel'));
  assert.ok(keys.includes('lpg'));
  const n95 = meta.fuels.find((f) => f.fuelKey === 'natural95_plus');
  assert.equal(n95.updatedAt, '2026-09-25');
  assert.ok(meta.hours?.length >= 7);
  assert.equal(meta.hoursSummary, '24/7');
});

test('OCR price PNGs (large board)', () => {
  const cases = [
    ['609_4096.png', 1.886],
    ['609_8.png', 2.04],
    ['609_16.png', 0.849],
    ['221_4096.png', 1.846],
    ['608_4096.png', 1.872],
    ['381_4096.png', 1.799],
    ['383_4096.png', 1.855],
    ['221_256.png', 2.191],
  ];
  for (const [file, expected] of cases) {
    const buf = fs.readFileSync(path.join(FIXTURES, 'prices', file));
    const got = ocrPricePng(buf);
    assert.equal(got, expected, `${file}: got ${got}, expected ${expected}`);
  }
});

test('fuel and region code tables cover ini.md keys', () => {
  assert.equal(REGION_CODES.KE, 3);
  assert.equal(FUEL_CODES[4096], 'natural95_plus');
  assert.equal(FUEL_CODES[8], 'diesel');
  assert.equal(FUEL_CODES[16], 'lpg');
  assert.equal(FUEL_CODES[128], 'natural100');
});
