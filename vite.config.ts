import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'web/src') },
  },
  // Relative base so the build works at a domain root or under a sub-path (e.g. GitHub Pages).
  base: './',
  server: { port: 5173 },
  build: { outDir: '../dist', emptyOutDir: true },
})
