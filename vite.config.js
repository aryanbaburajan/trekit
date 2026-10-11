import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root,
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: { index: `${root}/index.html`, jeep: `${root}/jeep.html` } },
  },
});
