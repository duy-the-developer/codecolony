import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The page is served by src/server/main.ts, which also answers /api.
// With --dev the server mounts Vite as middleware instead of serving dist/web.
export default defineConfig({
  root: fileURLToPath(new URL('./src/web', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
    target: 'es2023',
  },
})
