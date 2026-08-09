/**
 * The builder.* semantic-event vocabulary — DRAFT (freezes at Phase 3).
 *
 * These events are how shipped lessons will ever know what a student did:
 * "paint three tiles" is checkable only because painting emits
 * `builder.tile-painted`. The vocabulary is versioned like the file format
 * (docs/ARCHITECTURE.md §8, docs/DECISIONS.md D4): frozen at Phase 3 exit,
 * additive-only afterward, payload schemas frozen too, with a permanent
 * alias table so shipped lessons replay forever. Until that freeze this
 * file is a DRAFT — names may still change, which is exactly why lessons
 * ship none yet.
 *
 * ## Gesture-level granularity — the conventions, written down (ROADMAP P2)
 *
 * 1. **One event per completed intention, never per frame and never per
 *    increment.** A drag-paint stroke that touches 40 cells is ONE
 *    tile-painted event carrying 40 cells; a drag-move is ONE entity-moved
 *    from gesture start to gesture end. If an event could fire at pointer
 *    rate, its design is wrong.
 * 2. **Cancelled gestures emit nothing.** Esc during a stroke or drag means
 *    no event — a lesson can never gate on something the student aborted.
 * 3. **Undo emits its own event, not the inverse of the original.** Undoing
 *    a paint does NOT emit tile-painted with the old cells; it emits
 *    command-undone with the label. Lessons that care about state gate on
 *    world predicates, which read the truth after any amount of undo.
 * 4. **Payloads carry world facts, not UI facts.** Cell coordinates, entity
 *    ids, marker kinds — never panel names, pointer positions, or DOM
 *    details. (The step schema has no UI-state predicate type at all —
 *    ARCHITECTURE §9.)
 * 5. **Names are past-tense verbs, namespaced by tier**: builder.* for
 *    everything the Builder tier can do. Tinkerer/Engineer vocabularies
 *    arrive with their phases.
 *
 * ## Determinism boundary
 *
 * This is the small typed emitter that exists ONLY at the engine↔UI
 * boundary (ARCHITECTURE §3): listeners are notified synchronously in
 * subscription order, but nothing in the simulation ever reads from it —
 * so it cannot perturb replay hashes.
 */

import type { EntityId } from '@engine/core'

/** Every builder.* event, as data. The `type` strings ARE the vocabulary. */
export type BuilderEvent =
  | TilePaintedEvent
  | EntityPlacedEvent
  | EntityMovedEvent
  | EntityRenamedEvent
  | EntityDeletedEvent
  | SelectionChangedEvent
  | CommandUndoneEvent
  | CommandRedoneEvent
  | WorldSavedEvent
  | WorldLoadedEvent
  | WorldRenamedEvent

/** One completed brush gesture (mouse drag or keyboard Enter): every cell it
 * actually changed, the tile value painted (0 = erased), and which tool. */
export interface TilePaintedEvent {
  readonly type: 'builder.tile-painted'
  readonly layerId: string
  /** The painted cell value (1-based into the tileset; 0 erased). */
  readonly tile: number
  /** The cells that actually changed, in paint order. Never empty — a
   * gesture that changed nothing emits nothing (convention 2). */
  readonly cells: ReadonlyArray<{ readonly tx: number; readonly ty: number }>
  readonly toolId: string
}

export interface EntityPlacedEvent {
  readonly type: 'builder.entity-placed'
  readonly id: EntityId
  readonly marker: string
  readonly name: string
  readonly position: { readonly x: number; readonly y: number }
  readonly elevation: number
}

/** One completed move gesture (drag commit, or a move command from a panel). */
export interface EntityMovedEvent {
  readonly type: 'builder.entity-moved'
  readonly id: EntityId
  readonly from: { readonly x: number; readonly y: number; readonly z: number }
  readonly to: { readonly x: number; readonly y: number; readonly z: number }
}

export interface EntityRenamedEvent {
  readonly type: 'builder.entity-renamed'
  readonly id: EntityId
  readonly from: string
  readonly to: string
}

export interface EntityDeletedEvent {
  readonly type: 'builder.entity-deleted'
  readonly id: EntityId
  readonly marker: string | null
  readonly name: string
}

/** The selection changed to something new (deselect included, as null).
 * Fires once per change — reselecting the same thing is silent. */
export interface SelectionChangedEvent {
  readonly type: 'builder.selection-changed'
  readonly selection:
    | { readonly kind: 'entity'; readonly id: EntityId }
    | { readonly kind: 'tile'; readonly tx: number; readonly ty: number; readonly layerId: string | null }
    | null
}

export interface CommandUndoneEvent {
  readonly type: 'builder.command-undone'
  readonly label: string
}

export interface CommandRedoneEvent {
  readonly type: 'builder.command-redone'
  readonly label: string
}

export interface WorldSavedEvent {
  readonly type: 'builder.world-saved'
  readonly worldId: string
}

/** A document arrived (boot, load, import, restore-backup, new). */
export interface WorldLoadedEvent {
  readonly type: 'builder.world-loaded'
  readonly worldId: string
  readonly origin: 'boot' | 'load' | 'import' | 'restore' | 'new'
  readonly usedBackup: boolean
}

export interface WorldRenamedEvent {
  readonly type: 'builder.world-renamed'
  readonly from: string
  readonly to: string
}

/** The event names, enumerable (lesson predicates and tests key on these). */
export type BuilderEventType = BuilderEvent['type']

/**
 * The alias table (D4): when a frozen name is ever superseded, the old name
 * maps here and replays keep working. Empty by design until the Phase 3
 * freeze — nothing can need an alias before anything is frozen.
 */
export const BUILDER_EVENT_ALIASES: Readonly<Record<string, BuilderEventType>> = {}

/** The tiny boundary emitter. Synchronous, subscription order, unsubscribe
 * by calling the returned function. Listeners that throw do not stop the
 * others — a broken lesson panel must never eat a save event. */
export interface BuilderEmitter {
  emit(event: BuilderEvent): void
  on(listener: (event: BuilderEvent) => void): () => void
}

export function createBuilderEmitter(): BuilderEmitter {
  const listeners = new Set<(event: BuilderEvent) => void>()
  return {
    emit(event: BuilderEvent): void {
      for (const listener of [...listeners]) {
        try {
          listener(event)
        } catch (error) {
          // A listener's bug is its own; the event still reaches everyone else.
          console.error('builder event listener failed', error)
        }
      }
    },
    on(listener: (event: BuilderEvent) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
