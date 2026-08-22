/*
 * Entity- and settings-scale commands, executed as pure functions.
 *
 * Each helper here takes the CURRENT document plus one EditorCommand and
 * answers with a {@link CommandOutcome} — it never mutates its input, never
 * touches history, never emits an event. The bus (bus.ts) owns those
 * ceremonies; this module owns exactly one question: "what would this
 * command do to this document?" Keeping that question pure is what makes
 * the `apply ∘ invert = identity` property testable per command kind
 * (docs/ARCHITECTURE.md §6) — a pure function with visible inputs has
 * nowhere to hide non-determinism.
 *
 * The three possible answers, and why each exists:
 *
 * - **rejected** — the command names an entity that is not there (or has no
 *   position to move). A stale panel asking to move a deleted entity is an
 *   expected conversation, not a crash, so the answer is a reason string,
 *   never a throw (types.ts: a command is a REQUEST).
 * - **noop** — the command is valid but would change nothing (renaming to
 *   the same name, moving to the identical position). Recording it would
 *   put a blank entry in history: undo would appear to do nothing, which
 *   reads as a bug to a ten-year-old. No-ops are detected BEFORE produce,
 *   so an applied outcome always carries real patches.
 * - **applied** — the next document (via Immer `produceWithPatches`, so
 *   untouched branches — including `layers` and every Uint16Array — stay
 *   reference-identical), the forward/inverse patch pair for history, a
 *   short human label ("place crate"), and the one builder.* event the bus
 *   must emit.
 *
 * Two invariants worth naming:
 *
 * - **Ids are minted BEFORE produce.** `e${doc.nextEntityId}` is knowable
 *   from the base document, so the event and the tests can name the new
 *   entity without fishing in the draft — and replaying the same command
 *   against the same document mints the same id, which is the fact the
 *   fuzz test's replay oracle stands on (ids are monotonic, never chosen
 *   by callers — docs/DECISIONS.md D2).
 * - **Patch paths are id-keyed** (`entities.e42.name`) because the world
 *   stores entities in a Record, so a patch stays correct no matter what
 *   was created or deleted in between (world.ts explains why not an array).
 */

import { despawn, getEntity, spawn } from '@engine/core'
import type { Entity, World } from '@engine/core'
import { produceWithPatches } from 'immer'
import type { Patch } from 'immer'
import type { BuilderEvent } from '../events/builder'
import { PIP_FIGURINE } from '../figurine'
import type {
  DeleteEntityCommand,
  EditorCommand,
  MoveEntityCommand,
  PlaceEntityCommand,
  RenameEntityCommand,
  RenameWorldCommand,
} from '../types'
import './immer-setup'

/**
 * What executing a command against a document would do. `rejected` and
 * `noop` leave the document alone; `applied` carries everything the bus
 * needs: the next document, the patch pair for history, the history label,
 * and the builder.* event to emit.
 */
export type CommandOutcome =
  | { readonly status: 'rejected'; readonly reason: string }
  | { readonly status: 'noop'; readonly label: string }
  | {
      readonly status: 'applied'
      readonly next: World
      readonly patches: readonly Patch[]
      readonly inversePatches: readonly Patch[]
      readonly label: string
      readonly event: BuilderEvent
    }

function rejected(reason: string): CommandOutcome {
  return { status: 'rejected', reason }
}

// --- component readers -----------------------------------------------------
// Components are plain data with no schema enforcement at this layer, and a
// hand-edited world file can hold anything (the glass box encourages that),
// so every read checks the shape it needs instead of trusting a cast.

function readPosition(entity: Entity): { x: number; y: number } | null {
  const value = entity.components['position']
  if (typeof value !== 'object' || value === null) return null
  const { x, y } = value as { x?: unknown; y?: unknown }
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null
}

/** The entity's storey, from its elevation component. Absent or malformed
 * elevation means ground level — z = 0, the same default the renderer uses. */
function readElevation(entity: Entity): number {
  const value = entity.components['elevation']
  if (typeof value !== 'object' || value === null) return 0
  const z = (value as { z?: unknown }).z
  return typeof z === 'number' ? z : 0
}

function readMarker(entity: Entity): string | null {
  const value = entity.components['marker']
  if (typeof value !== 'object' || value === null) return null
  const kind = (value as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : null
}

// --- the five command kinds ------------------------------------------------

/**
 * Spawn a marker entity. Never rejects and never no-ops: the document's own
 * counter mints the id, so there is nothing stale to collide with.
 *
 * One marker kind gets an extra component: 'pip' — the app's one built-in
 * FIGURINE (figurine.ts) — carries `figurine: PIP_FIGURINE` alongside the
 * usual trio, which is what turns the renderer's dot into a voxel miniature
 * (render.ts's drawMarker) and rides through save/load for free (components
 * are opaque, JSON-serializable data at the file boundary — @engine/core's
 * World doc comment). Every other marker kind is unaffected; this is the one
 * place a marker's KIND changes what gets spawned, and it stays exactly one
 * `if`, not a lookup table, because v1 ships exactly one figurine.
 */
export function placeEntity(doc: World, command: PlaceEntityCommand): CommandOutcome {
  // Minted from the BASE document, before produce — see the file header.
  const id = `e${doc.nextEntityId}`
  const name = command.name ?? command.marker
  const [next, patches, inversePatches] = produceWithPatches(doc, (draft) => {
    // spawn is a plain-object mutator, so it works on an Immer draft; the
    // cast only bridges Immer's Draft<World> mapped type back to World.
    spawn(draft as World, {
      name,
      components: {
        position: { x: command.position.x, y: command.position.y },
        elevation: { z: command.elevation },
        marker: { kind: command.marker },
        ...(command.marker === 'pip' ? { figurine: PIP_FIGURINE } : {}),
      },
    })
  })
  return {
    status: 'applied',
    next,
    patches,
    inversePatches,
    label: `place ${command.marker}`,
    event: {
      type: 'builder.entity-placed',
      id,
      marker: command.marker,
      name,
      position: { x: command.position.x, y: command.position.y },
      elevation: command.elevation,
    },
  }
}

/**
 * Move an entity to a new ground position (and optionally a new storey).
 * Rejects when the entity is missing or has no position component; no-ops
 * when the destination is exactly where the entity already stands.
 */
export function moveEntity(doc: World, command: MoveEntityCommand): CommandOutcome {
  const entity = getEntity(doc, command.id)
  if (entity === undefined) {
    return rejected(`no entity "${command.id}" to move — it may have been deleted`)
  }
  const from = readPosition(entity)
  if (from === null) {
    return rejected(`entity "${command.id}" has no position, so there is nothing to move`)
  }
  const fromZ = readElevation(entity)
  const toZ = command.toElevation ?? fromZ
  const label = `move ${entity.name}`
  if (from.x === command.to.x && from.y === command.to.y && toZ === fromZ) {
    return { status: 'noop', label }
  }
  const [next, patches, inversePatches] = produceWithPatches(doc, (draft) => {
    const target = draft.entities[command.id]
    if (target === undefined) return
    // Shape already validated against the base state; the draft holds the
    // drafted twin of the same object. Mutating fields (not replacing the
    // component) keeps the patches minimal: one replace per changed field.
    const position = target.components['position'] as { x: number; y: number }
    position.x = command.to.x
    position.y = command.to.y
    if (command.toElevation !== undefined && command.toElevation !== fromZ) {
      // Replace the whole component: it may be absent (z defaulted to 0) or
      // malformed, and { z } is its entire documented shape.
      target.components['elevation'] = { z: command.toElevation }
    }
  })
  return {
    status: 'applied',
    next,
    patches,
    inversePatches,
    label,
    event: {
      type: 'builder.entity-moved',
      id: command.id,
      from: { x: from.x, y: from.y, z: fromZ },
      to: { x: command.to.x, y: command.to.y, z: toZ },
    },
  }
}

/** Rename an entity. Rejects when missing; no-ops on the same name. */
export function renameEntity(doc: World, command: RenameEntityCommand): CommandOutcome {
  const entity = getEntity(doc, command.id)
  if (entity === undefined) {
    return rejected(`no entity "${command.id}" to rename — it may have been deleted`)
  }
  const label = `rename ${entity.name}`
  if (entity.name === command.name) {
    return { status: 'noop', label }
  }
  const [next, patches, inversePatches] = produceWithPatches(doc, (draft) => {
    const target = draft.entities[command.id]
    if (target !== undefined) target.name = command.name
  })
  return {
    status: 'applied',
    next,
    patches,
    inversePatches,
    label,
    event: { type: 'builder.entity-renamed', id: command.id, from: entity.name, to: command.name },
  }
}

/** Delete an entity. Rejects when it is already gone (deleting twice from
 * two panels is the classic stale-request conversation). */
export function deleteEntity(doc: World, command: DeleteEntityCommand): CommandOutcome {
  const entity = getEntity(doc, command.id)
  if (entity === undefined) {
    return rejected(`no entity "${command.id}" to delete — it may already be gone`)
  }
  const [next, patches, inversePatches] = produceWithPatches(doc, (draft) => {
    despawn(draft as World, command.id)
  })
  return {
    status: 'applied',
    next,
    patches,
    inversePatches,
    label: `delete ${entity.name}`,
    event: {
      type: 'builder.entity-deleted',
      id: command.id,
      marker: readMarker(entity),
      name: entity.name,
    },
  }
}

/** Rename the world (meta.name) — the Builder tier's settings-scale edit.
 * No-ops on the same name; nothing to reject (the world always exists). */
export function renameWorld(doc: World, command: RenameWorldCommand): CommandOutcome {
  const label = 'rename world'
  if (doc.meta.name === command.name) {
    return { status: 'noop', label }
  }
  const [next, patches, inversePatches] = produceWithPatches(doc, (draft) => {
    draft.meta.name = command.name
  })
  return {
    status: 'applied',
    next,
    patches,
    inversePatches,
    label,
    event: { type: 'builder.world-renamed', from: doc.meta.name, to: command.name },
  }
}

/**
 * Execute any EditorCommand against a document — the single entry point the
 * bus dispatches through. The switch is exhaustive: adding a command kind to
 * the union without a case here is a compile error, not a silent fallthrough.
 */
export function executeCommand(doc: World, command: EditorCommand): CommandOutcome {
  switch (command.kind) {
    case 'place-entity':
      return placeEntity(doc, command)
    case 'move-entity':
      return moveEntity(doc, command)
    case 'rename-entity':
      return renameEntity(doc, command)
    case 'delete-entity':
      return deleteEntity(doc, command)
    case 'rename-world':
      return renameWorld(doc, command)
  }
}
