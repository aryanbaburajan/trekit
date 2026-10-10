import os from 'node:os';
import path from 'node:path';
import { boundsFor, overpassQuery, normalizeElements, DiskCache, tileXY, elevationGrid, WORLD_METRES } from '../server/lib/world.js';
import { RequestQueue, geocode, overpass } from '../server/lib/providers.js';

// Vercel's deployed filesystem is read-only. /tmp is intentionally best-effort:
// it survives warm invocations but must never be required for correctness.
const cache = new DiskCache(path.join(os.tmpdir(), 'trekit-cache'));
const geoQueue = new RequestQueue(1000);
const mapQueue = new RequestQueue(200);

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const place = (url.searchParams.get('place') || '').trim();
  if (!place || place.length > 160) return sendJson(res, 400, { error: 'Enter a place name (up to 160 characters).' });

  try {
    const key = `world:v4:${place.toLowerCase()}`;
    const cached = await cache.get(key);
    if (cached) return sendJson(res, 200, { ...cached, cached: true });

    const location = await geocode(place, geoQueue);
    const sizeMetres = WORLD_METRES;
    const bounds = boundsFor(location.lat, location.lon, sizeMetres);
    const raw = await mapQueue.run(() => overpass(overpassQuery(bounds)));
    const data = normalizeElements(raw.elements, bounds, sizeMetres);
    if (!data.roads.length) throw Object.assign(new Error('No driveable roads were found in this 1 km area.'), { status: 422 });

    const elevation = await elevationGrid(bounds, path.join(os.tmpdir(), 'trekit-cache'));
    const terrain = {
      zoom: 12,
      centerTile: tileXY(location.lat, location.lon, 12),
      provider: elevation.unavailable ? 'Flat fallback (Terrarium unavailable)' : 'Terrarium / AWS Elevation Tiles',
    };
    const world = {
      place: location, bounds, sizeMetres, areaReduced: false, terrain, elevation, ...data,
      source: { osm: '© OpenStreetMap contributors', fetchedAt: new Date().toISOString(), overpass: true },
    };
    await cache.set(key, world);
    return sendJson(res, 200, world);
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || 'Unable to load this world.' });
  }
}
