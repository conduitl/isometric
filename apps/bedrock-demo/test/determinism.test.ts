/**
 * THE PHASE 0 EXIT PROOF (docs/ROADMAP.md): run the same world twice, from the
 * same seed, for the same number of ticks — and demand byte-identical results.
 *
 * Two fingerprints per run:
 *  - stateHash: the entire simulation state after N ticks. If ANY number in
 *    any position/velocity/phase drifted between runs, this differs.
 *  - frameHash: the full recorded draw-command stream of one rendered frame on
 *    the headless null backend. This extends the guarantee through the render
 *    path: identical state must also DRAW identically, command for command.
 *
 * If either hash ever differs between two runs of the same build, something
 * non-deterministic leaked in (a wall clock, unseeded randomness, unstable
 * iteration order) and this test fails the commit.
 */

import { describe, it, expect } from 'vitest'
import { createClock } from '@engine/core'
import { createNullBackend } from '@engine/renderer'
import { hashValue } from '@engine/testkit'
import { createSim } from '../src/sim'
import { renderScene } from '../src/render'

/** The fixed viewport for frame hashing: rendering depends on view size, so
 * the proof pins it (CSS pixels, dpr 1 — no device in the loop). */
const VIEW = { width: 800, height: 450, dpr: 1 } as const

/**
 * One complete run: fresh sim + fresh clock, advanced in real-time-sized
 * slices of 1/60 s until the requested number of fixed ticks has been
 * OBSERVED on the clock (we loop on clock.tick rather than counting calls, so
 * floating-point accumulator remainders can never desynchronize two runs).
 * Then render exactly one frame at alpha 0 into a recording backend.
 */
function run(seed: number, ticks: number): { stateHash: string; frameHash: string; tick: number } {
  const { state, stages } = createSim(seed)
  const clock = createClock()

  while (clock.tick < ticks) {
    clock.advance(1 / 60, stages)
  }

  const backend = createNullBackend()
  renderScene(backend, VIEW, state, 0, {
    tick: clock.tick,
    paused: clock.paused,
    pendingStage: clock.pendingStage,
    timeScale: clock.timeScale,
  })

  return {
    stateHash: hashValue(state),
    frameHash: hashValue(backend.frames),
    tick: clock.tick,
  }
}

describe('replay determinism (Phase 0 exit criterion)', () => {
  it('two runs with the same seed produce identical state and frame hashes', () => {
    const first = run(12345, 600)
    const second = run(12345, 600)

    expect(second.stateHash).toBe(first.stateHash)
    expect(second.frameHash).toBe(first.frameHash)
  })

  it('the clock advances the same number of ticks in both runs', () => {
    const first = run(12345, 600)
    const second = run(12345, 600)

    expect(first.tick).toBeGreaterThanOrEqual(600)
    expect(second.tick).toBe(first.tick)
  })

  it('a different seed produces a different world', () => {
    const base = run(12345, 600)
    const other = run(99999, 600)

    expect(other.stateHash).not.toBe(base.stateHash)
  })
})
