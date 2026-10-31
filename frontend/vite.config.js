import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3010,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:3011', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3011', ws: true, changeOrigin: true },
    },
  },
})
