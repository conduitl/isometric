import { fileURLToPath } from 'node:url'
import { playwright } from '@vitest/browser-playwright'
import { configDefaults, defineConfig } from 'vitest/config'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Tests resolve @engine/* straight to package sources, so the suite runs without a
// build step. Published consumers use each package's dist via its exports map.
const engineAliases = {
  '@engine/math': r('./packages/math/src/index.ts'),
  '@engine/core': r('./packages/core/src/index.ts'),
  '@engine/renderer': r('./packages/renderer/src/index.ts'),
  '@engine/renderer-canvas2d': r('./packages/renderer-canvas2d/src/index.ts'),
  '@engine/testkit': r('./packages/testkit/src/index.ts'),
}

export default defineConfig({
  resolve: { alias: engineAliases },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/*.browser.test.ts'],
          environment: 'node',
        },
      },
      {
        // Visual regression on deterministic scenes, in a PINNED browser (Playwright's
        // bundled Chromium). Browser upgrades are deliberate baseline-re-bless PRs —
        // docs/DECISIONS.md R10. Run with: pnpm test:visual
        extends: true,
        test: {
          name: 'browser',
          include: ['**/*.browser.test.ts'],
          exclude: [...configDefaults.exclude],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            // Viewport must comfortably contain the largest test canvas — an element
            // screenshot clipped by the viewport silently weakens the parity contract.
            viewport: { width: 1024, height: 640 },
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
