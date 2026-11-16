import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; the deploy workflow sets this.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: {
    target: 'es2023',
    sourcemap: true,
    // The vendor chunk is ~1.2 MB minified (~330 kB gzipped), nearly all of it
    // Three.js, which barely tree-shakes. That is the known cost of the
    // renderer; the limit sits just above it so that real growth still warns.
    chunkSizeWarningLimit: 1300,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Dependencies change far less often than app code. Keeping them in
          // their own chunk means a deploy does not invalidate ~1 MB of cache.
          groups: [{ name: 'vendor', test: /node_modules/ }],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    benchmark: { include: ['src/**/*.bench.ts'] },
  },
});
