# Trekit Live Place Explorer

Search for a place and drive a 1 × 1 km OSM world. Searches are explicit (there is no autocomplete) so public Nominatim use stays rate-limited and cacheable.

```sh
npm install
npm run dev
```

`npm run dev` starts the complete Next.js application, including the browser scene and `/api/world` route handler. Use `npm run build && npm start` for a production server.

The API deliberately limits geocoding to one request per second per warm function instance, queues upstream map work, has bounded timeouts, and tries alternate Overpass instances for transient timeout/rate-limit failures. Public services are appropriate for personal/light use only; add durable shared rate limiting and caching before deploying at scale.

The app opens in Shibuya Crossing cruise mode. Terrain is decoded from Terrarium RGB samples when tile retrieval succeeds; otherwise a flat collision-safe terrain fallback is returned.

## Runtime

This is a conventional Next.js application. The browser scene lives in `app/page.js`, while `app/api/world/route.js` is a standard Node route handler for live world data. It can run on any Node host that supports Next.js; it has no Vercel-specific configuration.

World responses and elevation tiles use the local `.cache` directory by default, so they survive server restarts. Set `TREKIT_CACHE_DIR` to choose another persistent writable cache location.

For production reliability, set `OVERPASS_URL` to a hosted or self-managed Overpass interpreter endpoint. Without it, the app falls back across public Overpass instances, which are best-effort services and can be temporarily overloaded.

## Presentation warmup

Start the app, then run this from another terminal before presenting:

```sh
npm run warmup
```

It loads the five cruise locations serially into the local `.cache` directory. The featured buttons also use fixed coordinates, so they do not depend on Nominatim during the presentation. Custom searches still use Nominatim.
