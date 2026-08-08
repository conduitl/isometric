import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Dev resolves @engine/* straight to package sources — no build step while iterating.
export default defineConfig({
  resolve: {
    alias: {
      '@engine/math': r('../../packages/math/src/index.ts'),
      '@engine/core': r('../../packages/core/src/index.ts'),
      '@engine/projection': r('../../packages/projection/src/index.ts'),
      '@engine/renderer': r('../../packages/renderer/src/index.ts'),
      '@engine/renderer-canvas2d': r('../../packages/renderer-canvas2d/src/index.ts'),
      '@engine/world-format': r('../../packages/world-format/src/index.ts'),
      '@engine/tilemap': r('../../packages/tilemap/src/index.ts'),
      '@engine/testkit': r('../../packages/testkit/src/index.ts'),
    },
  },
})
