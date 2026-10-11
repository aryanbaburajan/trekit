import { setDefaultResultOrder } from 'node:dns';

// Some networks advertise IPv6 but cannot reliably reach the public OSM hosts.
// Prefer IPv4 before retrying a provider, while retaining IPv6 as a fallback.
setDefaultResultOrder('ipv4first');

const timeoutFetch = async (url, options = {}, ms = 25000) => {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); }
};

export class RequestQueue {
  constructor(interval = 0) { this.interval = interval; this.tail = Promise.resolve(); this.last = 0; }
  run(fn) { const job = this.tail.then(async () => { const wait = Math.max(0, this.interval - (Date.now() - this.last)); if (wait) await new Promise(r => setTimeout(r, wait)); this.last = Date.now(); return fn(); }); this.tail = job.catch(() => {}); return job; }
}

const featuredLocations = new Map([
  ['shibuya crossing, tokyo, japan', { name: 'Shibuya Crossing, Tokyo, Japan', lat: 35.6595, lon: 139.7005, countryCode: 'jp', country: 'Japan' }],
  ['myeongdong, seoul, south korea', { name: 'Myeongdong, Seoul, South Korea', lat: 37.5636, lon: 126.9852, countryCode: 'kr', country: 'South Korea' }],
  ['avenida paulista, são paulo, brazil', { name: 'Avenida Paulista, São Paulo, Brazil', lat: -23.5614, lon: -46.6559, countryCode: 'br', country: 'Brazil' }],
  ['khao san road, bangkok, thailand', { name: 'Khao San Road, Bangkok, Thailand', lat: 13.7589, lon: 100.4970, countryCode: 'th', country: 'Thailand' }],
  ['kalverstraat, amsterdam, netherlands', { name: 'Kalverstraat, Amsterdam, Netherlands', lat: 52.3699, lon: 4.8913, countryCode: 'nl', country: 'Netherlands' }],
]);

export async function geocode(place, queue) {
  const featured = featuredLocations.get(place.toLowerCase());
  if (featured) return { ...featured, osmType: null, osmId: null };
  return queue.run(async () => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await timeoutFetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(place)}`, { headers: { 'User-Agent': 'Trekit Live Place Explorer/1.0 (personal use)' } }, 15000);
        if (!response.ok) {
          if (response.status !== 429 && response.status < 500) throw Object.assign(new Error('Place search is temporarily unavailable.'), { status: 502 });
          throw new Error(`Nominatim returned ${response.status}`);
        }
        const [match] = await response.json();
        if (!match) throw Object.assign(new Error('No matching place was found.'), { status: 404 });
        return { name: match.display_name, lat: Number(match.lat), lon: Number(match.lon), osmType: match.osm_type, osmId: match.osm_id, countryCode: match.address?.country_code?.toLowerCase() || null, country: match.address?.country || null };
      } catch (error) {
        if (error.status === 404 || error.status === 502) throw error;
        lastError = error;
        console.warn('Nominatim request failed', {
          attempt: attempt + 1,
          message: error.message,
          name: error.name,
          code: error.cause?.code,
          cause: error.cause?.message,
        });
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    throw Object.assign(new Error('Place search is temporarily unavailable. Please try again shortly.'), { status: 502, cause: lastError });
  });
}

const overpassHosts = [
  ...(process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : []),
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
export async function overpass(query, fetcher = timeoutFetch, hosts = overpassHosts) {
  let error;
  for (let i = 0; i < hosts.length; i++) {
    try {
      const response = await fetcher(hosts[i], { method: 'POST', headers: { 'content-type': 'text/plain', 'User-Agent': 'Trekit Live Place Explorer/1.0' }, body: query }, 55000);
      if (response.ok) return response.json();
      error = new Error(`Overpass returned ${response.status}`);
      console.warn('Overpass returned an error response', { host: hosts[i], attempt: i + 1, status: response.status });
      if (response.status !== 429 && response.status < 500) throw error;
    } catch (e) {
      error = e;
      console.warn('Overpass request failed', {
        host: hosts[i],
        attempt: i + 1,
        message: e.message,
        name: e.name,
        code: e.cause?.code,
        cause: e.cause?.message,
      });
    }
    if (i < hosts.length - 1) await new Promise(r => setTimeout(r, 500 * (i + 1)));
  }
  throw Object.assign(new Error('Map data is currently unavailable. Please try again shortly.'), { status: 503, cause: error });
}
