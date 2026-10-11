import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

export const WORLD_METRES = 1000;
export const DENSE_WORLD_METRES = 1000;
export const DENSE_ELEMENT_THRESHOLD = 12000;
export const CACHE_AGE = 24 * 60 * 60 * 1000;

export function boundsFor(lat, lon, size = WORLD_METRES) {
  const latDelta = size / 2 / 111_320;
  const lonDelta = size / 2 / (111_320 * Math.cos(lat * Math.PI / 180));
  return { south: lat - latDelta, west: lon - lonDelta, north: lat + latDelta, east: lon + lonDelta };
}

export function overpassQuery(bounds, countOnly = false) {
  const b = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  return `[out:json][timeout:45];(way[highway](${b});node["name"][amenity](${b});node["name"][shop](${b});node["name"][tourism](${b});node["name"][leisure](${b});node["name"][historic](${b});node["name"][natural](${b});way["name"][amenity](${b});way["name"][shop](${b});way["name"][tourism](${b});way["name"][leisure](${b});way["name"][historic](${b});way["name"][natural](${b});way[building](${b}););out ${countOnly ? 'count' : 'body geom'};`;
}

export function buildingHeight(tags = {}) {
  const height = Number.parseFloat(tags.height);
  if (Number.isFinite(height) && height > 0) return Math.min(height, 150);
  const levels = Number.parseFloat(tags['building:levels']);
  if (Number.isFinite(levels) && levels > 0) return Math.min(levels * 3, 150);
  return 8;
}

export function poiCategory(tags = {}) {
  const food = new Set(['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream']);
  if (food.has(tags.amenity) || tags.shop === 'supermarket' || tags.shop === 'convenience' || tags.shop === 'greengrocer') return 'food';
  if (tags.amenity) return 'amenity';
  if (tags.shop) return 'shop';
  if (tags.tourism) return 'tourism';
  if (tags.leisure) return 'leisure';
  if (tags.historic || tags.natural) return 'landmark';
  return 'place';
}

export function normalizeElements(elements, bounds, size = WORLD_METRES) {
  if (!Array.isArray(elements)) throw Object.assign(new Error('Map data was unavailable.'), { status: 502 });
  const point = (lat, lon) => ({ x: (lon - bounds.west) / (bounds.east - bounds.west) * size - size / 2, z: size / 2 - (lat - bounds.south) / (bounds.north - bounds.south) * size });
  const roads = [], buildings = [], pois = [];
  for (const e of elements) {
    if (!e || typeof e !== 'object') continue;
    const tags = e.tags || {};
    const geometry = e.geometry || (Number.isFinite(e.lat) ? [{ lat: e.lat, lon: e.lon }] : []);
    if (tags.highway && geometry.length > 1) roads.push({ id: `${e.type}/${e.id}`, highway: tags.highway, points: geometry.map(p => point(p.lat, p.lon)), tags });
    if (tags.building && geometry.length > 2) buildings.push({ id: `${e.type}/${e.id}`, points: geometry.map(p => point(p.lat, p.lon)), height: buildingHeight(tags), tags });
    if (tags.name && (tags.amenity || tags.shop || tags.tourism || tags.leisure || tags.historic || tags.natural)) {
      const c = geometry[0];
      if (c) pois.push({ id: `${e.type}/${e.id}`, name: tags.name, category: poiCategory(tags), position: point(c.lat, c.lon), tags });
    }
  }
  pois.sort((a, b) => Number(b.category === 'food') - Number(a.category === 'food') || a.name.localeCompare(b.name));
  return { roads, buildings, pois };
}

// OpenFreeMap exposes the OpenMapTiles schema as CDN-cached vector tiles.
// It is intentionally a rendering-oriented subset of OSM, but includes the
// three layers the explorer needs without running a costly Overpass query.
export async function openFreeMapWorld(bounds, size = WORLD_METRES, zoom = 14) {
  const n = 2 ** zoom;
  const tile = (lat, lon) => ({ x: (lon + 180) / 360 * n, y: (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n });
  const nw = tile(bounds.north, bounds.west), se = tile(bounds.south, bounds.east);
  const tiles = [];
  for (let x = Math.floor(nw.x); x <= Math.floor(se.x); x++) for (let y = Math.floor(nw.y); y <= Math.floor(se.y); y++) tiles.push({ x, y });
  const fetched = await Promise.all(tiles.map(async ({ x, y }) => {
    const response = await fetch(`https://tiles.openfreemap.org/planet/latest/${zoom}/${x}/${y}.pbf`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`OpenFreeMap returned ${response.status}`);
    return { x, y, tile: new VectorTile(new PbfReader(await response.arrayBuffer())) };
  }));
  const point = ([lon, lat]) => ({ x: (lon - bounds.west) / (bounds.east - bounds.west) * size - size / 2, z: size / 2 - (lat - bounds.south) / (bounds.north - bounds.south) * size });
  const coordinatePairs = coordinates => Array.isArray(coordinates?.[0]) ? coordinates.flatMap(coordinatePairs) : [coordinates];
  const touchesBounds = coordinates => { const pairs = coordinatePairs(coordinates); const lons = pairs.map(p => p[0]), lats = pairs.map(p => p[1]); return lons.length && Math.max(...lons) >= bounds.west && Math.min(...lons) <= bounds.east && Math.max(...lats) >= bounds.south && Math.min(...lats) <= bounds.north; };
  const roads = [], buildings = [], pois = [], water = [], seen = new Set();
  const addRoad = (id, highway, coordinates, tags) => { if (coordinates.length > 1) roads.push({ id, highway: highway || 'road', points: coordinates.map(point), tags }); };
  for (const { x, y, tile: vectorTile } of fetched) {
    const transportation = vectorTile.layers.transportation;
    for (let i = 0; transportation && i < transportation.length; i++) {
      const feature = transportation.feature(i), geometry = feature.toGeoJSON(x, y, zoom).geometry, id = `openfreemap/transportation/${feature.id}`;
      if (seen.has(id) || !touchesBounds(geometry.coordinates)) continue;
      seen.add(id);
      const tags = { ...feature.properties, highway: feature.properties.class || feature.properties.subclass || 'road' };
      if (geometry.type === 'LineString') addRoad(id, tags.highway, geometry.coordinates, tags);
      if (geometry.type === 'MultiLineString') geometry.coordinates.forEach((line, index) => addRoad(`${id}/${index}`, tags.highway, line, tags));
    }
    const building = vectorTile.layers.building;
    for (let i = 0; building && i < building.length; i++) {
      const feature = building.feature(i), geometry = feature.toGeoJSON(x, y, zoom).geometry, id = `openfreemap/building/${feature.id}`;
      if (seen.has(id) || !touchesBounds(geometry.coordinates)) continue;
      seen.add(id);
      const rings = geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.type === 'MultiPolygon' ? geometry.coordinates.map(polygon => polygon[0]) : [];
      const tags = { ...feature.properties, height: feature.properties.render_height || feature.properties.height };
      rings.forEach((ring, index) => ring?.length > 2 && buildings.push({ id: `${id}/${index}`, points: ring.map(point), height: buildingHeight(tags), tags }));
    }
    const waterLayer = vectorTile.layers.water;
    for (let i = 0; waterLayer && i < waterLayer.length; i++) {
      const feature = waterLayer.feature(i), geometry = feature.toGeoJSON(x, y, zoom).geometry, id = `openfreemap/water/${feature.id}`;
      if (seen.has(id) || !touchesBounds(geometry.coordinates)) continue;
      seen.add(id);
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
      polygons.forEach((polygon, index) => polygon?.[0]?.length > 2 && water.push({ id: `${id}/${index}`, points: polygon[0].map(point), tags: feature.properties }));
    }
    const poi = vectorTile.layers.poi;
    for (let i = 0; poi && i < poi.length; i++) {
      const feature = poi.feature(i), geometry = feature.toGeoJSON(x, y, zoom).geometry, id = `openfreemap/poi/${feature.id}`;
      if (seen.has(id) || geometry.type !== 'Point' || !touchesBounds(geometry.coordinates)) continue;
      seen.add(id);
      const tags = { ...feature.properties, amenity: feature.properties.subclass || feature.properties.class };
      const name = feature.properties.name || feature.properties.name_en || feature.properties.name_int;
      if (name) pois.push({ id, name, category: poiCategory(tags), position: point(geometry.coordinates), tags });
    }
  }
  pois.sort((a, b) => Number(b.category === 'food') - Number(a.category === 'food') || a.name.localeCompare(b.name));
  if (!roads.length) throw new Error('OpenFreeMap returned no driveable roads for this area.');
  // Vector tiles overlap along their borders and can contain far more geometry
  // than this interactive renderer can draw in a dense kilometre. Keep the
  // closest geometry rather than rejecting the whole place as Overpass did.
  const nearCentre = item => { const points = item.points || [item.position]; return points.reduce((total, p) => total + p.x * p.x + p.z * p.z, 0) / points.length; };
  return { roads: roads.sort((a, b) => nearCentre(a) - nearCentre(b)).slice(0, 3000), buildings: buildings.sort((a, b) => nearCentre(a) - nearCentre(b)).slice(0, 3000), pois, water };
}

export function tileXY(lat, lon, zoom) {
  const n = 2 ** zoom, x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  return { x, y };
}

export async function elevationGrid(bounds, directory, zoom = 12, grid = 65) {
  const tileCache = path.join(directory, 'tiles');
  const getTile = async (x, y) => {
    const filename = path.join(tileCache, `${zoom}-${x}-${y}.png`);
    try { const stat = await fs.stat(filename); if (!isExpired(stat.mtimeMs)) return PNG.sync.read(await fs.readFile(filename)); } catch { /* cache miss */ }
    const response = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Terrain tiles are unavailable');
    const bytes = Buffer.from(await response.arrayBuffer()); await fs.mkdir(tileCache, { recursive: true }); await fs.writeFile(filename, bytes); return PNG.sync.read(bytes);
  };
  try {
    const tiles = new Map();
    const sample = async (lat, lon) => { const raw = tileXY(lat, lon, zoom), key=`${raw.x}/${raw.y}`; if(!tiles.has(key))tiles.set(key,getTile(raw.x,raw.y)); const png=await tiles.get(key); const n=2**zoom, fx=(lon+180)/360*n-raw.x, fy=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n-raw.y, px=Math.max(0,Math.min(255,Math.floor(fx*256))),py=Math.max(0,Math.min(255,Math.floor(fy*256))),i=(py*png.width+px)*4; return png.data[i]*256+png.data[i+1]+png.data[i+2]/256-32768; };
    const heights=[]; for(let z=0;z<grid;z++)for(let x=0;x<grid;x++){const lat=bounds.north-(bounds.north-bounds.south)*z/(grid-1),lon=bounds.west+(bounds.east-bounds.west)*x/(grid-1);heights.push(await sample(lat,lon));}
    const base=Math.min(...heights); return { grid, heights: heights.map(h=>h-base), baseElevation: base };
  } catch { return { grid: 2, heights: [0,0,0,0], unavailable: true }; }
}

export class DiskCache {
  constructor(directory) { this.directory = directory; }
  file(key) { return path.join(this.directory, crypto.createHash('sha256').update(key).digest('hex') + '.json'); }
  async get(key) { try { const data = JSON.parse(await fs.readFile(this.file(key), 'utf8')); return Date.now() - data.saved < CACHE_AGE ? data.value : null; } catch { return null; } }
  async set(key, value) { await fs.mkdir(this.directory, { recursive: true }); await fs.writeFile(this.file(key), JSON.stringify({ saved: Date.now(), value })); return value; }
}

export function isExpired(saved, now = Date.now()) { return now - saved >= CACHE_AGE; }
