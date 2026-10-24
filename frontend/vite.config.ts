import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
      '/incidents': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
      '/runbooks': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
      '/memory': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
      '/stats': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
