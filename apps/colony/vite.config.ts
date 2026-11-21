import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The page is served by src/server/main.ts, which also answers /api.
// With --dev the server mounts Vite as middleware instead of serving dist/web.
// JSX compiles with Vite's own transform; React Fast Refresh is left out
// because its inline preamble script would break the page's CSP.
export default defineConfig({
  root: fileURLToPath(new URL('./src/web', import.meta.url)),
  plugins: [tailwindcss()],
  oxc: { jsx: { runtime: 'automatic' } },
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
    target: 'es2023',
    // One bundle with React, Radix and xterm, served from loopback.
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      // Libraries built for React Server Components mark files "use client",
      // which means nothing in a plain client bundle.
      onwarn(warning, warn) {
        if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning)
      },
    },
  },
})
