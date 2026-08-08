/**
 * The measured scene — the Phase 1 exit measurement, run for real.
 *
 * The roadmap's exit line reads "60 fps at 256×256 fully zoomed out on the
 * 4×-throttled reference profile" (docs/ROADMAP.md), and the red team's
 * killer case is exactly this frame: every one of the 65,536 cells of a
 * maximum-size layer visible at once, where a naive per-tile renderer dies
 * on a school Chromebook (docs/RISKS.md, the Canvas2D cliff). So that is the
 * frame this page renders, over and over, while timing itself.
 *
 * Two passes, because a number without a comparison is just a mood:
 *
 *   1. CACHED — the shipping path. createLayerRenderer paints the layer once
 *      into an OffscreenCanvas and every frame is one scaled blit plus 200
 *      entity markers. This pass is judged against the frame budget.
 *   2. UNCACHED — the same scene forced down the per-tile fallback (a raster
 *      factory whose targets have no pixel store, source: null, which is the
 *      layer renderer's documented signal to emit one draw command per
 *      tile). Nobody ships this at 256×256; its mean is reported purely as
 *      the honesty number — the distance between the two passes is the
 *      measured reason the cache exists.
 *
 * How time is measured, and why this is allowed: engine and app source never
 * read wall clocks (docs/DECISIONS.md D6 — ESLint enforces the ban), but
 * requestAnimationFrame HANDS each callback a timestamp, the same sanctioned
 * source the bedrock demo feeds its clock from. The delta between two
 * consecutive rAF timestamps is the truest "frame time" a page can see: it
 * includes our JavaScript, the browser's paint, and any missed vsync. At a
 * healthy 60 Hz the deltas sit at ~16.7 ms no matter how cheap the frame is
 * (rAF never runs faster than the display); when rendering can't keep up,
 * the deltas grow past it — which is exactly the failure the budget exists
 * to catch.
 *
 * After a warmup (JIT, cache paint, first-blit compositor work all land
 * there), 300 sampled deltas become a mean and a p95 — mean for the typical
 * frame, p95 so a stutter every twenty frames cannot hide behind a good
 * average. The result is published on globalThis.__perfResult for the
 * harness (scripts/perf/tilemap-budget.mjs), and then the loop simply stops
 * scheduling itself: a frozen page cannot contaminate the numbers it just
 * reported.
 */

import type { Tileset } from '@engine/core'
import { createWorld, query, spawn } from '@engine/core'
import { Vec2, createRng } from '@engine/math'
import { createTopDown, createTransformStack, fitCamera } from '@engine/projection'
import { createSurface } from '@engine/renderer'
import { createCanvas2dBackend } from '@engine/renderer-canvas2d'
import type { LayerRenderer, RasterFactory } from '@engine/tilemap'
import {
  MAX_LAYER_SIZE,
  createLayerRenderer,
  createOffscreenRasterFactory,
  createTileLayer,
  setCell,
} from '@engine/tilemap'

/** One seed rules the whole scene: same pattern, same markers, every run. */
const SEED = 42

/** Entities sprinkled on top of the layer, so a frame is never blit-only. */
const MARKER_COUNT = 200

/** Frames burned before sampling starts — JIT warmup, the one-time cache
 * paint, and the compositor finding its feet all happen in here. */
const CACHED_WARMUP_FRAMES = 60
/** Post-warmup deltas collected for the judged pass. */
const CACHED_SAMPLE_FRAMES = 300

/** The uncached pass exists for one comparison number, not a verdict, so it
 * samples briefly — under 4× throttle each of its frames can cost hundreds
 * of milliseconds, and the harness has a finite patience. */
const UNCACHED_WARMUP_FRAMES = 10
const UNCACHED_SAMPLE_FRAMES = 30

/** What the harness reads off globalThis when the page falls silent. */
interface PerfResult {
  /** Mean rAF delta of the cached pass, in ms. The budget's first gate. */
  mean: number
  /** 95th-percentile delta of the cached pass, in ms — the stutter catcher. */
  p95: number
  /** How many deltas the cached numbers summarize. */
  samples: number
  /** Always true: the judged pass is the shipping (cached) path. */
  cached: boolean
  /** Mean delta of the forced per-tile pass — the "why the cache exists" number. */
  uncachedMean: number
}

declare global {
  // An ambient `var` is how a module tells TypeScript about a global it
  // publishes — `let`/`const` here would not attach to globalThis.
  var __perfResult: PerfResult | undefined
}

// ---- The scene: one max-size layer, four tile kinds, 200 markers. --------

const rng = createRng(SEED)

const tileset: Tileset = {
  id: 'perf-tiles',
  name: 'perf palette',
  tiles: [
    { name: 'grass', colors: { top: '#3f9d4e' } },
    { name: 'water', colors: { top: '#2f62d6' } },
    { name: 'sand', colors: { top: '#d8c06a' } },
    { name: 'stone', colors: { top: '#8a93a3' } },
  ],
}

// Every cell filled through setCell — the same write path the editor will
// use — so the cache starts from an honest 65,536-write revision history,
// not from a pre-baked cells array it never had to invalidate against.
const layer = createTileLayer({
  id: 'perf-ground',
  width: MAX_LAYER_SIZE,
  height: MAX_LAYER_SIZE,
  tilesetId: tileset.id,
})
for (let ty = 0; ty < layer.height; ty += 1) {
  for (let tx = 0; tx < layer.width; tx += 1) {
    setCell(layer, tx, ty, rng.int(1, tileset.tiles.length + 1))
  }
}

// The markers are real entities in a real world — rows in the spreadsheet —
// because that is what they will be in every shipped scene. Their positions
// are read out once here; nothing moves in this scene, and re-querying per
// frame would bill the measurement for work the scene doesn't do.
const world = createWorld({ name: 'perf scene', settings: { seed: SEED } })
for (let i = 0; i < MARKER_COUNT; i += 1) {
  spawn(world, {
    name: `marker ${i + 1}`,
    components: {
      position: { x: rng.range(0, layer.width), y: rng.range(0, layer.height) },
    },
  })
}
const markerPositions: Vec2[] = query(world, 'position').map((entity) => {
  const p = entity.components['position'] as { x: number; y: number }
  return Vec2.make(p.x, p.y)
})

// ---- Wiring: surface + backend + camera, the established register. -------

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (el === null) throw new Error(`perf scene: missing element ${selector}`)
  return el
}

const canvas = must<HTMLCanvasElement>('#perf-canvas')
const surface = createSurface(canvas)
const backend = createCanvas2dBackend(canvas)
const projection = createTopDown()

// Fully zoomed out: fit the ENTIRE 256×256 world into the view. fitCamera
// hands back an axis-aligned scale-and-translate — exactly the camera shape
// the cached blit's fast path accepts — computed once, because the killer
// case is a still, fully-visible world, not a moving camera.
const startSize = surface.size()
const camera = fitCamera({
  viewWidth: startSize.width,
  viewHeight: startSize.height,
  worldMin: Vec2.zero,
  worldMax: Vec2.make(layer.width, layer.height),
  projection,
})
const stack = createTransformStack(projection, camera)

// Pass 1's renderer caches into a real OffscreenCanvas; pass 2's is handed a
// factory whose targets have no pixel store at all (source: null), which the
// layer renderer treats as "emit per-tile commands" — the documented
// headless fallback, conscripted here to measure the road not taken.
const nullRasterFactory: RasterFactory = (width, height) => ({
  width,
  height,
  source: null,
  clear(): void {},
  fillRect(): void {},
  fillPoly(): void {},
})

// Both renderers take the world's tileSize (1 here, but passed rather than
// assumed) so the cache raster is sized for the true world extent — the same
// world units fitCamera framed above.
const cachedRenderer = createLayerRenderer({
  layer,
  tileset,
  projection,
  raster: createOffscreenRasterFactory(),
  tileSize: world.settings.tileSize,
})
const uncachedRenderer = createLayerRenderer({
  layer,
  tileset,
  projection,
  raster: nullRasterFactory,
  tileSize: world.settings.tileSize,
})

/** One frame of the scene: the layer (however this pass draws it), then the
 * 200 markers pushed through the full world-to-screen pipeline. */
function renderFrame(renderer: LayerRenderer): void {
  const size = surface.size()
  backend.beginFrame({ width: size.width, height: size.height, dpr: size.dpr, background: '#0d131e' })
  renderer.draw(backend, camera)
  for (const p of markerPositions) {
    const s = stack.worldToScreen({ x: p.x, y: p.y, z: 0 })
    backend.drawCircle({ x: s.x, y: s.y, radius: 4, fill: '#ff8a3d' })
  }
  backend.endFrame()
}

// ---- The measurement loop: two passes, then freeze. ----------------------

interface Pass {
  readonly renderer: LayerRenderer
  readonly warmup: number
  readonly target: number
  readonly samples: number[]
}

const cachedPass: Pass = {
  renderer: cachedRenderer,
  warmup: CACHED_WARMUP_FRAMES,
  target: CACHED_SAMPLE_FRAMES,
  samples: [],
}
const uncachedPass: Pass = {
  renderer: uncachedRenderer,
  warmup: UNCACHED_WARMUP_FRAMES,
  target: UNCACHED_SAMPLE_FRAMES,
  samples: [],
}
const passes: readonly Pass[] = [cachedPass, uncachedPass]

const meanOf = (xs: readonly number[]): number =>
  xs.reduce((total, x) => total + x, 0) / Math.max(1, xs.length)

/** The value 95% of samples sit at or below: sort ascending, take the entry
 * at ceil(0.95·n) − 1. Sorting is fine here — this runs once, after the last
 * sampled frame, when nobody is timing us anymore. */
const p95Of = (xs: readonly number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}

function publish(): void {
  globalThis.__perfResult = {
    mean: meanOf(cachedPass.samples),
    p95: p95Of(cachedPass.samples),
    samples: cachedPass.samples.length,
    cached: true,
    uncachedMean: meanOf(uncachedPass.samples),
  }
}

let passIndex = 0
/** Frames already rendered by the current pass — reset at each pass switch
 * so the boundary delta (half old pass, half new) is never sampled. */
let framesInPass = 0
let lastTimestamp: number | null = null

function frame(now: number): void {
  let pass = passes[passIndex]
  if (pass === undefined) return

  // The delta arriving NOW measures the frame rendered by the PREVIOUS
  // callback, so it counts only once that frame was a post-warmup frame of
  // this same pass — warmup frames and pass boundaries are silently burned.
  if (lastTimestamp !== null && framesInPass > pass.warmup) {
    pass.samples.push(now - lastTimestamp)
  }
  lastTimestamp = now

  if (pass.samples.length >= pass.target) {
    passIndex += 1
    framesInPass = 0
    const next = passes[passIndex]
    if (next === undefined) {
      // Both passes done: say the numbers, then fall silent. No further rAF
      // is scheduled — the page freezes on its last rendered frame, so the
      // published result can never drift after the fact.
      publish()
      return
    }
    pass = next
  }

  renderFrame(pass.renderer)
  framesInPass += 1
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
