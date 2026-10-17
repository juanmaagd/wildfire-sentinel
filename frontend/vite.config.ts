import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
  // MapLibre spawns a web worker from its own URL; pre-bundling breaks it in dev.
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
