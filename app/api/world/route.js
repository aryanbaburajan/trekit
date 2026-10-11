import os from 'node:os';
import path from 'node:path';
import shibuya from '../../../data/featured/shibuya.json';
import myeongdong from '../../../data/featured/myeongdong.json';
import avenidaPaulista from '../../../data/featured/avenida-paulista.json';
import khaoSan from '../../../data/featured/khao-san.json';
import kalverstraat from '../../../data/featured/kalverstraat.json';
import { boundsFor, openFreeMapWorld, DiskCache, tileXY, elevationGrid, WORLD_METRES } from '../../../lib/world.js';
import { RequestQueue, geocode } from '../../../lib/providers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cacheDirectory = process.env.TREKIT_CACHE_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), 'trekit-cache') : path.join(process.cwd(), '.cache'));
const cache = new DiskCache(cacheDirectory);
const geoQueue = new RequestQueue(1000);

// These snapshots keep the featured cruise locations presentation-safe when a
// public Overpass mirror is slow or unavailable. Custom searches still fetch
// current data from OSM below.
const featuredWorlds = new Map([
  ['shibuya crossing, tokyo, japan', shibuya.value],
  ['myeongdong, seoul, south korea', myeongdong.value],
  ['avenida paulista, são paulo, brazil', avenidaPaulista.value],
  ['khao san road, bangkok, thailand', khaoSan.value],
  ['kalverstraat, amsterdam, netherlands', kalverstraat.value],
]);

export async function GET(request) {
  const place = request.nextUrl.searchParams.get('place')?.trim() || '';
  if (!place || place.length > 160) return Response.json({ error: 'Enter a place name (up to 160 characters).' }, { status: 400 });

  try {
    const featured = featuredWorlds.get(place.toLowerCase());
    if (featured) return Response.json({ ...featured, featured: true, cached: true }, { headers: { 'cache-control': 'public, max-age=3600, s-maxage=86400' } });

    const key = `world:v5:${place.toLowerCase()}`;
    const cached = await cache.get(key);
    if (cached) return Response.json({ ...cached, cached: true }, { headers: { 'cache-control': 'no-store' } });

    const location = await geocode(place, geoQueue);
    const sizeMetres = WORLD_METRES;
    const bounds = boundsFor(location.lat, location.lon, sizeMetres);
    const data = await openFreeMapWorld(bounds, sizeMetres);
    if (!data.roads.length) throw Object.assign(new Error('No driveable roads were found in this 1 km area.'), { status: 422 });

    const elevation = await elevationGrid(bounds, cacheDirectory);
    const terrain = {
      zoom: 12,
      centerTile: tileXY(location.lat, location.lon, 12),
      provider: elevation.unavailable ? 'Flat fallback (Terrarium unavailable)' : 'Terrarium / AWS Elevation Tiles',
    };
    const world = {
      place: location, bounds, sizeMetres, areaReduced: false, terrain, elevation, ...data,
      source: { osm: '© OpenStreetMap contributors', fetchedAt: new Date().toISOString(), provider: 'OpenFreeMap vector tiles', overpass: false },
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
