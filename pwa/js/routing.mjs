/** OSRM demo routing (top-N / pairwise compares only). */

const OSRM = 'https://router.project-osrm.org/route/v1/driving';

/**
 * @returns {{ distanceKm: number, durationMin: number, geometry: object|null }}
 */
export async function routeDriving(from, to) {
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `${OSRM}/${coords}?overview=false&alternatives=false&steps=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('Route not found');
  return {
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
  };
}

/**
 * Cost of going to a station and filling L liters.
 * driveEur — fuel burned on the way, valued at station price
 * fillEur — tank fill
 */
export function tripCosts({ distanceKm, priceEur, consumptionL100, tankLiters }) {
  const litersBurned = (distanceKm * consumptionL100) / 100;
  const driveEur = litersBurned * priceEur;
  const fillEur = tankLiters * priceEur;
  return {
    litersBurned,
    driveEur,
    fillEur,
    totalEur: driveEur + fillEur,
  };
}
