/**
 * @engine/math — the engine's math library AND its first lesson.
 *
 * Everything here is deterministic, immutable, and documented with its
 * derivation. Start reading in scalar.ts (one-number tools), then vec2.ts
 * (positions and directions), then mat3.ts (transforms), then rng.ts
 * (repeatable randomness), then spaces.ts (making the compiler catch
 * coordinate-space mixups).
 */

export * as Scalar from './scalar'
export { Vec2 } from './vec2'
export { Mat3 } from './mat3'
export { createRng } from './rng'
export type { Rng } from './rng'
export * from './spaces'
