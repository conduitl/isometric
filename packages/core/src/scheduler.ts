/*
 * The Scheduler — the visible list of verbs, in the order they run.
 *
 * If entities are rows and components are columns, systems are the VERBS:
 * each one is a named function that walks some rows and does one job. The
 * scheduler is nothing more than the ordered list of those verbs — and that
 * "nothing more" is the point. Most engines bury system ordering in
 * registration side effects; here it is a plain data structure you can print.
 * `scheduler.systems()` IS the answer to "what happens each tick, in order?"
 *
 * ## The four phases
 *
 * Every system declares which phase it belongs to, and phases always run in
 * this order within a tick:
 *
 *   input        — turn buffered player intent into world state
 *   simulate     — physics, movement, game rules (the heavy verbs)
 *   post         — reactions to what simulate did: scoring, cleanup, spawns
 *   renderMirror — copy world state out toward the renderer; never mutate
 *
 * Why phases at all? Because "read input, then move things, then react, then
 * draw" is an ordering ARGUMENT, not a convention — a system that reads
 * velocities must run after the one that writes them. Phases make the
 * argument coarse-grained and visible: within a phase, systems run in the
 * order they were added (also visible, also deterministic).
 *
 * The scheduler stores and orders; it does not run anything. The Engine
 * turns each system into a Clock stage (see engine.ts), which is what lets
 * the pause/step-substage machinery in clock.ts single-step through systems
 * one at a time — the scheduler's list is the staircase the debugger walks.
 */

import type { Rng } from '@engine/math'
import type { EventBus } from './events'
import type { World } from './world'

/** The four named phases of a tick. See the file header for what each is for. */
export type SystemPhase = 'input' | 'simulate' | 'post' | 'renderMirror'

/** The phases in execution order — the one authoritative copy, frozen so nobody can reorder a tick. */
const PHASES_IN_ORDER: SystemPhase[] = ['input', 'simulate', 'post', 'renderMirror']
export const SYSTEM_PHASES: readonly SystemPhase[] = Object.freeze(PHASES_IN_ORDER)

/**
 * Everything a system may touch, handed in as one bag per call: the world
 * (rows and columns), this tick's fixed dt in seconds, the tick number, the
 * double-buffered event bus, and the SEEDED rng — the only randomness a
 * system is allowed (Math.random is banned by lint; a system that used it
 * would break replays).
 */
export interface SystemCtx {
  world: World
  dt: number
  tick: number
  events: EventBus
  rng: Rng
}

/**
 * One verb: a unique name (how it appears in inspectors and how you remove
 * it), the phase it runs in, and the function that does the work. Plain data
 * plus one function — no lifecycle, no base class.
 */
export interface System {
  name: string
  phase: SystemPhase
  run(ctx: SystemCtx): void
}

/**
 * The ordered list of verbs. `systems()` returns them in execution order:
 * phase by phase (SYSTEM_PHASES order), insertion order within a phase.
 * `add` throws on a duplicate name; `remove` returns whether anything was
 * actually removed.
 */
export interface Scheduler {
  add(system: System): void
  remove(name: string): boolean
  systems(): readonly System[]
}

/**
 * Build an empty scheduler. Internally just an insertion-ordered array;
 * `systems()` re-derives execution order from it on every call, so order is
 * always a computed property of the data, never a cached thing that can go
 * stale.
 */
export function createScheduler(): Scheduler {
  /** All registered systems, in the order they were added. */
  const registered: System[] = []

  return {
    add(system: System): void {
      if (registered.some((existing) => existing.name === system.name)) {
        throw new Error(
          `A system named '${system.name}' is already scheduled — names are how systems ` +
            `are identified and removed, so each must be unique. Pick a different name.`,
        )
      }
      // TypeScript already restricts `phase`, but worlds are built from the
      // console too, and a typo'd phase would make the system silently never
      // run — the cruelest failure mode. Fail loudly and name the choices.
      if (!(SYSTEM_PHASES as readonly string[]).includes(system.phase)) {
        throw new Error(
          `System '${system.name}' has unknown phase '${String(system.phase)}' — ` +
            `valid phases are: ${SYSTEM_PHASES.join(', ')}.`,
        )
      }
      registered.push(system)
    },

    remove(name: string): boolean {
      const index = registered.findIndex((system) => system.name === name)
      if (index === -1) return false
      registered.splice(index, 1)
      return true
    },

    systems(): readonly System[] {
      // Group by phase, keeping insertion order inside each group. (A sort
      // would work too, but a double loop over four phases is more obviously
      // stable — and "obviously" is a feature in a teaching kernel.)
      const ordered: System[] = []
      for (const phase of SYSTEM_PHASES) {
        for (const system of registered) {
          if (system.phase === phase) ordered.push(system)
        }
      }
      return ordered
    },
  }
}
