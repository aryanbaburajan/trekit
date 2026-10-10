import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

// Munnar / Devikulam tourism region. The SRTM cells are kept unfiltered: one
// source sample is selected for each map vertex, preserving ridges and folds.
const bounds = { south: 9.94, north: 10.34, west: 76.84, east: 77.38 };
// 721 × 721 vertices across the 60 × 44 km view: roughly 75 m sample spacing.
// Values are sampled directly from the 30 m SRTM input without interpolation.
const grid = 720;
const cache = new Map();
async function tile(lat, lon) {
  const key = `N${String(lat).padStart(2, '0')}E${String(lon).padStart(3, '0')}`;
  if (!cache.has(key)) cache.set(key, new DataView(gunzipSync(await readFile(`/tmp/munnar-dem/${key}.hgt.gz`)).buffer));
  return cache.get(key);
}
async function elevation(lat, lon) {
  const tLat = Math.floor(lat), tLon = Math.floor(lon), data = await tile(tLat, tLon);
  const row = Math.max(0, Math.min(3600, Math.round((tLat + 1 - lat) * 3600)));
  const col = Math.max(0, Math.min(3600, Math.round((lon - tLon) * 3600)));
  const v = data.getInt16((row * 3601 + col) * 2, false);
  return v < -1000 ? 0 : v;
}
const heights = [];
for (let z = 0; z <= grid; z++) {
  const lat = bounds.south + (bounds.north - bounds.south) * z / grid;
  for (let x = 0; x <= grid; x++) {
    const lon = bounds.west + (bounds.east - bounds.west) * x / grid;
    heights.push(await elevation(lat, lon));
  }
}
await mkdir('src/data', { recursive: true });
await writeFile('src/data/munnar-dem.json', JSON.stringify({ bounds, grid, heights }));
