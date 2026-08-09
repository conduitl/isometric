import { fileURLToPath } from 'node:url'
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  integrations: [
    starlight({
      title: 'Math Game Engine',
      description:
        'A 2D web game engine that teaches math by refusing to hide it: the engine’s own coordinates, vectors, and projection matrices are the curriculum.',
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'What this is', slug: 'start/overview' },
            { label: 'Getting started', slug: 'start/getting-started' },
          ],
        },
        {
          label: 'The engine',
          items: [
            { label: 'Projections: one world, three matrices', slug: 'engine/projections' },
            { label: 'Determinism, scoped honestly', slug: 'engine/determinism' },
            { label: 'World files', slug: 'engine/world-files' },
            { label: 'The math package', slug: 'engine/math' },
          ],
        },
        {
          label: 'For curriculum authors',
          items: [{ label: 'Lessons are data', slug: 'authors/lessons' }],
        },
      ],
    }),
  ],
  // Live demos on these pages import the REAL workspace packages — that is the
  // exit-criterion language ("live demos import the real packages") and it makes
  // the docs build an integration test: break the engine, break the docs.
  // Resolution mirrors apps/editor/vite.config.ts: aliases straight to package
  // sources, no build step, and fs.allow so the dev server may serve files that
  // live outside this app's root.
  vite: {
    server: {
      fs: {
        allow: [r('../..')],
      },
    },
    resolve: {
      alias: {
        '@engine/math': r('../../packages/math/src/index.ts'),
        '@engine/projection': r('../../packages/projection/src/index.ts'),
        '@engine/renderer': r('../../packages/renderer/src/index.ts'),
        '@engine/renderer-canvas2d': r('../../packages/renderer-canvas2d/src/index.ts'),
      },
    },
  },
})
