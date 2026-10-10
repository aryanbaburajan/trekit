import { writeFile, mkdir } from 'node:fs/promises';

const routes = [
  ['Munnar–Top Station', [77.059, 10.089], [77.243, 10.129]],
  ['Munnar–Marayoor', [77.059, 10.089], [77.162, 10.274]],
  ['Munnar–Lockhart Gap', [77.059, 10.089], [77.135, 10.002]],
  ['Munnar–Chinnakanal', [77.059, 10.089], [77.183, 10.030]],
  ['Munnar–Eravikulam', [77.059, 10.089], [77.062, 10.164]],
];

function simplify(points, tolerance = 0.000045) {
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop(); const [ax, ay] = points[start], [bx, by] = points[end];
    const dx = bx - ax, dy = by - ay, denom = dx * dx + dy * dy; let best = tolerance * tolerance, index = -1;
    for (let i = start + 1; i < end; i++) { const [x, y] = points[i]; const t = denom ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / denom)) : 0; const ex = ax + t * dx, ey = ay + t * dy, dist = (x - ex) ** 2 + (y - ey) ** 2; if (dist > best) { best = dist; index = i; } }
    if (index >= 0) { keep[index] = 1; stack.push([start, index], [index, end]); }
  }
  return points.filter((_, i) => keep[i]);
}

const out = [];
for (const [name, from, to] of routes) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.join(',')};${to.join(',')}?overview=full&geometries=geojson`;
  const response = await fetch(url, { headers: { 'User-Agent': 'MunnarTerrainAtlas/1.0 (local visualization)' } });
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  const data = await response.json();
  out.push({ name, coordinates: simplify(data.routes[0].geometry.coordinates) });
}
await mkdir('src/data', { recursive: true });
await writeFile('src/data/munnar-roads.json', JSON.stringify(out));
