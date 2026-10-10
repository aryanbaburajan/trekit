# Trekit Live Place Explorer

Search for a place and drive a 5 × 5 km OSM world. Searches are explicit (there is no autocomplete) so public Nominatim use stays rate-limited and cacheable.

```sh
npm install
npm run dev
```

The Vite client is available on port 5173 and proxies `/api` to the Express server on port 3000. For production:

```sh
npm run build
npm start
```

World and Terrarium tile responses are stored in `server/cache` for 24 hours. The server deliberately limits geocoding to one request per second, queues upstream map work, has bounded timeouts, and tries alternate Overpass instances for transient timeout/rate-limit failures. Public services are appropriate for personal/light use only; set up an alternate provider before deploying at scale.

The initial Munnar world is offline and flat by design so it remains available while searches load or recover from errors. Terrain is decoded from Terrarium RGB samples when tile retrieval succeeds; otherwise a flat collision-safe terrain fallback is returned.
