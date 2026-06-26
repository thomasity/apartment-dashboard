export function avg(groups, key) {
  const vals = Object.values(groups);
  if (!vals.length) return 50;
  return Math.round(vals.reduce((s, g) => s + (g[key] ?? 50), 0) / vals.length);
}

export function spread(devices, key) {
  const vals = Object.values(devices).map((d) => d[key] ?? 50);
  if (vals.length < 2) return 0;
  return Math.max(...vals) - Math.min(...vals);
}

export function tempLabel(ct) {
  return ct < 33 ? 'Warm' : ct < 67 ? 'Neutral' : 'Cool';
}
