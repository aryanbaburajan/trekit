import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

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
