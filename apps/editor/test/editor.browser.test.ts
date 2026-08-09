/**
 * Visual regression: the editor's starter scene after a scripted edit — the
 * editor's first blessed baseline.
 *
 * The test assembles a REAL session (the same createEditorSession main.tsx
 * boots, storage faked in memory so the starter world greets us and no
 * developer's localStorage slots are touched), attaches it to a canvas at a
 * pinned 800×500, and drives a deterministic scene entirely through the
 * public surface: a water rectangle painted through bus.beginTileStroke, one
 * crate placed through bus.dispatch, the player selected, the keyboard cell
 * cursor parked on a known cell. Every input is a fixed number and the
 * renderer is render-on-demand over a static document, so the picture is a
 * contract, not a hope — the blit cache, the painters queue, the grid, the
 * selection ring, the cursor, and the compass all land in one screenshot.
 *
 * Text note: the canvas draws entity labels and compass letters in the same
 * '11px ui-monospace, monospace' stack apps/three-windows' views baselines
 * already pin — that suite proved the stack stable on the pinned browser.
 *
 * Baselines are per-browser and per-platform (vitest names them so); the
 * pinned browser is Playwright's bundled Chromium, and upgrading it is a
 * deliberate re-bless PR (docs/DECISIONS.md R10).
 */

import { entityIds } from '@engine/core'
import type { SlotStorage } from '@engine/world-format'
import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { entityWorldPoint, markerKind } from '../src/editor/picking'
import { createEditorSession } from '../src/editor/session'

/** The pinned viewport: fits the test browser's window with room to spare. */
const VIEW = { width: 800, height: 500 } as const

/** Palette value 2 — water in the starter 'terrain' tileset. The session
 * boots with grass active, and painting grass on grass is a no-op, so a
 * real paint needs a different tile. */
const WATER = 2

/** An empty in-memory SlotStorage: bootDoc finds nothing and the session
 * opens the pinned starter world (32×24 grass, pond, player at (16,12)). */
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

it('the starter scene after a scripted edit matches the blessed screenshot', async () => {
  // A fixed-size container so layout can never negotiate the canvas size.
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
  try {
    // Paint a small water rectangle (tx 20..23 × ty 8..10 — all grass in the
    // starter, well clear of the pond and its sand rim, so every cell
    // changes) as ONE coalesced stroke, the way a drag would.
    const stroke = session.bus.beginTileStroke('ground', WATER)
    if (stroke === null) throw new Error('starter world lost its ground layer')
    for (let ty = 8; ty <= 10; ty += 1) {
      for (let tx = 20; tx <= 23; tx += 1) {
        stroke.paint(tx, ty)
      }
    }
    stroke.end()

    // One crate through the command door, on a tile center.
    const placed = session.bus.dispatch({
      kind: 'place-entity',
      marker: 'crate',
      position: { x: 24.5, y: 15.5 },
      elevation: 0,
    })
    expect(placed.ok).toBe(true)

    // Select the player (the starter's one pinned entity) — the blue ring.
    const playerId = entityIds(session.doc).find((id) => {
      const entity = session.doc.entities[id]
      return entity !== undefined && markerKind(entity) === 'player'
    })
    if (playerId === undefined) throw new Error('starter world lost its player')
    const playerEntity = session.doc.entities[playerId]
    const playerPoint = playerEntity === undefined ? null : entityWorldPoint(playerEntity)
    if (playerPoint === null) throw new Error('starter player has no position')
    session.select({ kind: 'entity', id: playerId, point: playerPoint })

    // Park the keyboard cursor on a known cell: the first move summons it to
    // the layer center (16,12) and spends its delta; the second walks it to
    // (10,15) — a spot where the yellow outline overlaps nothing else.
    session.moveCursor(0, 0)
    session.moveCursor(-6, 3)

    // One requested frame, then wait out the rAF pipeline (the render
    // callback runs on the first frame; the second is belt and braces).
    session.requestRender()
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)

    await expect(page.elementLocator(canvas)).toMatchScreenshot('editor-starter-scene')
  } finally {
    detach()
    session.dispose()
    container.remove()
  }
})
