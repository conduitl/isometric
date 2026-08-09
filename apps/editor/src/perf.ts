/**
 * The editor's measured scenario — drag-painting, run for real.
 *
 * The roadmap's Phase 2 exit line asks for a "sustained frame budget on the
 * throttled profile while drag-painting" (docs/ROADMAP.md), and this page is
 * that measurement: a REAL editor session — the same createEditorSession
 * main.tsx boots, minus React — holding one long brush stroke across the
 * 256×256 perf arena while timing its own frames. The scenario is EDITING,
 * not spectating: every measured frame pays the full editing bill — the
 * stroke recorder, the layer cache's invalidate-and-patch, the blit, the
 * entity markers, the always-on cell grid, the compass — because that is the
 * bill a kid's Chromebook pays mid-drag.
 *
 * Two series, because a number without context is just a mood:
 *
 *   1. DRAG-PAINT (judged) — after a ~30-frame warmup (JIT, the one-time
 *      65,536-cell cache paint, the compositor finding its feet), ~180
 *      frames each paint 3 cells through one open bus.beginTileStroke —
 *      a fast real drag lands a few cells per frame — along a deterministic
 *      serpentine path, then request a render. The budget judges this series.
 *   2. IDLE-AFTER-EDIT — the stroke ends (one history entry, one
 *      builder.tile-painted event), then ~60 frames just request renders of
 *      the now-still scene: the cache-reblit floor the paint path sits on.
 *      Reported beside the verdict as context, never judged.
 *
 * How time is measured, and why this is allowed: engine and app source never
 * read wall clocks (docs/DECISIONS.md D6 — ESLint enforces the ban), but
 * requestAnimationFrame HANDS each callback a timestamp — the page's only
 * sanctioned clock, the same source the three-windows perf page uses. The
 * delta between consecutive rAF timestamps includes our JavaScript, the
 * browser's paint, and any missed vsync — exactly the "frame time" the
 * budget exists to bound.
 *
 * HONEST SCOPE: the arena is the TOP-DOWN primary projection, where a tile
 * stroke invalidates a surgical dirty RECT of the layer cache and each frame
 * repaints only the cells the drag just touched. The iso lens currently
 * repaints the WHOLE layer raster on any cell change — a recorded deferral
 * in docs/DECISIONS.md — so this number does not speak for iso drag-painting.
 *
 * The path is pure arithmetic on the frame index (no randomness, no clocks):
 * the same cells, in the same order, on every machine and every run — which
 * is what makes two runs of this page comparable at all.
 */

import type { SlotStorage } from '@engine/world-format'
import { createEditorSession } from './editor/session'
import { createPerfWorld } from './editor/starter'

/** The arena: the engine's per-layer cap, same as the Phase 1 killer scene. */
const ARENA_SIZE = 256
/** The perf world's one layer (contract: createPerfWorld). */
const LAYER_ID = 'ground'
/** The brush value: water (2). The arena is a seeded mix of all five tiles,
 * so ~4 in 5 paints change their cell — the recorder's no-op path is
 * exercised too, exactly as a real drag over mixed terrain exercises it. */
const PAINT_TILE = 2

/** Cells painted per measured frame — a fast real drag lands a few cells a
 * frame; three is the honest middle of what pointermove coalescing delivers. */
const CELLS_PER_FRAME = 3

/** Frames burned before the judged series samples — JIT warmup, the one-time
 * full cache paint, and the compositor's first blits all land in here. */
const DRAG_WARMUP_FRAMES = 30
/** Post-warmup deltas collected for the judged drag-paint series. */
const DRAG_SAMPLE_FRAMES = 180

/** The idle series' own small warmup: the frame after stroke.end() pays for
 * the gesture commit (history push, event, snapshot refresh) and must not be
 * billed to the reblit floor. */
const IDLE_WARMUP_FRAMES = 10
/** Deltas collected for the idle-after-edit (cache reblit) series. */
const IDLE_SAMPLE_FRAMES = 60

/** Serpentine geometry: the drag sweeps boustrophedon rows (west→east, then
 * east→west) spaced ROW_STEP cells apart, starting mid-arena — a long
 * continuous stroke across terrain, not a scribble in one corner. */
const ROW_STEP = 5
const ROW_ORIGIN = 100

/** What the harness reads off globalThis when the page falls silent. */
interface PerfResult {
  /** Mean rAF delta of the drag-paint series, in ms. The budget's first gate. */
  mean: number
  /** 95th-percentile delta of the drag-paint series — the stutter catcher. */
  p95: number
  /** How many deltas the drag-paint numbers summarize. */
  samples: number
  /** Mean delta of the idle-after-edit series — the cache-reblit floor. */
  idleMean: number
  /** Cells the stroke actually CHANGED (paint() returned true). */
  cellsPainted: number
}

declare global {
  // An ambient `var` is how a module tells TypeScript about a global it
  // publishes — `let`/`const` here would not attach to globalThis.
  var __perfResult: PerfResult | undefined
}

// ---- The session: the real editor, storage faked, React absent. -----------

/** An empty in-memory SlotStorage: the session boots its starter world into
 * it, which we immediately replace with the arena — no localStorage touched,
 * so runs never contaminate a developer's real editor slots. */
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

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (el === null) throw new Error(`editor perf scene: missing element ${selector}`)
  return el
}

const session = createEditorSession({ storage: createMemorySlots() })
session.loadWorld(createPerfWorld(ARENA_SIZE), 'new')

// Attach frames the arena (the pending boot fit lands on the laid-out
// canvas) and gives the session its render-on-demand rAF loop — the same
// dirty-flag loop the shipping editor runs.
const canvas = must<HTMLCanvasElement>('#perf-canvas')
session.attach(canvas)

// ONE stroke for the whole drag — the coalesced-gesture contract: cells
// paint live, frame by frame, and end() commits one history entry. (The
// rebinding after the guard keeps the narrowed type visible inside frame(),
// where closure boundaries defeat control-flow narrowing.)
const strokeOrNull = session.bus.beginTileStroke(LAYER_ID, PAINT_TILE)
if (strokeOrNull === null) {
  throw new Error(`editor perf scene: perf world has no '${LAYER_ID}' layer`)
}
const stroke = strokeOrNull

/** The n-th cell of the serpentine: row = n ÷ width (direction alternating),
 * ty stepped down the arena from ROW_ORIGIN. Pure function of n. */
function pathCell(n: number): { tx: number; ty: number } {
  const row = Math.floor(n / ARENA_SIZE)
  const along = n % ARENA_SIZE
  const tx = row % 2 === 0 ? along : ARENA_SIZE - 1 - along
  const ty = (ROW_ORIGIN + row * ROW_STEP) % ARENA_SIZE
  return { tx, ty }
}

// ---- The measurement loop: drag-paint, then idle, then freeze. ------------

const meanOf = (xs: readonly number[]): number =>
  xs.reduce((total, x) => total + x, 0) / Math.max(1, xs.length)

/** The value 95% of samples sit at or below: sort ascending, take the entry
 * at ceil(0.95·n) − 1. Sorting runs once, after the last sampled frame, when
 * nobody is timing us anymore. */
const p95Of = (xs: readonly number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}

const dragSamples: number[] = []
const idleSamples: number[] = []
let phase: 'drag' | 'idle' | 'done' = 'drag'
/** Frames already run by the current phase — reset at the phase switch so
 * the boundary delta (half drag, half commit) is never sampled. */
let framesInPhase = 0
let lastTimestamp: number | null = null
let pathIndex = 0
let cellsPainted = 0

function publish(): void {
  globalThis.__perfResult = {
    mean: meanOf(dragSamples),
    p95: p95Of(dragSamples),
    samples: dragSamples.length,
    idleMean: meanOf(idleSamples),
    cellsPainted,
  }
}

function frame(now: number): void {
  if (phase === 'done') return

  // The delta arriving NOW measures the frame rendered by the PREVIOUS
  // callback, so it counts only once that frame was a post-warmup frame of
  // this same phase — warmup frames and the phase boundary are burned.
  const samples = phase === 'drag' ? dragSamples : idleSamples
  const warmup = phase === 'drag' ? DRAG_WARMUP_FRAMES : IDLE_WARMUP_FRAMES
  if (lastTimestamp !== null && framesInPhase > warmup) {
    samples.push(now - lastTimestamp)
  }
  lastTimestamp = now

  if (phase === 'drag' && dragSamples.length >= DRAG_SAMPLE_FRAMES) {
    // The gesture commits here — one history entry, one builder.tile-painted
    // event — and the commit's cost lands in the idle phase's warmup.
    stroke.end()
    phase = 'idle'
    framesInPhase = 0
  }
  if (phase === 'idle' && idleSamples.length >= IDLE_SAMPLE_FRAMES) {
    // Both series done: say the numbers, then fall silent. No further rAF is
    // scheduled — a frozen page cannot contaminate what it just reported.
    publish()
    phase = 'done'
    return
  }

  if (phase === 'drag') {
    for (let k = 0; k < CELLS_PER_FRAME; k += 1) {
      const cell = pathCell(pathIndex)
      pathIndex += 1
      if (stroke.paint(cell.tx, cell.ty)) cellsPainted += 1
    }
  }
  // Changed cells already marked the scene dirty through tilesTouched; this
  // explicit request keeps every frame's work identical even when all three
  // paints were same-value no-ops (and it IS the idle phase's whole work).
  session.requestRender()

  framesInPhase += 1
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
