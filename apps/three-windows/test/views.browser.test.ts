/**
 * Visual regression: the island through each lens — the start of the
 * executable parity suite.
 *
 * Each test renders the committed fixture once, through the REAL pipeline
 * (OffscreenCanvas layer caches, blits, the Canvas2D backend), at a pinned
 * 640×420 / dpr 1 viewport, and compares against a blessed screenshot. The
 * world is static and the camera is a pure function of the view size, so
 * these baselines are contracts, not hopes — and any future backend must
 * reproduce these same three pictures (docs/ROADMAP.md Phase 6: backend
 * parity as an executable contract).
 *
 * Baselines are per-browser and per-platform (vitest names them so); the
 * pinned browser is Playwright's bundled Chromium, and upgrading it is a
 * deliberate re-bless PR (docs/DECISIONS.md R10).
 */

import { createIso, createProfile, createTopDown } from '@engine/projection'
import type { Projection } from '@engine/projection'
import { createCanvas2dBackend } from '@engine/renderer-canvas2d'
import { createOffscreenRasterFactory } from '@engine/tilemap'
import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { createView } from '../src/views'
import { loadIslandWorld } from '../src/world-fixture'

/** The pinned viewport: fits the test browser's window with room to spare,
 * and dpr 1 keeps CSS pixels equal to device pixels — no device in the loop. */
const VIEW = { width: 640, height: 420, dpr: 1 } as const

const CASES: ReadonlyArray<[string, () => Projection]> = [
  ['island-topdown', createTopDown],
  ['island-iso', createIso],
  ['island-profile', createProfile],
]

for (const [name, makeProjection] of CASES) {
  it(`${name} matches the blessed screenshot`, async () => {
    const canvas = document.createElement('canvas')
    canvas.style.width = `${VIEW.width}px`
    canvas.style.height = `${VIEW.height}px`
    canvas.style.display = 'block'
    document.body.style.margin = '0'
    document.body.appendChild(canvas)

    const view = createView({
      projection: makeProjection(),
      world: loadIslandWorld().world,
      raster: createOffscreenRasterFactory(),
    })
    view.render(createCanvas2dBackend(canvas), VIEW, { selection: null, hoverTile: null })

    await expect(page.elementLocator(canvas)).toMatchScreenshot(name)
    canvas.remove()
  })
}
