/**
 * @engine/core — the glass-box kernel.
 *
 * Phase 0 ships exactly one thing: the deterministic Clock (fixed timestep,
 * pause, step-tick, step-substage). The entity-component world store, the
 * scheduler, and events arrive in Phase 1 and will be re-exported from here.
 */
export { createClock } from './clock'
export type { Clock, ClockOptions, Stage } from './clock'
