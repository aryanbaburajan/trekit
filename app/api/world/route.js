import path from 'node:path';
import { boundsFor, overpassQuery, normalizeElements, DiskCache, tileXY, elevationGrid, WORLD_METRES } from '../../../lib/world.js';
import { RequestQueue, geocode, overpass } from '../../../lib/providers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cacheDirectory = process.env.TREKIT_CACHE_DIR || path.join(process.cwd(), '.cache');
const cache = new DiskCache(cacheDirectory);
const geoQueue = new RequestQueue(1000);
const mapQueue = new RequestQueue(200);

export async function GET(request) {
  const place = request.nextUrl.searchParams.get('place')?.trim() || '';
  if (!place || place.length > 160) return Response.json({ error: 'Enter a place name (up to 160 characters).' }, { status: 400 });

  try {
    const key = `world:v4:${place.toLowerCase()}`;
    const cached = await cache.get(key);
    if (cached) return Response.json({ ...cached, cached: true }, { headers: { 'cache-control': 'no-store' } });

    const location = await geocode(place, geoQueue);
    const sizeMetres = WORLD_METRES;
    const bounds = boundsFor(location.lat, location.lon, sizeMetres);
    const raw = await mapQueue.run(() => overpass(overpassQuery(bounds)));
    const data = normalizeElements(raw.elements, bounds, sizeMetres);
    if (!data.roads.length) throw Object.assign(new Error('No driveable roads were found in this 1 km area.'), { status: 422 });

    const elevation = await elevationGrid(bounds, cacheDirectory);
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
    return Response.json(world, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('World request failed', {
      place,
      status: error.status || 500,
      message: error.message,
      name: error.name,
      code: error.cause?.code,
      cause: error.cause?.message,
    });
    return Response.json({ error: error.message || 'Unable to load this world.' }, { status: error.status || 500 });
  }
}
