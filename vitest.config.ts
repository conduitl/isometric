import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Tests resolve @engine/* straight to package sources, so the suite runs without a
// build step. Published consumers use each package's dist via its exports map.
export default defineConfig({
  resolve: {
    alias: {
      '@engine/math': r('./packages/math/src/index.ts'),
      '@engine/core': r('./packages/core/src/index.ts'),
      '@engine/renderer': r('./packages/renderer/src/index.ts'),
      '@engine/renderer-canvas2d': r('./packages/renderer-canvas2d/src/index.ts'),
      '@engine/testkit': r('./packages/testkit/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
  },
})
