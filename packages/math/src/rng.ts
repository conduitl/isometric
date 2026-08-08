/**
 * Seeded randomness — random numbers you can rewind.
 *
 * Math.random gives every run of your game a different, unrepeatable
 * sequence. That sounds like what "random" should mean, but for games it is
 * a liability:
 *
 * - REPLAYS: save just the seed and the player's inputs, and you can
 *   regenerate an entire play session — same loot drops, same crits, same
 *   world — in kilobytes instead of recording video.
 * - FAIRNESS: every speedrunner or puzzle-of-the-day player can face the
 *   exact same "random" level by sharing one number.
 * - TESTS: a bug that appears at seed 4242 appears at seed 4242 forever.
 *   Deterministic tests can use thousands of random-looking inputs and still
 *   fail reproducibly. (This engine's own property tests do exactly that.)
 *
 * A pseudo-random number generator is honestly not random at all: it is a
 * deterministic scrambling function iterated on a hidden state. Same seed →
 * same state marching → same outputs, forever and on every machine. The art
 * is making the outputs LOOK unrelated, and that's where mulberry32 comes in.
 */

/**
 * A seeded random number stream. Calling any method advances the hidden
 * state, so draws come out one after another like cards off a shuffled deck
 * — and two Rngs created with the same seed deal identical decks.
 */
export interface Rng {
  /** The seed this stream was created with — keep it and you can recreate the stream. */
  readonly seed: number
  /** The next number in the stream, uniform in [0, 1) — like Math.random, but repeatable. */
  next(): number
  /** The next number scaled into [min, max): min + next() · (max − min). */
  range(min: number, max: number): number
  /** The next integer in [minInclusive, maxExclusive) — e.g. int(1, 7) rolls a six-sided die. */
  int(minInclusive: number, maxExclusive: number): number
}

/**
 * Create a mulberry32 random stream from a 32-bit seed.
 *
 * How mulberry32 works, honestly but briefly — two moving parts:
 *
 * 1. THE COUNTER. Each draw adds the odd constant 0x6D2B79F5 to a 32-bit
 *    state (a "Weyl sequence"). Because the constant is odd and 2³² is a
 *    power of two, they share no factors, so the state visits all 2³² values
 *    before repeating — the period is guaranteed, no short cycles, no
 *    getting stuck. But a plain counter is obviously not random-looking:
 *    consecutive states differ by the same amount every time.
 *
 * 2. THE SCRAMBLER. So each draw pushes the counter through a mixing
 *    function: multiply by a large odd number, then XOR the value with a
 *    shifted copy of itself, and repeat. Multiplication lets low bits
 *    influence high bits (carries ripple upward); the XOR-with-shift folds
 *    the high bits back down onto the low ones. A few rounds of this and
 *    every input bit has influenced every output bit — flip one bit of the
 *    seed and about half the output bits flip (the "avalanche effect").
 *    That's why seeds 1, 2, 3 produce wildly different streams even though
 *    the counters underneath are nearly identical.
 *
 * The final `>>> 0` reads the result as an unsigned 32-bit integer and
 * dividing by 2³² maps it into [0, 1) — strictly below 1, since the largest
 * possible value is (2³² − 1)/2³².
 *
 * Mulberry32 is not cryptographic — don't shuffle a poker deck for money
 * with it — but it is fast, tiny, and statistically solid for games.
 */
export function createRng(seed: number): Rng {
  // `>>> 0` folds any incoming number into an unsigned 32-bit state.
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    seed,
    next,
    range(min: number, max: number): number {
      return min + next() * (max - min)
    },
    int(minInclusive: number, maxExclusive: number): number {
      // The integers inside [min, max) are exactly [ceil(min), ceil(max)) —
      // e.g. [0.5, 2.5) contains the integers {1, 2} = [1, 3). Working from
      // the ceilings makes the contract hold for ANY bounds, and when both
      // bounds are already integers the ceilings change nothing, so seeded
      // streams are identical to the plain formula. next() < 1 strictly, so
      // flooring lands in [lo, hi - 1].
      const lo = Math.ceil(minInclusive)
      const hi = Math.ceil(maxExclusive)
      return Math.floor(lo + next() * (hi - lo))
    },
  }
}
