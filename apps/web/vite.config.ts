import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    // Dev only: forward API calls to the local backend so the browser stays same-origin (no CORS setup needed).
    server: { proxy: { '/api': { target: env.DEV_API_PROXY_TARGET || 'http://localhost:8080', changeOrigin: true } } },
  }
})
