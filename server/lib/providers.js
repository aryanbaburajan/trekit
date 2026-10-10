const timeoutFetch = async (url, options = {}, ms = 25000) => {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); }
};

export class RequestQueue {
  constructor(interval = 0) { this.interval = interval; this.tail = Promise.resolve(); this.last = 0; }
  run(fn) { const job = this.tail.then(async () => { const wait = Math.max(0, this.interval - (Date.now() - this.last)); if (wait) await new Promise(r => setTimeout(r, wait)); this.last = Date.now(); return fn(); }); this.tail = job.catch(() => {}); return job; }
}

export async function geocode(place, queue) {
  return queue.run(async () => {
    const response = await timeoutFetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(place)}`, { headers: { 'User-Agent': 'Trekit Live Place Explorer/1.0 (personal use)' } }, 15000);
    if (!response.ok) throw Object.assign(new Error('Place search is temporarily unavailable.'), { status: 502 });
    const [match] = await response.json();
    if (!match) throw Object.assign(new Error('No matching place was found.'), { status: 404 });
    return { name: match.display_name, lat: Number(match.lat), lon: Number(match.lon), osmType: match.osm_type, osmId: match.osm_id, countryCode: match.address?.country_code?.toLowerCase() || null, country: match.address?.country || null };
  });
}

const overpassHosts = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.nchc.org.tw/api/interpreter'];
export async function overpass(query, fetcher = timeoutFetch, hosts = overpassHosts) {
  let error;
  for (let i = 0; i < hosts.length; i++) {
    try {
      const response = await fetcher(hosts[i], { method: 'POST', headers: { 'content-type': 'text/plain', 'User-Agent': 'Trekit Live Place Explorer/1.0' }, body: query }, 55000);
      if (response.ok) return response.json();
      if (response.status !== 429 && response.status < 500) throw new Error(`Overpass returned ${response.status}`);
      error = new Error(`Overpass returned ${response.status}`);
    } catch (e) { error = e; }
    if (i < hosts.length - 1) await new Promise(r => setTimeout(r, 500 * (i + 1)));
  }
  throw Object.assign(new Error('Map data is currently unavailable. Please try again shortly.'), { status: 503, cause: error });
}
