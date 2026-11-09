import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // `--mode mock` (npm run dev:mock) mocks every endpoint and needs no local env file; the kiosk key is a placeholder.
  const mockMode = mode === 'mock'
  return {
    plugins: [react(), tailwindcss()],
    define: {
      // Always a literal, so without mock the dynamic import in main.tsx is removed from the build.
      'import.meta.env.VITE_API_MOCK': JSON.stringify(mockMode ? 'all' : env.VITE_API_MOCK ?? ''),
      ...(mockMode ? { 'import.meta.env.VITE_KIOSK_API_KEY': JSON.stringify('mock-kiosk-key') } : {}),
    },
    // Dev only: forward API calls to the local backend and hardware bridge so the browser stays same-origin.
    server: {
      proxy: {
        '/api': { target: env.DEV_API_PROXY_TARGET || 'http://localhost:8080', changeOrigin: true },
        '/bridge': { target: 'http://127.0.0.1:5001', rewrite: path => path.replace(/^\/bridge/, ''), changeOrigin: true },
      },
    },
  }
})
