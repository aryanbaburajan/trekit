import { writeFile, mkdir } from 'node:fs/promises';

const bounds = { south: 9.94, north: 10.34, west: 76.84, east: 77.38 };
// Small API cells avoid OSM's response-size cap around dense Munnar town roads.
const step = 0.05;
const nodes = new Map(), ways = new Map();
const excluded = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'bridleway', 'corridor', 'construction', 'proposed', 'raceway', 'elevator']);
const attr = (text, name) => text.match(new RegExp(`${name}="([^"]+)"`))?.[1];

function simplify(points, tolerance = 0.000008) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1; const stack = [[0, points.length - 1]];
  while (stack.length) { const [start, end] = stack.pop(), [ax, ay] = points[start], [bx, by] = points[end], dx = bx - ax, dy = by - ay, denom = dx * dx + dy * dy; let best = tolerance * tolerance, index = -1;
    for (let i = start + 1; i < end; i++) { const [x, y] = points[i], t = denom ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / denom)) : 0, ex = ax + t * dx, ey = ay + t * dy, distance = (x - ex) ** 2 + (y - ey) ** 2; if (distance > best) { best = distance; index = i; } }
    if (index >= 0) { keep[index] = 1; stack.push([start, index], [index, end]); }
  }
  return points.filter((_, index) => keep[index]);
}

for (let south = bounds.south; south < bounds.north; south += step) for (let west = bounds.west; west < bounds.east; west += step) {
  const north = Math.min(bounds.north, south + step), east = Math.min(bounds.east, west + step);
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${west.toFixed(5)}%2C${south.toFixed(5)}%2C${east.toFixed(5)}%2C${north.toFixed(5)}`;
  let xml;
  for (let attempt = 0; attempt < 4; attempt++) { try { const response = await fetch(url, { headers: { 'User-Agent': 'MunnarTerrainAtlas/1.0 (road visualization)' }, signal: AbortSignal.timeout(60000) }); if (response.ok) { xml = await response.text(); break; } if (attempt === 3) throw new Error(`${response.status} for ${url}`); } catch (error) { if (attempt === 3) throw error; await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1))); } }
  for (const match of xml.matchAll(/<node\b([^>]*)\/>/g)) { const id = attr(match[1], 'id'), lat = Number(attr(match[1], 'lat')), lon = Number(attr(match[1], 'lon')); if (id && Number.isFinite(lat) && Number.isFinite(lon)) nodes.set(id, [lon, lat]); }
  for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) { const id = attr(match[1], 'id'), body = match[2], highway = body.match(/<tag k="highway" v="([^"]+)"\/>/)?.[1]; if (!id || !highway || excluded.has(highway)) continue; const refs = [...body.matchAll(/<nd ref="([^"]+)"\/>/g)].map(node => node[1]); if (refs.length > 1) ways.set(id, { highway, refs }); }
}
const roads = [];
for (const { highway, refs } of ways.values()) { const coordinates = refs.map(ref => nodes.get(ref)).filter(Boolean); if (coordinates.length > 1) roads.push({ highway, coordinates: simplify(coordinates) }); }
await mkdir('src/data', { recursive: true });
await writeFile('src/data/munnar-road-network.json', JSON.stringify(roads));
console.log(`Saved ${roads.length} roads from ${nodes.size} nodes.`);
