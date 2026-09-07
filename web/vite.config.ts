/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The FastAPI backend serves /api; in dev the Vite server proxies to it.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Browser tests live in e2e/ and run under Playwright, never under jsdom.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
