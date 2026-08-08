/**
 * Three windows, one world — the Phase 1 exit demo.
 *
 * One world object, parsed from one committed .world.json, rendered through
 * three projections AT ONCE. Click anything in any window and all three
 * highlight it; that shared selection is the product thesis made clickable:
 * "same world, different matrix" is not a slogan here, it is what your
 * cursor proves.
 *
 * Two disciplines from the established app register, both visible below:
 *
 * - **Render on demand.** This world is static, so there is no free-running
 *   requestAnimationFrame loop — a frame is drawn when something a frame
 *   depends on changed (load, resize, selection, hover), and the app is
 *   otherwise perfectly idle. A wall of three canvases that redraws sixty
 *   times a second to show the same pixels is how Chromebook batteries die
 *   (docs/RISKS.md); this app draws zero frames per second at rest.
 * - **No wall clocks, no unseeded randomness.** Nothing here needs time at
 *   all — which is the easiest way to satisfy the determinism rules.
 */

import type { World } from '@engine/core'
import { getEntity } from '@engine/core'
import { Vec2 } from '@engine/math'
import { createIso, createProfile, createTopDown } from '@engine/projection'
import type { Projection } from '@engine/projection'
import { createSurface } from '@engine/renderer'
import type { RendererBackend, Surface } from '@engine/renderer'
import { createCanvas2dBackend } from '@engine/renderer-canvas2d'
import { createOffscreenRasterFactory } from '@engine/tilemap'
import { parseWorld, serializeWorld } from '@engine/world-format'
import { markerKind, resolvePick, resolveTile, sameTile } from './picking'
import type { PickResult, PickedTile, Selection } from './picking'
import { createView } from './views'
import type { View } from './views'
import { loadIslandWorld } from './world-fixture'

/** Grab a required element or fail loudly — a missing control is a build
 * mistake, not something to limp past. */
function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (el === null) throw new Error(`three-windows: missing element ${selector}`)
  return el
}

const infoEl = must<HTMLSpanElement>('#info')
const saveButton = must<HTMLButtonElement>('#btn-save')
const fileInput = must<HTMLInputElement>('#file-load')

// The world: ONE object, shared by reference into every view. Load swaps it.
const island = loadIslandWorld()
let world: World = island.world

// The fixture's parse warnings, surfaced instead of swallowed: the committed
// world deliberately carries a component no engine version knows ("secret"),
// and the parser's heads-up about it IS the forward-compatibility lesson.
// console.info rather than the #info line so the "click to pick" hint stays
// up for first-time visitors; the Load button's path below shows the same
// warnings inline, so a curious student meets the sentence either way.
for (const warning of island.warnings) {
  console.info(`island fixture: ${warning}`)
}

// The shared UI state the three windows synchronize on.
let selection: Selection = null
let hover: { window: ViewWindow; tile: PickedTile } | null = null

// One real raster factory for all views — each layer renderer asks it for
// its own OffscreenCanvas cache.
const raster = createOffscreenRasterFactory()

/** One window: a fixed canvas + surface + backend, and a view that is
 * rebuilt whenever a different world is loaded. */
interface ViewWindow {
  readonly projection: Projection
  readonly canvas: HTMLCanvasElement
  readonly surface: Surface
  readonly backend: RendererBackend
  view: View
}

function renderWindow(win: ViewWindow): void {
  win.view.render(win.backend, win.surface.size(), {
    selection,
    // The hover ghost belongs to the window the cursor is actually in —
    // the "where will my click land?" answer is a per-view question.
    hoverTile: hover !== null && hover.window === win ? hover.tile : null,
  })
}

function renderAll(): void {
  for (const win of windows) renderWindow(win)
}

/** Pointer position in the canvas's own CSS pixels — the coordinate space
 * every draw command already lives in, so picking starts where drawing ended. */
function pointerPoint(win: ViewWindow, event: MouseEvent): Vec2 {
  const rect = win.canvas.getBoundingClientRect()
  return Vec2.make(event.clientX - rect.left, event.clientY - rect.top)
}

/** The student-facing pick report: name the thing, give its world numbers,
 * and say the quiet part out loud — one thing, three pictures. */
function describePick(pick: PickResult): string {
  if (pick.kind === 'entity') {
    const entity = getEntity(world, pick.id)
    const noun = (entity !== undefined ? markerKind(entity) : null) ?? 'object'
    const name = entity?.name ?? pick.id
    const { x, y, z } = pick.point
    return `picked ${name} (${pick.id}) at (${x}, ${y}, ${z}) — same ${noun}, three pictures`
  }
  const tile = pick.tile
  const layerName = world.layers.find((layer) => layer.id === tile.layerId)?.name ?? 'empty ground'
  return `picked tile (${tile.tx}, ${tile.ty}) on ${layerName} — same cell, three outlines`
}

function makeWindow(selector: string, projection: Projection): ViewWindow {
  const canvas = must<HTMLCanvasElement>(selector)
  const win: ViewWindow = {
    projection,
    canvas,
    surface: createSurface(canvas),
    backend: createCanvas2dBackend(canvas),
    view: createView({ projection, world, raster }),
  }

  // A click resolves through THIS window's inverse walk, but the selection
  // it produces is shared — all three windows redraw with it. That fan-out
  // is the demo.
  canvas.addEventListener('click', (event) => {
    const pick = resolvePick(world, win.view.stack, pointerPoint(win, event))
    if (pick === null) return
    selection = pick
    infoEl.textContent = describePick(pick)
    renderAll()
  })

  // The hover ghost: outline the landing cell under the cursor, in this
  // window only, redrawing only when the resolved cell actually changes —
  // a pointer gliding within one cell costs zero frames.
  canvas.addEventListener('pointermove', (event) => {
    const tile = resolveTile(world, win.view.stack, pointerPoint(win, event))
    const current = hover !== null && hover.window === win ? hover.tile : null
    if (sameTile(current, tile)) return
    hover = tile === null ? null : { window: win, tile }
    renderWindow(win)
  })

  canvas.addEventListener('pointerleave', () => {
    if (hover === null || hover.window !== win) return
    hover = null
    renderWindow(win)
  })

  // Each window re-renders itself when ITS canvas changes size or moves to a
  // screen with a different pixel ratio — render-on-demand's only timer.
  win.surface.onResize(() => renderWindow(win))

  return win
}

const windows: ViewWindow[] = [
  makeWindow('#view-topdown', createTopDown()),
  makeWindow('#view-iso', createIso()),
  makeWindow('#view-profile', createProfile()),
]

// ---- Save: the canonical writer, straight to a download. -------------------

saveButton.addEventListener('click', () => {
  // serializeWorld is canonical — the same world always becomes the same
  // bytes, so a fresh save of the untouched fixture is byte-identical to the
  // committed file (a fact the tests pin down).
  const blob = new Blob([serializeWorld(world)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'island.world.json'
  link.click()
  URL.revokeObjectURL(url)
  infoEl.textContent = `saved "${world.meta.name}" — canonical bytes, diff-friendly`
})

// ---- Load: the defensive reader, errors shown VERBATIM. --------------------

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  // Allow re-loading the same filename later: a <input type=file> only fires
  // change when the value changes, so the value is cleared after every pick.
  fileInput.value = ''
  if (file === undefined) return

  void file.text().then((text) => {
    const result = parseWorld(text)
    if (!result.ok) {
      // The parser's message is already written for the person who owns the
      // file — student-legible by contract (that is the point of the format
      // package) — so it is shown untouched. The current world stays up.
      infoEl.textContent = result.error.message
      return
    }
    world = result.world
    selection = null
    hover = null
    for (const win of windows) {
      win.view = createView({ projection: win.projection, world, raster })
    }
    infoEl.textContent = [`loaded ${world.meta.name}`, ...result.warnings].join(' · ')
    renderAll()
  })
})

// First paint. After this, the app only draws when something changes.
renderAll()
