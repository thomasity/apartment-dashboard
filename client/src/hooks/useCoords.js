import { useState, useEffect } from 'react';

let cached  = null;
let pending = null;

function requestCoords() {
  if (cached)  return Promise.resolve(cached);
  if (pending) return pending;
  pending = new Promise((resolve) => {
    if (!navigator?.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        cached = { lat: coords.latitude, lon: coords.longitude };
        resolve(cached);
      },
      () => resolve(null),
      { maximumAge: Infinity, timeout: 10000 },
    );
  });
  return pending;
}

export function useCoords() {
  const [coords, setCoords] = useState(cached);
  useEffect(() => {
    if (cached) return;
    requestCoords().then((c) => { if (c) setCoords(c); });
  }, []);
  return coords; // null until the GPS promise resolves
}
