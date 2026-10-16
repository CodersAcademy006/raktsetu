// Small fixed gazetteer for the demo region (Mumbai Metropolitan Region, plus a
// couple of far-away localities to exercise radius escalation). Real deployment
// would call a geocoding API; this stays offline and deterministic for the demo.
const GAZETTEER: Record<string, [number, number]> = {
  andheri: [72.8697, 19.1197],
  bandra: [72.8296, 19.0596],
  dadar: [72.8446, 19.0178],
  powai: [72.9081, 19.1176],
  borivali: [72.8567, 19.2307],
  thane: [72.9781, 19.2183],
  "navi mumbai": [73.0297, 19.033],
  vashi: [72.9986, 19.0771],
  worli: [72.8166, 19.0176],
  "colaba": [72.8311, 18.9067],
  kurla: [72.8791, 19.0728],
  mulund: [72.9566, 19.1726],
  panvel: [73.1175, 18.9894],
  pune: [73.8567, 18.5204],
  nashik: [73.7898, 19.9975],
};

export function geocode(locationText: string): [number, number] | null {
  const key = locationText.trim().toLowerCase();
  if (GAZETTEER[key]) return GAZETTEER[key];
  const match = Object.keys(GAZETTEER).find((name) => key.includes(name));
  return match ? GAZETTEER[match] : null;
}

export function knownLocalityNames(): string[] {
  return Object.keys(GAZETTEER);
}

function distanceKm([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// Human place name for a shared GPS position: the nearest gazetteer locality
// within maxKm, else null (callers fall back to coordinates).
export function nearestLocality(coords: [number, number], maxKm = 8): string | null {
  let best: { name: string; km: number } | null = null;
  for (const [name, point] of Object.entries(GAZETTEER)) {
    const km = distanceKm(coords, point);
    if (km <= maxKm && (!best || km < best.km)) best = { name, km };
  }
  return best ? best.name.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}
