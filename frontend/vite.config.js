import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In production (Render), the frontend is built as static files served by the
// same Express backend — so no proxy is needed. Dev proxy still works locally.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'build' },
});
