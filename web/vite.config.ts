import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Multi-page build: each original GitHub Pages URL keeps its exact path
// (index.html, api.html, playground.html, ratelimit.html at the site root).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../pages-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        api: fileURLToPath(new URL('api.html', import.meta.url)),
        playground: fileURLToPath(new URL('playground.html', import.meta.url)),
        ratelimit: fileURLToPath(new URL('ratelimit.html', import.meta.url)),
      },
    },
  },
});
