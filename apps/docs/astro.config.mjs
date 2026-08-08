import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

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
            { label: 'Running the project', slug: 'start/running' },
          ],
        },
        {
          label: 'Curriculum',
          items: [{ label: 'The math package', slug: 'curriculum/math' }],
        },
      ],
    }),
  ],
})
