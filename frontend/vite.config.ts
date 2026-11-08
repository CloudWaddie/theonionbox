import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// The Box serves the build from /<session>/ - hence relative asset URLs only.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    outDir: '../theonionbox/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    // `npm run dev` against a running Box: open http://localhost:5173/?mock=1 for demo data
    port: 5173,
  },
})
