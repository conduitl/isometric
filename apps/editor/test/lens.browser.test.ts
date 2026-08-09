/**
 * Visual regression: the lesson lens pictures — the Phase 3 exit baselines.
 *
 * Two blessed screenshots, both driven through the same public surface the
 * tutorial host uses (setOverlays / loadWorld / setViewProjection), on the
 * same harness the editor's first baseline pinned (editor.browser.test.ts:
 * a REAL createEditorSession with storage faked in memory, an 800×500
 * canvas, render-on-demand, one requested frame waited out through the rAF
 * pipeline):
 *
 * 1. **editor-right-triangle** — the distance lesson's money shot. The
 *    starter's player stands at (16.5, 12.5); one crate is dispatched to
 *    (19.5, 16.5), the center of cell (19, 16), so the legs measure exactly
 *    dx 3 and dy 4 and the hypotenuse √(9+16) = 5 — the classroom 3-4-5
 *    placement. The overlay's endpoints are MARKER references resolved
 *    against the live document at draw time (the pedagogy: the triangle
 *    follows the crate), and the labels are the measured values printed by
 *    the lens layer itself — nobody types '3', '4', or '5'; the math does.
 * 2. **editor-iso-xray** — the perspective-reveal lesson's second view,
 *    pinned. The showcase-island fixture loads through the fixture door
 *    (origin 'fixture', exactly the tutorial host's move) and the VIEW lens
 *    switches to iso: same twelve numbers, different matrix — the ground
 *    rings become 2:1 diamonds, the stone plateau grows real south/east
 *    walls toward D7's south-east camera, and the markers keep standing on
 *    their cell centers.
 *
 * Text note: entity labels and compass letters use the same '11px
 * ui-monospace, monospace' stack the earlier baselines proved stable on the
 * pinned browser; the lens labels are the same stack at 12px.
 *
 * Baselines are per-browser and per-platform (vitest names them so); the
 * pinned browser is Playwright's bundled Chromium, and upgrading it is a
 * deliberate re-bless PR (docs/DECISIONS.md R10).
 */

import type { SlotStorage } from '@engine/world-format'
import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { createShowcaseIsland } from '../src/editor/fixtures'
import { createEditorSession } from '../src/editor/session'
import type { EditorSession } from '../src/editor/types'

/** The pinned viewport: fits the test browser's window with room to spare
 * (the same 800×500 the editor's first baseline pinned). */
const VIEW = { width: 800, height: 500 } as const

/** An empty in-memory SlotStorage: bootDoc finds nothing and the session
 * opens the pinned starter world (32×24 grass, pond, player at (16,12)) —
 * and no developer's real localStorage slots are ever touched. */
function createMemorySlots(): SlotStorage {
  const slots = new Map<string, string>()
  return {
    read: (key) => slots.get(key) ?? null,
    write: (key, value) => {
      slots.set(key, value)
    },
    remove: (key) => {
      slots.delete(key)
    },
  }
}

/** Build the fixed-size stage (so layout can never negotiate the canvas
 * size), boot a real session on in-memory storage, and attach. The caller
 * scripts the scene, screenshots, and hands back to `teardown` in finally. */
function mountSession(): {
  session: EditorSession
  canvas: HTMLCanvasElement
  teardown: () => void
} {
  const container = document.createElement('div')
  container.style.width = `${VIEW.width}px`
  container.style.height = `${VIEW.height}px`
  const canvas = document.createElement('canvas')
  canvas.style.width = `${VIEW.width}px`
  canvas.style.height = `${VIEW.height}px`
  canvas.style.display = 'block'
  document.body.style.margin = '0'
  container.appendChild(canvas)
  document.body.appendChild(container)

  const session = createEditorSession({ storage: createMemorySlots() })
  const detach = session.attach(canvas)
  return {
    session,
    canvas,
    teardown: (): void => {
      detach()
      session.dispose()
      container.remove()
    },
  }
}

/** One requested frame, then wait out the rAF pipeline (the render callback
 * runs on the first frame; the second is belt and braces). */
async function settleFrame(session: EditorSession): Promise<void> {
  session.requestRender()
  await new Promise(requestAnimationFrame)
  await new Promise(requestAnimationFrame)
}

it('the 3-4-5 right-triangle overlay matches the blessed screenshot', async () => {
  const { session, canvas, teardown } = mountSession()
  try {
    // One crate through the command door, on the center of cell (19, 16):
    // 3 east and 4 north of the starter player's (16.5, 12.5), so the
    // measured legs label themselves '3' and '4' and the hypotenuse '5'.
    const placed = session.bus.dispatch({
      kind: 'place-entity',
      marker: 'crate',
      position: { x: 19.5, y: 16.5 },
      elevation: 0,
    })
    expect(placed.ok).toBe(true)

    // The overlay exactly as the distance lesson's show-overlays effect
    // ships it: marker endpoints, no authored labels — the numbers on
    // screen are the lens layer's own measurements.
    session.setOverlays([
      { kind: 'right-triangle', a: { marker: 'player' }, b: { marker: 'crate' } },
    ])

    await settleFrame(session)
    await expect(page.elementLocator(canvas)).toMatchScreenshot('editor-right-triangle')
  } finally {
    teardown()
  }
})

it('the showcase island through the iso lens matches the blessed screenshot', async () => {
  const { session, canvas, teardown } = mountSession()
  try {
    // The fixture door, exactly as the tutorial host opens it: the island
    // arrives with origin 'fixture' (starter world parked semantics live
    // elsewhere; here the origin just makes this THE lesson stage).
    session.loadWorld(createShowcaseIsland(), 'fixture')

    // The reveal's second view: same document, iso matrix. The session
    // drops the raster cache, rebuilds the stack, and refits the camera —
    // the picture below is the one the lesson pins.
    session.setViewProjection('iso')

    await settleFrame(session)
    await expect(page.elementLocator(canvas)).toMatchScreenshot('editor-iso-xray')
  } finally {
    teardown()
  }
})
