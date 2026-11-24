import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.API_URL || 'http://localhost:3000';

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    // In development the browser talks to Vite, which forwards API and WebSocket
    // traffic to the Node server. Same origin, so cookies work exactly as in production.
    proxy: {
      '/api': { target: api },
      '/socket.io': { target: api, ws: true },
    },
  },
});
