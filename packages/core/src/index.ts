/**
 * @engine/core — the glass-box kernel.
 *
 * Phase 0 shipped the deterministic Clock (fixed timestep, pause, step-tick,
 * step-substage). Phase 1 adds the rest of the kernel: the entity-component
 * World ("entities are rows, components are columns"), the component
 * Registry, the double-buffered EventBus, the phased Scheduler ("systems are
 * verbs"), and the Engine facade with its plugin seam.
 *
 * Reading order for the curious: clock.ts (time), world.ts (data),
 * registry.ts (what the data means), events.ts (mail between systems),
 * scheduler.ts (verbs in order), engine.ts (the wiring).
 */
export { createClock } from './clock'
export type { Clock, ClockOptions, Stage } from './clock'

export { createWorld, spawn, despawn, getEntity, entityIds, query, compareEntityIds } from './world'
export type { EntityId, Entity, WorldSettings, WorldMeta, TileDef, Tileset, TileLayer, World } from './world'

export { createRegistry } from './registry'
export type { ComponentDef, ComponentRegistry } from './registry'

export { createEventBus } from './events'
export type { EventBus } from './events'

export { SYSTEM_PHASES, createScheduler } from './scheduler'
export type { SystemPhase, SystemCtx, System, Scheduler } from './scheduler'

export { createEngine } from './engine'
export type { Engine, EnginePlugin } from './engine'
