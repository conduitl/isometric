/**
 * The builder.* semantic-event vocabulary — FROZEN (D4, Builder tier,
 * Phase 3, August 2026).
 *
 * This file is the contract a decade of shipped lessons stands on. Every
 * lesson that says "the student painted a tile" can only know it because
 * painting emits `builder.tile-painted` with exactly this payload. From the
 * freeze onward (docs/DECISIONS.md D4):
 *
 * - **Additive-only.** New events may be APPENDED; no event may be removed.
 * - **No renames without an alias.** A superseded name lives in
 *   {@link BUILDER_EVENT_ALIASES} forever, so shipped lesson data and the
 *   replay corpus keep resolving.
 * - **Payload shapes are frozen too.** New OPTIONAL fields may be added;
 *   existing fields never change type or meaning, never disappear.
 * - {@link BUILDER_EVENT_PAYLOAD_FIELDS} enumerates each event's top-level
 *   payload fields as data — the validator checks lesson `where` clauses
 *   against it, so it is governed surface under the same additive-only
 *   rule: a new event appends its entry, a new optional field appends to
 *   its list, nothing is ever removed or renamed.
 * - {@link BUILDER_EVENT_HISTORY} records every event name EVER registered,
 *   append-only forever — the tripwire that makes alias permanence
 *   testable (drop a name without an alias and the history test catches
 *   it, because the historical name stops resolving).
 * - The governance snapshot in test/ pins names AND payload field lists
 *   (asserted against the two registries above) AND the payload TYPES
 *   (pinned as literal types the package typecheck compares exactly);
 *   CI fails on any non-additive drift.
 *
 * It moved here from the editor app at the freeze: apps depend on packages,
 * never the reverse, and from Phase 3 the tutorial engine (this package) and
 * the lesson content both key on these types — the vocabulary is engine
 * surface now, not app detail.
 *
 * ## Gesture-level granularity — the conventions (unchanged from the draft)
 *
 * 1. One event per completed intention, never per frame and never per
 *    increment. A 40-cell drag-paint is ONE tile-painted event; a drag-move
 *    is ONE entity-moved from gesture start to end.
 * 2. Cancelled gestures emit nothing — a lesson can never gate on something
 *    the student aborted.
 * 3. Undo emits its own event (command-undone), never the inverse of the
 *    original. Lessons that care about state gate on world predicates.
 * 4. Payloads carry world facts, not UI facts — cell coordinates, entity
 *    ids, marker kinds; never panel names or pointer positions.
 * 5. Names are past-tense verbs, namespaced by tier. Tinkerer/Engineer
 *    vocabularies arrive with their phases and freeze at their own exits.
 *
 * ## Determinism boundary
 *
 * The emitter at the bottom is the small typed channel that exists ONLY at
 * the engine↔UI boundary (ARCHITECTURE §3): synchronous, subscription
 * order, and nothing in the simulation ever reads from it.
 */

import type { EntityId } from '@engine/core'

/** The three built-in view lenses (mirrors the world's projection names —
 * kept as a local literal union so this vocabulary never grows a package
 * dependency for one string type). */
export type ViewProjectionName = 'profile' | 'topdown' | 'iso'

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
  | ViewProjectionChangedEvent

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

/** One completed move gesture (pointer drag, keyboard grab-carry-drop, or a
 * move command from a panel). */
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

/**
 * The student switched the VIEW lens — the same world re-projected through a
 * different matrix (the curated X-ray lens of ARCHITECTURE §4; the world's
 * primary projection is untouched). Added at the freeze, for the
 * perspective-reveal showcase: its steps gate on the student really
 * switching views, because zero steps anywhere may gate on "click Next".
 */
export interface ViewProjectionChangedEvent {
  readonly type: 'builder.view-projection-changed'
  readonly from: ViewProjectionName
  readonly to: ViewProjectionName
}

/** The event names, enumerable — predicates, the governance snapshot, and
 * the replay corpus key on this list. Append-only after the freeze. */
export const BUILDER_EVENT_TYPES = [
  'builder.tile-painted',
  'builder.entity-placed',
  'builder.entity-moved',
  'builder.entity-renamed',
  'builder.entity-deleted',
  'builder.selection-changed',
  'builder.command-undone',
  'builder.command-redone',
  'builder.world-saved',
  'builder.world-loaded',
  'builder.world-renamed',
  'builder.view-projection-changed',
] as const

export type BuilderEventType = BuilderEvent['type']

// The const list and the type union must agree exactly; these two lines make
// any drift a compile error in whichever direction it happens.
type AssertListCoversUnion = (typeof BUILDER_EVENT_TYPES)[number] extends BuilderEventType ? true : never
type AssertUnionCoversList = BuilderEventType extends (typeof BUILDER_EVENT_TYPES)[number] ? true : never
const _listCoversUnion: AssertListCoversUnion = true
const _unionCoversList: AssertUnionCoversList = true
void _listCoversUnion
void _unionCoversList

/** Is this string a live builder event type (aliases NOT resolved here)? */
export function isBuilderEventType(value: string): value is BuilderEventType {
  return (BUILDER_EVENT_TYPES as readonly string[]).includes(value)
}

/**
 * Each event's top-level payload field names, sorted, `type` included — the
 * frozen shapes as DATA. The validator checks every lesson `where` clause
 * against the resolved event's list here, so an author who writes
 * `where: { worldld: … }` learns about the typo in CI instead of shipping a
 * step that can never complete.
 *
 * Governed surface, same additive-only rule as the vocabulary itself
 * (see the file header): appending an event appends its entry; adding an
 * optional payload field appends to its list; nothing is ever removed. The
 * governance snapshot in test/ asserts this map field-for-field.
 */
export const BUILDER_EVENT_PAYLOAD_FIELDS: Readonly<Record<BuilderEventType, readonly string[]>> = {
  'builder.tile-painted': ['cells', 'layerId', 'tile', 'toolId', 'type'],
  'builder.entity-placed': ['elevation', 'id', 'marker', 'name', 'position', 'type'],
  'builder.entity-moved': ['from', 'id', 'to', 'type'],
  'builder.entity-renamed': ['from', 'id', 'to', 'type'],
  'builder.entity-deleted': ['id', 'marker', 'name', 'type'],
  'builder.selection-changed': ['selection', 'type'],
  'builder.command-undone': ['label', 'type'],
  'builder.command-redone': ['label', 'type'],
  'builder.world-saved': ['type', 'worldId'],
  'builder.world-loaded': ['origin', 'type', 'usedBackup', 'worldId'],
  'builder.world-renamed': ['from', 'to', 'type'],
  'builder.view-projection-changed': ['from', 'to', 'type'],
}

/**
 * Every event name EVER registered — the 12 of the August 2026 freeze,
 * today. APPEND-ONLY, FOREVER: a renamed event keeps its old name here
 * while the live list carries the new one, and the alias table bridges
 * them. This is D4's alias-permanence TRIPWIRE: the governance tests
 * demand that every historical name still resolves (live or aliased) and
 * that every live name is recorded here — so silently dropping a name, or
 * renaming one without an alias, fails CI instead of orphaning a decade of
 * shipped lesson data.
 */
export const BUILDER_EVENT_HISTORY: readonly string[] = [
  'builder.tile-painted',
  'builder.entity-placed',
  'builder.entity-moved',
  'builder.entity-renamed',
  'builder.entity-deleted',
  'builder.selection-changed',
  'builder.command-undone',
  'builder.command-redone',
  'builder.world-saved',
  'builder.world-loaded',
  'builder.world-renamed',
  'builder.view-projection-changed',
]

/**
 * The permanent alias table (D4): when a frozen name is ever superseded, the
 * old name maps here FOREVER and lesson data referencing it keeps resolving.
 * Empty at the freeze — may only grow.
 */
export const BUILDER_EVENT_ALIASES: Readonly<Record<string, BuilderEventType>> = {}

/** Resolve a (possibly aliased) event-type string to its live name, or null. */
export function resolveBuilderEventType(value: string): BuilderEventType | null {
  if (isBuilderEventType(value)) return value
  return BUILDER_EVENT_ALIASES[value] ?? null
}

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
