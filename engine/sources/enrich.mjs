import { isOpenAt } from './hours.mjs';

/**
 * Detect brands that keep (almost) the same price across stations.
 */
export function analyzeNetworkPrices(stations, { toleranceEur = 0.002 } = {}) {
  const bucket = new Map();

  for (const s of stations) {
    const brand = s.brand || '—';
    if (!bucket.has(brand)) bucket.set(brand, new Map());
    const byFuel = bucket.get(brand);
    for (const [fuel, p] of Object.entries(s.prices || {})) {
      if (p?.eur == null) continue;
      if (!byFuel.has(fuel)) byFuel.set(fuel, []);
      byFuel.get(fuel).push({ id: s.id, eur: p.eur, updatedAt: p.updatedAt });
    }
  }

  const networks = {};
  const stationFlags = new Map();

  for (const [brand, byFuel] of bucket) {
    const fuels = {};
    let uniformCount = 0;
    let compared = 0;

    for (const [fuel, rows] of byFuel) {
      if (rows.length < 2) continue;
      compared++;
      const prices = rows.map((r) => r.eur);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const uniform = max - min <= toleranceEur;
      if (uniform) {
        uniformCount++;
        const eur = Number((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(3));
        fuels[fuel] = {
          eur,
          uniform: true,
          stations: rows.length,
          updatedAt: rows.map((r) => r.updatedAt).filter(Boolean).sort().at(-1) || null,
        };
        for (const r of rows) {
          const prev = stationFlags.get(r.id) || { labels: [], networkUniformFuels: [] };
          prev.networkUniformFuels.push(fuel);
          if (!prev.labels.includes('network_price')) prev.labels.push('network_price');
          stationFlags.set(r.id, prev);
        }
      } else {
        fuels[fuel] = {
          eur: null,
          uniform: false,
          min,
          max,
          stations: rows.length,
        };
      }
    }

    if (compared > 0) {
      networks[brand] = {
        uniformShare: uniformCount / compared,
        mostlyUniform: compared > 0 && uniformCount / compared >= 0.5,
        fuels,
      };
    }
  }

  return { networks, stationFlags };
}

/**
 * Deal labels for one selected fuel (used by PWA; also callable from engine tests).
 */
export function dealLabelsForFuel(stations, fuel) {
  const rows = stations
    .map((s) => {
      const p = s.prices?.[fuel];
      if (!p || p.eur == null) return null;
      return { id: s.id, eur: p.eur };
    })
    .filter(Boolean);

  const byId = new Map();
  if (!rows.length) return byId;

  const mean = rows.reduce((n, r) => n + r.eur, 0) / rows.length;
  const bestEur = Math.min(...rows.map((r) => r.eur));

  for (const r of rows) {
    const labels = [];
    if (r.eur === bestEur) labels.push('best_price');
    if (r.eur <= mean * 0.985) labels.push('below_average');
    if (r.eur >= mean * 1.02) labels.push('above_average');
    byId.set(r.id, { labels, mean, bestEur, eur: r.eur });
  }
  return byId;
}

export function enrichStations(stations, { now } = {}) {
  const { networks, stationFlags } = analyzeNetworkPrices(stations);

  for (const s of stations) {
    s.prices = s.prices || {};
    const base = new Set(s.labels || []);
    const flags = stationFlags.get(s.id);
    if (flags) {
      for (const l of flags.labels) base.add(l);
      s.networkUniformFuels = flags.networkUniformFuels;
    }

    const openState = isOpenAt(s.hours, now);
    s.openNow = openState.open;
    s.openReason = openState.reason;
    if (openState.open === true) base.add('open_now');
    if (openState.open === false) base.add('closed_now');
    // Drop stale deal labels from previous runs — PWA recomputes per fuel
    for (const l of ['best_price', 'below_average', 'above_average']) base.delete(l);
    s.labels = [...base];
  }

  return { stations, networks };
}
