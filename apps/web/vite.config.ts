import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss()],
    // Dev only: forward API calls to the local backend and hardware bridge so the browser stays same-origin.
    server: {
      proxy: {
        '/api': { target: env.DEV_API_PROXY_TARGET || 'http://localhost:8080', changeOrigin: true },
        '/bridge': { target: 'http://127.0.0.1:5001', rewrite: path => path.replace(/^\/bridge/, ''), changeOrigin: true },
      },
    },
  }
})
