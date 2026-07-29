import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite configuration.
 *
 * Two decisions worth noting:
 *
 * 1. The dev server proxies `/api` to the backend. This means the browser sees
 *    a same-origin request during development, so the httpOnly refresh cookie
 *    works without `SameSite=None`/HTTPS locally, and there is no CORS
 *    preflight on every call. Production uses the real cross-origin URL from
 *    `VITE_API_BASE_URL`.
 *
 * 2. Vendor code is split into deliberate chunks. Left alone, Recharts (~400KB)
 *    lands in the same bundle as the login screen, so a user waits for charting
 *    code before they can type a password.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env['VITE_DEV_API_TARGET'] ?? 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
    },
  },

  preview: {
    port: 4173,
  },

  build: {
    outDir: 'dist',
    // Source maps in production make Sentry-style error reports readable while
    // adding nothing to the download (browsers fetch them only when devtools
    // are open).
    sourcemap: mode !== 'production' ? true : 'hidden',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query', 'axios'],
          'chart-vendor': ['recharts'],
          'form-vendor': ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
  },
}));
