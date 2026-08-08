/**
 * Entry point: wire the DOM controls in index.html to the clock and the scene.
 *
 * This file is the only place in the demo that touches the browser's sense of
 * time — and even here we never read a wall clock. requestAnimationFrame HANDS
 * us a timestamp each frame; we feed the delta between consecutive timestamps
 * into clock.advance and let the fixed-timestep accumulator do the rest. Real
 * time is an input to the simulation, never something the simulation reaches
 * out and grabs — that inversion is the whole determinism discipline in one
 * sentence (docs/DECISIONS.md D6).
 */

import { createClock } from '@engine/core'
import { createSurface } from '@engine/renderer'
import { createCanvas2dBackend } from '@engine/renderer-canvas2d'
import { createSim } from './sim'
import { renderScene } from './render'

/** The demo's fixed seed: change it and you get a different (but equally
 * repeatable) launch. Keep it and every visitor sees the identical bounce. */
const SEED = 12345

/** Grab a required element or fail loudly — a missing control is a build
 * mistake, not something to limp past. */
function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (el === null) throw new Error(`bedrock-demo: missing element ${selector}`)
  return el
}

const canvas = must<HTMLCanvasElement>('#viewport')
const btnPause = must<HTMLButtonElement>('#btn-pause')
const btnStepTick = must<HTMLButtonElement>('#btn-step-tick')
const btnStepSubstage = must<HTMLButtonElement>('#btn-step-substage')
const timeScaleSelect = must<HTMLSelectElement>('#time-scale')
const btnReset = must<HTMLButtonElement>('#btn-reset')
const statusEl = must<HTMLSpanElement>('#status')

const surface = createSurface(canvas)
const backend = createCanvas2dBackend(canvas)
const clock = createClock()

// `let` because Reset swaps in a whole fresh world; the render loop always
// reads the current one through this binding.
let sim = createSim(SEED)

/** The pause button doubles as the pause indicator: its label always names
 * the action it would perform next. */
function syncPauseLabel(): void {
  btnPause.textContent = clock.paused ? 'Resume' : 'Pause'
}

btnPause.addEventListener('click', () => {
  if (clock.paused) {
    // resume() finishes any half-stepped tick first, so the world never runs
    // on from the middle of a substage cycle.
    clock.resume(sim.stages)
  } else {
    clock.pause()
  }
  syncPauseLabel()
})

/** Stepping only makes sense while frozen, so the step buttons pause first —
 * pressing one while running means "freeze here, then step". */
function ensurePaused(): void {
  if (!clock.paused) {
    clock.pause()
    syncPauseLabel()
  }
}

btnStepTick.addEventListener('click', () => {
  ensurePaused()
  clock.stepTick(sim.stages)
})

btnStepSubstage.addEventListener('click', () => {
  ensurePaused()
  clock.stepSubstage(sim.stages)
})

timeScaleSelect.addEventListener('change', () => {
  clock.setTimeScale(Number(timeScaleSelect.value))
})

btnReset.addEventListener('click', () => {
  // Same seed → the reset world replays the original run exactly. Watching
  // the identical bounce after every reset IS the determinism demo.
  sim = createSim(SEED)
  clock.reset()
})

/**
 * The frame loop. rAF gives us `now` in milliseconds; the delta to the
 * previous frame (in seconds) is all the clock needs. The first frame has no
 * previous timestamp, so it advances by zero — cleaner than guessing.
 *
 * Note the split: clock.advance may run 0, 1, or several fixed ticks
 * depending on how much real time passed, but we RENDER exactly once per
 * display frame regardless, using clock.alpha to interpolate. Simulation rate
 * and display rate are two different clocks, deliberately decoupled.
 */
let lastTimestamp: number | null = null
function frame(now: number): void {
  const realDt = lastTimestamp === null ? 0 : (now - lastTimestamp) / 1000
  lastTimestamp = now

  clock.advance(realDt, sim.stages)

  // While paused we draw at alpha = 1 — the exact state the HUD prints —
  // instead of the clock's leftover accumulator fraction, which would show
  // the ball up to a full tick BEHIND the numbers. Freeze-and-inspect must
  // never contradict itself. Accepted tradeoff: the picture snaps forward by
  // up to one tick's displacement at the instant of pausing (and back on
  // resume, when interpolation takes over again).
  const drawAlpha = clock.paused ? 1 : clock.alpha

  renderScene(backend, surface.size(), sim.state, drawAlpha, {
    tick: clock.tick,
    paused: clock.paused,
    pendingStage: clock.pendingStage,
    timeScale: clock.timeScale,
  })

  const runState = clock.paused
    ? clock.pendingStage
      ? `paused · next ${clock.pendingStage}`
      : 'paused'
    : 'running'
  statusEl.textContent = `tick ${clock.tick} · α ${drawAlpha.toFixed(2)} · ${clock.timeScale}× · ${runState}`

  requestAnimationFrame(frame)
}

syncPauseLabel()
requestAnimationFrame(frame)
