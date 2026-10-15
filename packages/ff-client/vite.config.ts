// Vite and Vitest config for the client: React plugin, a dev server that proxies
// /api to the backend (VITE_API_TARGET), and the node-environment unit-test glob.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The dev server proxies /api to the backend so the client can use same-origin
// relative paths (the production nginx image does the same). SSE works through
// the proxy because Vite streams proxied responses.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['VITE_API_TARGET'] ?? 'http://localhost:8724',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
