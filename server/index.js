import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundsFor, overpassQuery, normalizeElements, DiskCache, tileXY, elevationGrid, WORLD_METRES } from './lib/world.js';
import { RequestQueue, geocode, overpass } from './lib/providers.js';

const app = express(); const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = new DiskCache(path.join(root, 'server/cache')); const geoQueue = new RequestQueue(1000); const mapQueue = new RequestQueue(200);
app.get('/api/terrain/:z/:x/:y.png', async (req, res) => {
  const z=Number(req.params.z),x=Number(req.params.x),y=Number(req.params.y);
  if (!Number.isInteger(z)||!Number.isInteger(x)||!Number.isInteger(y)||z<0||z>15||x<0||y<0||x>=2**z||y>=2**z) return res.status(400).json({error:'Invalid terrain tile.'});
  const folder=path.join(root,'server/cache/tiles'), file=path.join(folder,`${z}-${x}-${y}.png`);
  try { const stat=await fs.stat(file); if(Date.now()-stat.mtimeMs<24*60*60*1000) return res.type('png').send(await fs.readFile(file)); } catch { /* cache miss */ }
  try { const upstream=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,{signal:AbortSignal.timeout(20000)});if(!upstream.ok)throw Error('Terrain provider failed');const tile=Buffer.from(await upstream.arrayBuffer());await fs.mkdir(folder,{recursive:true});await fs.writeFile(file,tile);res.type('png').send(tile); } catch { res.status(503).json({error:'Terrain tile unavailable.'}); }
});
app.get('/api/world', async (req, res) => {
  const place = String(req.query.place || '').trim();
  if (!place || place.length > 160) return res.status(400).json({ error: 'Enter a place name (up to 160 characters).' });
  try {
    const key = `world:v4:${place.toLowerCase()}`; const cached = await cache.get(key); if (cached) return res.json({ ...cached, cached: true });
    const location = await geocode(place, geoQueue); const sizeMetres = WORLD_METRES, bounds = boundsFor(location.lat, location.lon, sizeMetres);
    const raw = await mapQueue.run(() => overpass(overpassQuery(bounds)));
    const data = normalizeElements(raw.elements, bounds, sizeMetres);
    if (!data.roads.length) throw Object.assign(new Error('No driveable roads were found in this 1 km area.'), { status: 422 });
    const elevation = await elevationGrid(bounds, path.join(root, 'server/cache'));
    const terrain = { zoom: 12, centerTile: tileXY(location.lat, location.lon, 12), provider: elevation.unavailable ? 'Flat fallback (Terrarium unavailable)' : 'Terrarium / AWS Elevation Tiles' };
    const world = { place: location, bounds, sizeMetres, areaReduced: false, terrain, elevation, ...data, source: { osm: '© OpenStreetMap contributors', fetchedAt: new Date().toISOString(), overpass: true } };
    await cache.set(key, world); res.json(world);
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'Unable to load this world.' }); }
});
app.use(express.static(path.join(root, 'client/dist')));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(root, 'client/dist/index.html')));
if (process.env.NODE_ENV !== 'test') app.listen(process.env.PORT || 3000, () => console.log('Trekit server on http://localhost:3000'));
export default app;
