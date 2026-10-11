# Trekit Live Place Explorer

Search for a place and drive a 5 × 5 km OSM world. Searches are explicit (there is no autocomplete) so public Nominatim use stays rate-limited and cacheable.

```sh
npm install
npm run dev
```

`npm run dev` starts the app through the Vercel runtime, so the Vite client and `/api/world` function run together. It uses `npx` to fetch the Vercel CLI if it is not already installed.

The API deliberately limits geocoding to one request per second per warm function instance, queues upstream map work, has bounded timeouts, and tries alternate Overpass instances for transient timeout/rate-limit failures. Public services are appropriate for personal/light use only; add durable shared rate limiting and caching before deploying at scale.

The app opens in Shibuya Crossing cruise mode. Terrain is decoded from Terrarium RGB samples when tile retrieval succeeds; otherwise a flat collision-safe terrain fallback is returned.

## Vercel deployment

This repository deploys as one Vercel project. Vite builds the browser app into `dist`, and the live-world endpoint is the serverless function at `api/world.js`; the browser continues to call `/api/world` on the same origin. There is no production Express server.

Deploy by importing the repository in Vercel (or running `vercel` from the project root). `vercel.json` supplies the build output and a 60-second function duration for the upstream OSM request. The cache uses Vercel's ephemeral `/tmp` storage, so it improves warm requests but is not persistent across instances or deployments. For durable shared caching, add Vercel KV/Redis later.
