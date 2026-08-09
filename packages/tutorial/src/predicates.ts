/*
 * Step predicates — the two honest ways a lesson can ask "is the student
 * done?", and the small interpreter that answers.
 *
 * The schema (types.ts) allows exactly two families of completion predicate,
 * and this file keeps them apart on purpose:
 *
 * - WORLD predicates are facts about the document — "cell (3,4) holds
 *   water", "a crate exists", "player and chest stand 5 apart". A fact can
 *   be checked at any moment by LOOKING, which is what makes tutorial
 *   resume work: reload the page, hand {@link evaluateWorldPredicate} the
 *   same document, get the same answers.
 * - EVENT predicates are moments — "the student painted", "the world was
 *   saved". A moment cannot be recovered by inspecting the document after
 *   the fact (the same doc could have arrived a hundred different ways), so
 *   these are matched against a live BuilderEvent as it happens, by
 *   {@link matchEventPredicate}, and never by doc inspection.
 *
 * The two functions have different signatures because the difference IS the
 * doctrine: one takes a World, the other takes an event. A predicate handed
 * to the wrong interpreter does not throw — an event predicate is simply
 * never satisfied by looking at a document — but the step machine
 * (machine.ts) routes each family down its own channel.
 *
 * ## Compositions ride with the world family — conditionally
 *
 * `all`/`any` compose leaves. A composition counts as a WORLD predicate
 * only when EVERY leaf is one ({@link isWorldPredicate} checks
 * recursively). Mix one event leaf in and the tree stops being answerable
 * by inspection alone — and it is not matchable against a single event
 * either (the world leaves would dangle). Such a tree is neither family:
 * both narrowing helpers say false, validateLessons refuses to ship it,
 * and if one reaches this evaluator anyway the event leaf simply counts as
 * unsatisfied (an `any` may still succeed through a world leaf; an `all`
 * never can).
 *
 * ## Why cells are read here by hand, not via @engine/tilemap
 *
 * `tile-at` indexes a layer's cells directly: `cells[ty * width + tx]`.
 * That is the exact row-major formula @engine/tilemap teaches — index =
 * y·width + x: walk `ty` complete rows, then `tx` cells along the row.
 * Reading it inline instead of importing getCell is a deliberate
 * dependency-diet choice: @engine/tutorial depends only on @engine/core,
 * so lesson data and its evaluator stay loadable anywhere (the CI replay
 * corpus, the docs site) without dragging in painting machinery. Same
 * formula, one less edge in the dependency graph.
 *
 * ## Components are believed only after checking
 *
 * Entity components are opaque blobs at the file boundary — a hand-edited
 * world file can put anything under `position` or `marker`. Every read
 * here checks shape before believing it, exactly like the editor's picking
 * does: an entity with an unreadable position simply is not in the world's
 * geometry, and a malformed marker is no marker at all.
 */

import type { Entity, World } from '@engine/core'
import { entityIds } from '@engine/core'
import type { BuilderEvent } from './events'
import { resolveBuilderEventType } from './events'
import type { StepPredicate } from './types'

/** The event-family member of {@link StepPredicate}: "a moment occurred". */
export type EventPredicate = Extract<StepPredicate, { kind: 'event' }>

/** Every non-event member of {@link StepPredicate}. NOTE: the TYPE admits
 * compositions with event leaves, but {@link isWorldPredicate} (the runtime
 * judge) rejects them — a composition is only "world" when every leaf is. */
export type WorldPredicate = Exclude<StepPredicate, EventPredicate>

/** Is this predicate an event predicate — satisfiable only by a live
 * builder event? Compositions are never event predicates, even when they
 * contain event leaves (they cannot be matched against ONE event). */
export function isEventPredicate(predicate: StepPredicate): predicate is EventPredicate {
  return predicate.kind === 'event'
}

/**
 * Is this predicate answerable by inspecting the document alone? True for
 * every world-fact leaf, and for `all`/`any` compositions whose EVERY leaf
 * is (checked recursively). A composition containing an event leaf is
 * neither a world predicate nor an event predicate — validateLessons
 * forbids authoring one; the step machine treats it as never completing.
 */
export function isWorldPredicate(predicate: StepPredicate): predicate is WorldPredicate {
  if (predicate.kind === 'event') return false
  if (predicate.kind === 'all' || predicate.kind === 'any') {
    return predicate.of.every(isWorldPredicate)
  }
  return true
}

/** Read an entity's ground-plane position, believing nothing: `position`
 * must be an object with numeric `x` and `y`, else the entity has no place
 * in the world's geometry (mirrors the editor's picking). Elevation is
 * deliberately ignored — every predicate here measures the ground plane. */
function groundPositionOf(entity: Entity): { x: number; y: number } | null {
  const position = entity.components['position']
  if (position === null || typeof position !== 'object') return null
  const { x, y } = position as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number') return null
  return { x, y }
}

/** The `marker.kind` tag ("player", "crate"…), or null when the entity has
 * no readable marker. */
function markerKindOf(entity: Entity): string | null {
  const marker = entity.components['marker']
  if (marker === null || typeof marker !== 'object') return null
  const kind = (marker as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : null
}

/** First entity bearing this marker kind, in THE deterministic entityIds
 * order — "first" must mean the same entity on every run and every reload. */
function firstWithMarker(doc: World, marker: string): Entity | null {
  for (const id of entityIds(doc)) {
    const entity = doc.entities[id]
    if (entity !== undefined && markerKindOf(entity) === marker) return entity
  }
  return null
}

/**
 * Answer a WORLD predicate by looking at the document. Event predicates
 * (and event leaves inside compositions) are never satisfied here — they
 * need a moment, not a snapshot; see {@link matchEventPredicate}.
 *
 * Notable readings:
 * - `tile-at` reads the named layer (default: the FIRST layer), bounds-
 *   checks, then indexes `cells[ty * width + tx]` — the taught row-major
 *   formula. `tile` omitted means "any non-empty cell"; an explicit
 *   `tile: 0` asks "is this cell empty?" (0 is the erased value).
 * - `entity-distance` measures between the FIRST entity of each marker (in
 *   entityIds order), ground-plane Euclidean via Math.hypot, and is false
 *   when either marker is missing or placeless — a missing endpoint must
 *   never read as "distance achieved".
 * - Empty `all` is TRUE (every member of an empty list passes — vacuous
 *   truth, the mathematician's convention); empty `any` is FALSE (there is
 *   no member to succeed). Validation flags both as author mistakes.
 */
export function evaluateWorldPredicate(doc: World, predicate: StepPredicate): boolean {
  switch (predicate.kind) {
    case 'event':
      // A moment, not a fact — unanswerable from a snapshot, so: unsatisfied.
      return false

    case 'tile-at': {
      const layer =
        predicate.layerId === undefined
          ? doc.layers[0]
          : doc.layers.find((candidate) => candidate.id === predicate.layerId)
      if (layer === undefined) return false
      const { tx, ty } = predicate
      if (!Number.isInteger(tx) || !Number.isInteger(ty)) return false
      if (tx < 0 || tx >= layer.width || ty < 0 || ty >= layer.height) return false
      const value = layer.cells[ty * layer.width + tx] ?? 0
      return predicate.tile === undefined ? value !== 0 : value === predicate.tile
    }

    case 'entity-exists': {
      const needed = predicate.atLeast ?? 1
      let count = 0
      for (const id of entityIds(doc)) {
        const entity = doc.entities[id]
        if (entity !== undefined && markerKindOf(entity) === predicate.marker) {
          count += 1
          if (count >= needed) return true
        }
      }
      return count >= needed
    }

    case 'entity-at': {
      for (const id of entityIds(doc)) {
        const entity = doc.entities[id]
        if (entity === undefined || markerKindOf(entity) !== predicate.marker) continue
        const position = groundPositionOf(entity)
        if (position === null) continue
        if (Math.floor(position.x) === predicate.tx && Math.floor(position.y) === predicate.ty) return true
      }
      return false
    }

    case 'entity-distance': {
      const a = firstWithMarker(doc, predicate.markerA)
      const b = firstWithMarker(doc, predicate.markerB)
      if (a === null || b === null) return false
      const pa = groundPositionOf(a)
      const pb = groundPositionOf(b)
      if (pa === null || pb === null) return false
      const measured = Math.hypot(pb.x - pa.x, pb.y - pa.y)
      const tolerance = predicate.tolerance ?? 0.05
      return Math.abs(measured - predicate.distance) <= tolerance
    }

    case 'all':
      return predicate.of.every((child) => evaluateWorldPredicate(doc, child))

    case 'any':
      return predicate.of.some((child) => evaluateWorldPredicate(doc, child))

    default: {
      // Lesson data arrives as JSON; an unknown kind evaluates to
      // "unsatisfied" instead of crashing mid-lesson (validateLessons
      // reports it to the author). The never-assignment keeps this arm
      // honest: add a predicate kind to the schema and this line refuses
      // to compile until the evaluator learns it.
      const unhandled: never = predicate
      void unhandled
      return false
    }
  }
}

/**
 * Match an EVENT predicate against one live builder event. The predicate's
 * `type` resolves through the permanent alias table first (D4: superseded
 * names keep working forever), then `where` fields — if any — must each be
 * STRICTLY equal on the event payload's top level. Strict means strict:
 * `{ tile: 2 }` does not match a painted tile "2"-the-string, and a field
 * the event does not carry matches nothing. An absent `where` matches any
 * event of the type.
 *
 * `toCell` — legal only on builder.entity-moved (validateLessons enforces
 * it; this matcher fails safe for any other event) — names the DESTINATION
 * cell: the move matches when the event's `to` position FLOORS to
 * (tx, ty), the same floor-toward-negative-infinity convention entity-at
 * uses ((-0.5, 2) stands on cell (-1, 2)). It ANDs with `where`: every
 * named field must hit AND the drop must land in the cell.
 */
export function matchEventPredicate(event: BuilderEvent, predicate: EventPredicate): boolean {
  const resolved = resolveBuilderEventType(predicate.type)
  if (resolved === null || event.type !== resolved) return false
  if (predicate.toCell !== undefined) {
    // Only a move HAS a destination. Any other event carrying this
    // predicate never matches — the honest reading of a clause that asks
    // "did it land HERE" about an event that lands nowhere.
    if (event.type !== 'builder.entity-moved') return false
    if (Math.floor(event.to.x) !== predicate.toCell.tx) return false
    if (Math.floor(event.to.y) !== predicate.toCell.ty) return false
  }
  if (predicate.where === undefined) return true
  const payload = event as unknown as Record<string, unknown>
  for (const [field, expected] of Object.entries(predicate.where)) {
    if (payload[field] !== expected) return false
  }
  return true
}
