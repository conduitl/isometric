/*
 * The Clock — the deterministic heartbeat of the whole engine.
 *
 * ## Why a FIXED timestep? (Glenn Fiedler's "Fix Your Timestep" pattern)
 *
 * A browser hands us frames at whatever rate it feels like: 16.7ms, then 16.9ms,
 * then 40ms because another tab hiccuped. If we fed those raw deltas straight
 * into physics, two bad things happen:
 *
 * 1. **Physics goes wobbly.** Numerical integration (pos += vel * dt) is an
 *    approximation whose error depends on dt. Big, irregular steps make a
 *    bouncing ball gain or lose energy, and fast objects can "tunnel" straight
 *    through walls between two samples.
 * 2. **Replays become impossible.** Floating-point math gives slightly different
 *    answers for different step sizes, so the same game played twice would
 *    diverge. Our whole Phase 0 promise — same seed + same inputs = the exact
 *    same world, hash-verified — dies right there.
 *
 * The fix: simulation time only ever moves in identical slices of `fixedDt`
 * (1/60 s by default). Real time is irregular; simulated time is a perfect
 * staircase. Determinism and stability both fall out of that one decision.
 *
 * ## The accumulator
 *
 * Think of it as a bank account measured in seconds. Every animation frame
 * deposits the real time that just passed (times `timeScale`). The simulation
 * withdraws in fixed slices: while the balance covers one `fixedDt`, we run one
 * full tick and subtract `fixedDt`. Whatever is left over — always less than
 * one slice — stays in the account for next frame. No time is invented, none
 * is silently lost (except when we *deliberately* drop it; see below).
 *
 * ## What is alpha?
 *
 * After withdrawing whole ticks, the leftover balance divided by `fixedDt` is
 * `alpha`, a number in [0, 1): *how far we are between the tick we just
 * computed and the one we haven't computed yet*. The renderer draws each object
 * at `lerp(prevPos, pos, alpha)` so motion looks smooth even though the
 * simulation jumps in discrete steps. The physics staircase plus this one lerp
 * equals silk — that is the whole trick.
 *
 * ## Two safety valves (both are lessons, not hacks)
 *
 * - **The 0.25 s clamp.** Switch tabs for a minute and the next frame reports a
 *   60-second delta. Without a clamp we would owe 3600 ticks and freeze trying
 *   to pay. So a single frame may deposit at most 0.25 s of real time.
 * - **maxTicksPerAdvance + dropping the excess.** If the machine is too slow to
 *   simulate at real-time speed, each frame deposits more than it can withdraw,
 *   the debt grows, frames get even slower... the famous *spiral of death*.
 *   We cap the withdrawals per frame and then forgive the remaining debt
 *   entirely: **game time slows down instead of the app dying**. A fair trade,
 *   made on purpose, and now you know where to find it.
 *
 * ## Pause and step — the teaching superpower
 *
 * Because time is a staircase, "pause" just means "stop withdrawing", and we
 * can walk the stairs by hand: `stepTick` runs exactly one slice, and
 * `stepSubstage` runs one *stage* of a slice (e.g. just 'integrate', not yet
 * 'collide') so you can watch the vectors change mid-tick. That interaction is
 * the reason this file exists.
 */

/**
 * One named phase of a simulation tick — 'integrate', 'collide', that kind of
 * thing. Every tick runs all stages in array order, each receiving the same
 * `fixedDt`. Naming them is what lets the Clock pause *between* stages and
 * report which one comes next, so a learner can watch a single tick unfold in
 * slow motion.
 */
export interface Stage {
  readonly name: string
  readonly run: (dt: number) => void
}

/**
 * Knobs for {@link createClock}.
 *
 * `fixedDt` is the size of one simulation slice in seconds (default 1/60 —
 * sixty ticks per simulated second). `maxTicksPerAdvance` (default 5) is the
 * most ticks one `advance` call may run before the Clock forgives the rest of
 * its time debt — the anti-spiral-of-death valve explained in the file header.
 */
export interface ClockOptions {
  fixedDt?: number
  maxTicksPerAdvance?: number
}

/**
 * The Clock's public face. Feed it irregular real-time deltas with `advance`;
 * it turns them into perfectly regular fixed ticks. Pause it and you can move
 * simulated time by hand, one tick — or one stage of a tick — at a time.
 *
 * Reading guide: `tick` counts completed fixed steps since the last reset;
 * `alpha` (in [0, 1)) is how far real time has crept toward the *next* tick,
 * i.e. the `t` you pass to `lerp(prevPos, pos, t)` when rendering;
 * `pendingStage` names the next stage of a half-finished tick while you are
 * substage-stepping, and is null whenever no tick is mid-flight.
 */
export interface Clock {
  readonly fixedDt: number
  readonly tick: number
  readonly alpha: number
  readonly paused: boolean
  readonly timeScale: number
  readonly pendingStage: string | null
  setTimeScale(s: number): void
  pause(): void
  resume(stages: readonly Stage[]): void
  advance(realDtSeconds: number, stages: readonly Stage[]): number
  stepTick(stages: readonly Stage[]): void
  stepSubstage(stages: readonly Stage[]): string | null
  reset(): void
}

/** Sixty ticks per simulated second — the console-classic default. */
const DEFAULT_FIXED_DT = 1 / 60

/** Default cap on ticks per advance call (the spiral-of-death valve). */
const DEFAULT_MAX_TICKS_PER_ADVANCE = 5

/**
 * The most real time one frame is allowed to deposit, in seconds. A frame
 * delta bigger than this almost always means the tab was asleep, not that a
 * quarter of a second of gameplay genuinely happened.
 */
const MAX_REAL_DT = 0.25

/** `timeScale` is clamped to this range: 0 = frozen, 8 = eight-fold fast-forward. */
const MIN_TIME_SCALE = 0
const MAX_TIME_SCALE = 8

/**
 * Builds a Clock — the engine's only source of simulated time.
 *
 * Everything the Clock does is a plain, inspectable consequence of four
 * numbers it keeps privately: the completed-tick count, the accumulator
 * balance (see the file header), a cursor into the stage list for a
 * half-finished tick, and the time scale. No wall-clock reads, no randomness:
 * given the same sequence of calls it produces the same sequence of ticks,
 * bit for bit. That property is what makes replays and CI determinism tests
 * possible.
 */
export function createClock(options: ClockOptions = {}): Clock {
  const fixedDt = options.fixedDt ?? DEFAULT_FIXED_DT
  const maxTicksPerAdvance = options.maxTicksPerAdvance ?? DEFAULT_MAX_TICKS_PER_ADVANCE

  if (!Number.isFinite(fixedDt) || fixedDt <= 0) {
    throw new Error(`fixedDt must be a positive number of seconds, got ${fixedDt}`)
  }
  if (!Number.isInteger(maxTicksPerAdvance) || maxTicksPerAdvance < 1) {
    throw new Error(`maxTicksPerAdvance must be a positive integer, got ${maxTicksPerAdvance}`)
  }

  let tick = 0
  let accumulator = 0
  let paused = false
  let timeScale = 1
  // Index of the next stage to run in a half-finished tick. 0 means "no tick
  // is mid-flight" — a fresh tick and a finished tick look identical, which is
  // exactly right: substage-stepping is the only thing that leaves it nonzero.
  let cursor = 0
  let pendingStage: string | null = null

  // Runs stages[from..end] with fixedDt and closes out the tick. Called with
  // from = 0 for a whole tick, or from = cursor to finish a mid-flight one.
  // Stage lists must stay consistent between substage calls within one tick —
  // the cursor is an index, not a name lookup.
  const finishTick = (stages: readonly Stage[], from: number): void => {
    for (let i = from; i < stages.length; i += 1) {
      stages[i]?.run(fixedDt)
    }
    tick += 1
    cursor = 0
    pendingStage = null
  }

  return {
    fixedDt,

    get tick() {
      return tick
    },

    get alpha() {
      return accumulator / fixedDt
    },

    get paused() {
      return paused
    },

    get timeScale() {
      return timeScale
    },

    get pendingStage() {
      return pendingStage
    },

    setTimeScale(s: number): void {
      if (Number.isNaN(s)) return
      timeScale = Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, s))
    },

    pause(): void {
      paused = true
    },

    resume(stages: readonly Stage[]): void {
      // Never unpause into a half-finished tick: if substage-stepping left a
      // cycle mid-flight, run the remaining stages right now so the world is
      // in a between-ticks state before real time starts flowing again.
      if (cursor > 0) {
        finishTick(stages, cursor)
      }
      paused = false
    },

    advance(realDtSeconds: number, stages: readonly Stage[]): number {
      if (paused) return 0
      // NaN never leaves quarantine: NaN survives min/max clamping, and one
      // poisoned deposit would leave the accumulator NaN forever — a clock
      // that silently never ticks again. Refuse the deposit instead.
      if (Number.isNaN(realDtSeconds)) return 0

      // Clamp the deposit: negative time does not exist, and anything above
      // MAX_REAL_DT means the tab slept — see the file header.
      const realDt = Math.min(Math.max(realDtSeconds, 0), MAX_REAL_DT)
      accumulator += realDt * timeScale

      let ticksRun = 0
      while (accumulator >= fixedDt && ticksRun < maxTicksPerAdvance) {
        accumulator -= fixedDt
        finishTick(stages, 0)
        ticksRun += 1
      }

      // Still owing a full tick after hitting the cap means the machine cannot
      // keep up. Forgive the entire debt: game time slows down instead of the
      // debt (and the frame time) growing forever — the spiral-of-death lesson.
      if (accumulator >= fixedDt) {
        accumulator = 0
      }

      return ticksRun
    },

    stepTick(stages: readonly Stage[]): void {
      if (!paused) {
        throw new Error('stepTick requires a paused clock — call pause() first')
      }
      // If substage-stepping left a tick mid-flight, this completes it (running
      // only the remaining stages); otherwise it runs one whole fresh tick.
      // Either way exactly one tick boundary is crossed. The accumulator is
      // untouched: hand-stepped time is manual, not withdrawn from the bank.
      finishTick(stages, cursor)
    },

    stepSubstage(stages: readonly Stage[]): string | null {
      if (!paused) {
        throw new Error('stepSubstage requires a paused clock — call pause() first')
      }
      const stage = stages[cursor]
      if (stage === undefined) {
        // Empty stage list (or one that shrank mid-tick): nothing left to run,
        // so close out the tick — time passes even when nobody is listening.
        tick += 1
        cursor = 0
        pendingStage = null
        return null
      }
      stage.run(fixedDt)
      cursor += 1
      if (cursor >= stages.length) {
        // That was the last stage: the tick is complete, the cursor resets.
        tick += 1
        cursor = 0
        pendingStage = null
      } else {
        pendingStage = stages[cursor]?.name ?? null
      }
      return stage.name
    },

    reset(): void {
      // Back to the moment before the first tick. The paused flag survives on
      // purpose — resetting a paused lesson should not fling time forward —
      // and so does timeScale, which is a user preference, not world state.
      tick = 0
      accumulator = 0
      cursor = 0
      pendingStage = null
    },
  }
}
