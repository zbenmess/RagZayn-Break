import { defineConfig } from 'vite';

// Le base path est injecté par le workflow GitHub Pages (BASE_PATH=/RagZayn-Break/).
// En local il reste '/' pour que `npm run dev` fonctionne sans configuration.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 3000,
  },
  server: { host: true, port: 5173 },
});
