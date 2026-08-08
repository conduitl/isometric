/*
 * The Engine — the facade that wires the kernel's parts into one machine.
 *
 * Every piece exists on its own: the World (rows and columns), the Scheduler
 * (verbs in order), the EventBus (mail), the Clock (the heartbeat), the
 * seeded Rng, the component Registry. The Engine owns one of each and adds
 * the two things none of them can do alone:
 *
 * 1. **stages()** — the adapter between scheduler and clock. The Clock knows
 *    only about anonymous stages; the Scheduler knows only about named
 *    systems. `stages()` turns each system into a Clock stage named
 *    '<phase>:<systemName>', so when you pause the clock and press
 *    step-substage, the name you see is the system about to run. One extra
 *    internal stage, '#tick-end', closes each tick: it swaps the event
 *    mailboxes (mail sent in tick N becomes readable in tick N+1) and
 *    advances the engine's tick counter. The '#' marks it as machinery —
 *    no system can collide with the name.
 *
 * 2. **use(plugin)** — the extension seam. A plugin is `{ name, version,
 *    register(engine) }` and register() does ordinary things with public
 *    APIs: add systems, register component definitions. Editor tools and
 *    third-party extensions come through this same door, so the door stays
 *    honest — a plugin can do nothing a student can't do by hand.
 *
 * ## Who owns time?
 *
 * The Engine creates a Clock sized to the world's fixedDt — and re-sizes it
 * when a new world loads, because the timestep belongs to the world file.
 * But the Engine does not pump it — the app's frame loop calls `engine.clock.advance(realDt,
 * engine.stages())`. Passing stages() fresh each frame is deliberate: the
 * list is recomputed on every call, so a system added a moment ago appears
 * in the very next tick. And note what each stage closes over: the engine's
 * CURRENT world and rng, looked up at run time — after loadWorld, already-
 * built stage lists automatically simulate the new world.
 *
 * `engine.tick` counts completed ticks of the current world and resets when
 * a new world loads; `clock.tick` counts for the clock's whole life and is
 * the caller's to reset. Two counters, two owners, no fighting.
 */

import { createRng } from '@engine/math'
import type { Rng } from '@engine/math'
import { createClock } from './clock'
import type { Clock, Stage } from './clock'
import { createEventBus } from './events'
import type { EventBus } from './events'
import { createRegistry } from './registry'
import type { ComponentRegistry } from './registry'
import { createScheduler } from './scheduler'
import type { Scheduler, SystemCtx } from './scheduler'
import { createWorld } from './world'
import type { World } from './world'

/**
 * An engine extension: a name (unique per engine), a version string for
 * humans and future compatibility checks, and a register function that gets
 * the engine and wires things up through its public API.
 */
export interface EnginePlugin {
  name: string
  version: string
  register(engine: Engine): void
}

/**
 * The wired machine. All parts are public and inspectable — the facade adds
 * convenience, not secrecy.
 *
 * `world` can be reassigned; doing so IS `loadWorld` (one behavior, two
 * spellings). loadWorld replaces the rng, the tick count, AND the event
 * state, and re-sizes the clock's timestep to the new world's fixedDt (see
 * Clock.setFixedDt). The clock's pause state and timeScale are the
 * deliberate exceptions — they belong to whoever is pumping the clock, not
 * to the world file. `rng` and `tick` are read-only views of state that
 * loadWorld replaces.
 */
export interface Engine {
  world: World
  readonly clock: Clock
  readonly registry: ComponentRegistry
  readonly scheduler: Scheduler
  readonly events: EventBus
  readonly rng: Rng
  readonly tick: number
  use(plugin: EnginePlugin): Engine
  plugins(): readonly string[]
  stages(): readonly Stage[]
  loadWorld(world: World): void
}

/** The internal end-of-tick stage name. The '#' prefix means "engine machinery, not a system". */
const TICK_END_STAGE = '#tick-end'

/**
 * Build an engine around a world (a fresh default world if none is given).
 * The rng is seeded from `world.settings.seed` and the clock from
 * `world.settings.fixedDt` — the world file, not the machine, decides how
 * this engine behaves. That is the whole determinism story in one sentence.
 */
export function createEngine(options: { world?: World } = {}): Engine {
  let world = options.world ?? createWorld()
  let rng: Rng = createRng(world.settings.seed)
  let tick = 0

  const clock = createClock({ fixedDt: world.settings.fixedDt })
  const registry = createRegistry()
  const scheduler = createScheduler()
  const events = createEventBus()
  /** Registered plugin names, in registration order. */
  const pluginNames: string[] = []

  const loadWorld = (next: World): void => {
    // Swap the document, re-seed randomness from ITS seed, restart the tick
    // count, adopt ITS timestep, and empty the event mailboxes — stale mail
    // could name entities that only existed in the old world. Loading the
    // same world twice therefore replays the exact same rng draws and the
    // same (empty) first-tick reads — a save file carries its luck with it.
    // What survives on the clock is deliberate: pause state and timeScale
    // belong to whoever is pumping it (the user), but fixedDt follows the
    // world — the world file, not the machine, decides how fast simulated
    // time steps. (setFixedDt also restarts the accumulator: a new timeline
    // starts with no banked time.)
    world = next
    rng = createRng(next.settings.seed)
    tick = 0
    clock.setFixedDt(next.settings.fixedDt)
    events.clear()
  }

  const engine: Engine = {
    get world(): World {
      return world
    },
    set world(next: World) {
      loadWorld(next)
    },

    clock,
    registry,
    scheduler,
    events,

    get rng(): Rng {
      return rng
    },

    get tick(): number {
      return tick
    },

    use(plugin: EnginePlugin): Engine {
      if (pluginNames.includes(plugin.name)) {
        throw new Error(
          `A plugin named '${plugin.name}' is already installed — installing it twice ` +
            `would register all of its systems and components twice.`,
        )
      }
      // Claim the name BEFORE register() runs, so a buggy plugin that
      // re-enters use() with its own name fails loudly instead of recursing.
      pluginNames.push(plugin.name)
      plugin.register(engine)
      return engine
    },

    plugins(): readonly string[] {
      return [...pluginNames]
    },

    stages(): readonly Stage[] {
      // Rebuilt from the scheduler on every call — never cached — so newly
      // added systems appear next tick. Each stage's run() builds its ctx at
      // RUN time from the engine's current world/tick/rng: the closures read
      // the live variables, not snapshots taken here.
      const stages: Stage[] = scheduler.systems().map((system) => ({
        name: `${system.phase}:${system.name}`,
        run: (dt: number): void => {
          const ctx: SystemCtx = { world, dt, tick, events, rng }
          system.run(ctx)
        },
      }))
      stages.push({
        name: TICK_END_STAGE,
        run: (): void => {
          events.swap()
          tick += 1
        },
      })
      return stages
    },

    loadWorld,
  }

  return engine
}
