// Distance helpers (straight-line "as the crow flies" distance between two lat/lng points).

function haversineMeters(a, b) {
  if (!hasCoords(a) || !hasCoords(b)) return null;
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function hasCoords(p) {
  return !!p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) &&
    !(Number(p.lat) === 0 && Number(p.lng) === 0);
}

// Roads are rarely straight; 1.3x the straight line is a fair walking estimate in a city.
function walkingMinutes(meters) {
  if (meters == null) return null;
  return Math.max(1, Math.round((meters * 1.3) / 80)); // ~80 m per minute
}

module.exports = { haversineMeters, hasCoords, walkingMinutes };
