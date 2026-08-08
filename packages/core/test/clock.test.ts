import { createRng } from '@engine/math'
import { describe, expect, it } from 'vitest'
import { createClock } from '../src/clock'
import type { Stage } from '../src/clock'

/** Seeded generator so property-style tests stay deterministic: same seed, same sequence, every run. */
function mulberry32(seed: number): () => number {
  const rng = createRng(seed)
  return () => rng.next()
}

/** Stages that log their name (and the dt they received) when run. */
function recordingStages(
  names: readonly string[],
  log: string[],
  dts?: number[],
): readonly Stage[] {
  return names.map((name) => ({
    name,
    run: (dt: number) => {
      log.push(name)
      dts?.push(dt)
    },
  }))
}

const FIXED = 1 / 60

describe('createClock defaults', () => {
  it('starts unpaused at tick 0, alpha 0, timeScale 1, no pending stage', () => {
    const clock = createClock()
    expect(clock.fixedDt).toBe(FIXED)
    expect(clock.tick).toBe(0)
    expect(clock.alpha).toBe(0)
    expect(clock.paused).toBe(false)
    expect(clock.timeScale).toBe(1)
    expect(clock.pendingStage).toBeNull()
  })

  it('rejects nonsensical options', () => {
    expect(() => createClock({ fixedDt: 0 })).toThrow()
    expect(() => createClock({ fixedDt: -1 })).toThrow()
    expect(() => createClock({ maxTicksPerAdvance: 0 })).toThrow()
  })
})

describe('advance', () => {
  it('runs all stages in array order once per tick, each receiving fixedDt', () => {
    const clock = createClock()
    const log: string[] = []
    const dts: number[] = []
    const stages = recordingStages(['platform', 'integrate', 'collide'], log, dts)

    const ran = clock.advance(2.5 * FIXED, stages)

    expect(ran).toBe(2)
    expect(clock.tick).toBe(2)
    expect(log).toEqual(['platform', 'integrate', 'collide', 'platform', 'integrate', 'collide'])
    expect(dts.every((dt) => dt === FIXED)).toBe(true)
    expect(clock.alpha).toBeCloseTo(0.5, 9)
  })

  it('banks fractional frames in the accumulator until they add up to a tick', () => {
    const clock = createClock()
    expect(clock.advance(0.01, [])).toBe(0)
    expect(clock.tick).toBe(0)
    expect(clock.alpha).toBeGreaterThan(0)
    expect(clock.advance(0.01, [])).toBe(1) // 0.02 total > 1/60
    expect(clock.tick).toBe(1)
  })

  it('ticks even with an empty stage list — time passes when nobody listens', () => {
    const clock = createClock()
    expect(clock.advance(2 * FIXED, [])).toBe(2)
    expect(clock.tick).toBe(2)
  })

  it('ignores negative real dt', () => {
    const clock = createClock()
    expect(clock.advance(-5, [])).toBe(0)
    expect(clock.alpha).toBe(0)
  })

  it('clamps a single frame to 0.25s of real time (tab-switch protection)', () => {
    const clock = createClock({ maxTicksPerAdvance: 1000 })
    const ran = clock.advance(10, [])
    expect(ran).toBe(15) // 0.25s * 60 ticks/s
    expect(clock.tick).toBe(15)
    expect(clock.alpha).toBeGreaterThanOrEqual(0)
    expect(clock.alpha).toBeLessThan(1)
  })

  it('runs at most maxTicksPerAdvance ticks and drops the excess accumulator', () => {
    const clock = createClock() // default max 5
    const ran = clock.advance(10, [])
    expect(ran).toBe(5)
    expect(clock.tick).toBe(5)
    // The unpaid debt was forgiven, not banked: a tiny follow-up frame must
    // not release a burst of leftover ticks.
    expect(clock.alpha).toBe(0)
    expect(clock.advance(0.001, [])).toBe(0)
    expect(clock.tick).toBe(5)
  })

  it('keeps alpha in [0,1) across a varied advance sequence', () => {
    const clock = createClock()
    const rand = mulberry32(7)
    for (let i = 0; i < 500; i += 1) {
      clock.advance(rand() * 0.05, [])
      expect(clock.alpha).toBeGreaterThanOrEqual(0)
      expect(clock.alpha).toBeLessThan(1)
    }
  })

  it('supports a custom fixedDt', () => {
    const clock = createClock({ fixedDt: 0.1 })
    expect(clock.advance(0.24, [])).toBe(2)
    expect(clock.tick).toBe(2)
    expect(clock.alpha).toBeCloseTo(0.4, 9)
  })
})

describe('timeScale', () => {
  it('scales deposited real time', () => {
    const clock = createClock()
    clock.setTimeScale(2)
    expect(clock.advance(0.025, [])).toBe(3) // 0.05s of game time = 3 ticks
    expect(clock.tick).toBe(3)
  })

  it('clamps to [0, 8]', () => {
    const clock = createClock()
    clock.setTimeScale(99)
    expect(clock.timeScale).toBe(8)
    clock.setTimeScale(-3)
    expect(clock.timeScale).toBe(0)
    clock.setTimeScale(1.5)
    expect(clock.timeScale).toBe(1.5)
  })

  it('setTimeScale(0) freezes time while unpaused', () => {
    const clock = createClock()
    clock.setTimeScale(0)
    for (let i = 0; i < 10; i += 1) {
      expect(clock.advance(0.1, [])).toBe(0)
    }
    expect(clock.tick).toBe(0)
    expect(clock.alpha).toBe(0)
    expect(clock.paused).toBe(false)
  })
})

describe('pause', () => {
  it('paused advance returns 0 and accumulates nothing', () => {
    const clock = createClock()
    clock.pause()
    expect(clock.paused).toBe(true)
    expect(clock.advance(0.2, [])).toBe(0)
    expect(clock.advance(0.2, [])).toBe(0)
    expect(clock.tick).toBe(0)
    expect(clock.alpha).toBe(0)

    // If those 0.4s had been banked, this tiny frame would release a burst.
    clock.resume([])
    expect(clock.advance(0.005, [])).toBe(0)
    expect(clock.tick).toBe(0)
  })
})

describe('stepping', () => {
  const NAMES = ['platform', 'integrate', 'collide'] as const

  it('stepTick throws when not paused', () => {
    const clock = createClock()
    expect(() => clock.stepTick([])).toThrow(/paused/)
  })

  it('stepSubstage throws when not paused', () => {
    const clock = createClock()
    expect(() => clock.stepSubstage([])).toThrow(/paused/)
  })

  it('stepTick runs one full cycle, increments tick, leaves the accumulator alone', () => {
    const clock = createClock()
    clock.advance(0.5 * FIXED, []) // put something in the accumulator
    const alphaBefore = clock.alpha
    clock.pause()

    const log: string[] = []
    const dts: number[] = []
    clock.stepTick(recordingStages(NAMES, log, dts))

    expect(log).toEqual([...NAMES])
    expect(dts.every((dt) => dt === FIXED)).toBe(true)
    expect(clock.tick).toBe(1)
    expect(clock.alpha).toBe(alphaBefore)
    expect(clock.pendingStage).toBeNull()
  })

  it('stepSubstage walks stage names in order; tick increments only after the last', () => {
    const clock = createClock()
    clock.pause()
    const log: string[] = []
    const stages = recordingStages(NAMES, log)

    expect(clock.stepSubstage(stages)).toBe('platform')
    expect(clock.tick).toBe(0)
    expect(clock.pendingStage).toBe('integrate')

    expect(clock.stepSubstage(stages)).toBe('integrate')
    expect(clock.tick).toBe(0)
    expect(clock.pendingStage).toBe('collide')

    expect(clock.stepSubstage(stages)).toBe('collide')
    expect(clock.tick).toBe(1)
    expect(clock.pendingStage).toBeNull()
    expect(log).toEqual([...NAMES])

    // The cursor reset: the next substage starts a fresh cycle.
    expect(clock.stepSubstage(stages)).toBe('platform')
    expect(clock.tick).toBe(1)
  })

  it('stepTick completes a mid-flight substage cycle without re-running earlier stages', () => {
    const clock = createClock()
    clock.pause()
    const log: string[] = []
    const stages = recordingStages(NAMES, log)

    clock.stepSubstage(stages) // runs 'platform'
    clock.stepTick(stages) // must run only 'integrate' and 'collide'

    expect(log).toEqual([...NAMES])
    expect(clock.tick).toBe(1)
    expect(clock.pendingStage).toBeNull()
  })

  it('resume() completes a mid-flight cycle exactly once, then unpauses', () => {
    const clock = createClock()
    clock.pause()
    const log: string[] = []
    const stages = recordingStages(NAMES, log)

    clock.stepSubstage(stages) // runs 'platform'
    clock.resume(stages)

    expect(log).toEqual([...NAMES]) // each stage ran exactly once
    expect(clock.tick).toBe(1)
    expect(clock.paused).toBe(false)
    expect(clock.pendingStage).toBeNull()

    // Nothing lingers: a zero-length advance runs no stages.
    expect(clock.advance(0, stages)).toBe(0)
    expect(log).toEqual([...NAMES])
  })

  it('resume() with no mid-flight cycle runs nothing', () => {
    const clock = createClock()
    clock.pause()
    const log: string[] = []
    clock.resume(recordingStages(NAMES, log))
    expect(log).toEqual([])
    expect(clock.tick).toBe(0)
    expect(clock.paused).toBe(false)
  })
})

describe('mid-tick stage-list rebuilds (the snapshot rule)', () => {
  it('a system added mid-tick appears at the start of the NEXT tick, never spliced into this one', () => {
    const clock = createClock()
    clock.pause()
    const log: string[] = []
    const original = recordingStages(['integrate', 'collide'], log)

    clock.stepSubstage(original) // runs 'integrate'; cursor now points at index 1

    // Mid-tick, a system lands in an already-passed phase and the caller
    // rebuilds its stage list: 'input' now occupies index 0, so a raw index
    // into the NEW list would re-run 'integrate' and never run the addition.
    const rebuilt = recordingStages(['input', 'integrate', 'collide'], log)
    clock.stepTick(rebuilt) // finish the tick

    // The tick finished on its ORIGINAL list: each stage ran exactly once.
    expect(log).toEqual(['integrate', 'collide'])
    expect(clock.tick).toBe(1)
    expect(clock.pendingStage).toBeNull()

    // The next tick begins with the new list, addition included.
    clock.stepTick(rebuilt)
    expect(log).toEqual(['integrate', 'collide', 'input', 'integrate', 'collide'])
    expect(clock.tick).toBe(2)
  })

  it('substage steps and pendingStage follow the snapshot, not the rebuilt list', () => {
    const clock = createClock()
    clock.pause()
    const log: string[] = []
    const original = recordingStages(['integrate', 'collide'], log)

    clock.stepSubstage(original)
    expect(clock.pendingStage).toBe('collide')

    const rebuilt = recordingStages(['input', 'integrate', 'collide'], log)
    expect(clock.stepSubstage(rebuilt)).toBe('collide') // the snapshot wins
    expect(clock.tick).toBe(1)
    expect(log).toEqual(['integrate', 'collide'])

    // Fresh tick, no snapshot: the new list is adopted from stage 0.
    expect(clock.stepSubstage(rebuilt)).toBe('input')
    expect(clock.pendingStage).toBe('integrate')
  })

  it('resume() finishes a mid-flight tick from the snapshot too', () => {
    const clock = createClock()
    clock.pause()
    const log: string[] = []
    const original = recordingStages(['integrate', 'collide'], log)

    clock.stepSubstage(original)
    clock.resume(recordingStages(['input', 'integrate', 'collide'], log))

    expect(log).toEqual(['integrate', 'collide']) // original stages, once each
    expect(clock.tick).toBe(1)
    expect(clock.paused).toBe(false)
  })
})

describe('setFixedDt — the timestep follows the world', () => {
  it('changes the tick cadence', () => {
    const clock = createClock() // 1/60
    clock.setFixedDt(0.1)
    expect(clock.fixedDt).toBe(0.1)
    const dts: number[] = []
    const stages = recordingStages(['sim'], [], dts)
    expect(clock.advance(0.25, stages)).toBe(2) // 10 ticks/s now, not 60
    expect(dts).toEqual([0.1, 0.1])
  })

  it('rejects nonsensical timesteps, exactly like the constructor', () => {
    const clock = createClock()
    expect(() => clock.setFixedDt(0)).toThrow(/positive/)
    expect(() => clock.setFixedDt(-1)).toThrow(/positive/)
    expect(() => clock.setFixedDt(Number.NaN)).toThrow(/positive/)
    expect(() => clock.setFixedDt(Number.POSITIVE_INFINITY)).toThrow(/positive/)
    expect(clock.fixedDt).toBe(FIXED) // nothing changed
  })

  it('throws while a substage cycle is mid-flight', () => {
    const clock = createClock()
    clock.pause()
    clock.stepSubstage(recordingStages(['a', 'b'], []))
    expect(() => clock.setFixedDt(0.1)).toThrow(/mid-flight/)
    expect(clock.fixedDt).toBe(FIXED)
  })

  it('zeroes the accumulator: a new timeline starts with no banked time', () => {
    const clock = createClock() // 1/60
    clock.advance(0.5 * FIXED, []) // bank half a tick of real time
    expect(clock.alpha).toBeGreaterThan(0)

    clock.setFixedDt(1 / 240) // the old balance would cover 2 of these slices

    expect(clock.alpha).toBe(0)
    expect(clock.advance(0, [])).toBe(0) // no phantom ticks fire
    expect(clock.tick).toBe(0)
  })
})

describe('reset', () => {
  it('zeroes tick and accumulator but keeps the paused flag', () => {
    const clock = createClock()
    clock.advance(3.5 * FIXED, [])
    clock.pause()
    expect(clock.tick).toBe(3)
    expect(clock.alpha).toBeGreaterThan(0)

    clock.reset()
    expect(clock.tick).toBe(0)
    expect(clock.alpha).toBe(0)
    expect(clock.paused).toBe(true) // still paused

    const unpausedClock = createClock()
    unpausedClock.advance(2 * FIXED, [])
    unpausedClock.reset()
    expect(unpausedClock.paused).toBe(false) // still running
    expect(unpausedClock.tick).toBe(0)
  })

  it('clears a mid-flight substage cursor', () => {
    const clock = createClock()
    clock.pause()
    const log: string[] = []
    const stages = recordingStages(['a', 'b'], log)
    clock.stepSubstage(stages)
    expect(clock.pendingStage).toBe('b')

    clock.reset()
    expect(clock.pendingStage).toBeNull()
    expect(clock.stepSubstage(stages)).toBe('a') // fresh cycle from the top
  })

  it('preserves timeScale (a user preference, not world state)', () => {
    const clock = createClock()
    clock.setTimeScale(4)
    clock.reset()
    expect(clock.timeScale).toBe(4)
  })
})

describe('determinism', () => {
  it('identical advance sequences produce identical tick/alpha trajectories', () => {
    const a = createClock()
    const b = createClock()
    const randA = mulberry32(12345)
    const randB = mulberry32(12345)

    for (let i = 0; i < 300; i += 1) {
      const ranA = a.advance(randA() * 0.04, [])
      const ranB = b.advance(randB() * 0.04, [])
      expect(ranB).toBe(ranA)
      expect(b.tick).toBe(a.tick)
      expect(b.alpha).toBe(a.alpha) // exact — same floats, bit for bit
    }
    expect(a.tick).toBeGreaterThan(0)
  })

  it('stage run counts match tick counts exactly over a random sequence', () => {
    const clock = createClock()
    const rand = mulberry32(99)
    let runs = 0
    const stages: readonly Stage[] = [{ name: 'only', run: () => (runs += 1) }]
    for (let i = 0; i < 200; i += 1) {
      clock.advance(rand() * 0.03, stages)
    }
    expect(runs).toBe(clock.tick)
  })
})

describe('review regressions: NaN quarantine', () => {
  it('advance(NaN) runs zero ticks and does not poison the accumulator', () => {
    const clock = createClock({ fixedDt: 1 / 60 })
    const log: string[] = []
    const stages = recordingStages(['sim'], log)

    expect(clock.advance(Number.NaN, stages)).toBe(0)
    expect(Number.isFinite(clock.alpha)).toBe(true)

    // The clock still works afterwards — one fixedDt deposit runs one tick.
    expect(clock.advance(1 / 60, stages)).toBe(1)
    expect(clock.tick).toBe(1)
  })
})
