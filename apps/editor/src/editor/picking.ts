/**
 * Picking — the inverse walk, now in the editor's service.
 *
 * Adapted from apps/three-windows/src/picking.ts (the Phase 1 demo), with two
 * deliberate differences: the result shapes ({@link PickedTile},
 * {@link PickResult}) come from the editor's LOCKED contract in ./types
 * instead of being declared here, and one editor-only helper is added at the
 * bottom — {@link pointerToCell}, the enrichment every ToolPointerEvent gets
 * before a tool sees it. The resolve logic itself is the demo's, unchanged:
 * it is already the taught lesson, and the editor dogfooding the exact same
 * walk on every click is the point (docs/ARCHITECTURE.md §6).
 *
 * The lesson, restated: every click starts as two screen numbers, and the
 * world it lands in has three. `Projection.inverse` teaches the way out —
 * pin ONE world quantity (the constraint) and the other two fall out of
 * linear algebra. This module applies that twice over:
 *
 * - **Entities**: for each candidate we pin the number the view cannot see
 *   with the ENTITY'S OWN value — its elevation in top-down and iso, its
 *   lane (y) in profile — then ask "how far is the click from you in the
 *   numbers this view really shows?" A candidate within a small world-unit
 *   radius wins; nearest wins among several. Pinning per candidate is what
 *   makes an elevated crate clickable in iso: its screen spot only maps
 *   back to its world spot on ITS OWN z-plane.
 * - **Tiles**: candidate elevations are probed top-down (the stacked-storey
 *   policy of docs/ARCHITECTURE.md §4) — "if the click landed on THIS
 *   layer's height, which cell is that, and is something there?" The first
 *   occupied answer wins. The probe reads TOP FACES only: a click on an iso
 *   WALL pixel matches no storey's top face, so it falls through to the
 *   cell (or ground) hidden beneath the plateau — a known v1 simplification,
 *   recorded as a decision (docs/DECISIONS.md, deferred table: "Iso
 *   wall-face picking"). If nothing claims the click, it falls through to
 *   the honest default every placement tool uses: the ground-plane landing
 *   cell.
 *
 * Profile is the odd window out, on purpose: its ground matrix is
 * rank-deficient (north collapses to nothing), so its 'ground' constraint
 * means "the front lane, y = 0" and the screen's second axis reports
 * ELEVATION instead. Tile picking there reads the click's height against
 * each layer's slab, and the cell shown is the southernmost occupied cell of
 * the column — the same cell whose color the profile renderer put on screen.
 */

import type { Entity, EntityId, TileLayer, World } from '@engine/core'
import { entityIds } from '@engine/core'
import { Vec2 } from '@engine/math'
import type { TransformStack, WorldPoint } from '@engine/projection'
import { getCell, PROFILE_SLAB_HEIGHT, worldToTile } from '@engine/tilemap'
import type { PickedTile, PickResult } from './types'

/**
 * How close (in world units, measured only along the axes the view actually
 * determines) a click must land to count as touching an entity. Half a tile:
 * generous enough for a trackpad, tight enough that neighboring crates stay
 * individually clickable.
 */
export const PICK_RADIUS = 0.5

/**
 * Read an entity's place in the world from its components: `position` gives
 * ground coordinates, `elevation` gives z (missing means 0 — standing on the
 * ground is the default state of things). Components are opaque blobs at the
 * file boundary, so every field is checked before it is believed; an entity
 * with no readable position simply is not in the world's geometry and
 * returns null.
 */
export function entityWorldPoint(entity: Entity): WorldPoint | null {
  const position = entity.components['position']
  if (position === null || typeof position !== 'object') return null
  const { x, y } = position as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number') return null

  let z = 0
  const elevation = entity.components['elevation']
  if (elevation !== null && typeof elevation === 'object') {
    const raw = (elevation as { z?: unknown }).z
    if (typeof raw === 'number') z = raw
  }
  return { x, y, z }
}

/** The `marker.kind` tag ("player", "crate", "tree"…), or null if the entity has none. */
export function markerKind(entity: Entity): string | null {
  const marker = entity.components['marker']
  if (marker === null || typeof marker !== 'object') return null
  const kind = (marker as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : null
}

/** Cell equality for hover bookkeeping: same layer, same cell, same storey. */
export function sameTile(a: PickedTile | null, b: PickedTile | null): boolean {
  if (a === null || b === null) return a === b
  return a.layerId === b.layerId && a.tx === b.tx && a.ty === b.ty && a.elevation === b.elevation
}

/**
 * The entity pass. Walks entities in THE deterministic order (entityIds),
 * un-projects the click onto each candidate's own pinned plane/lane, and
 * keeps the nearest hit within PICK_RADIUS. Distance is full 3D Euclidean —
 * but because the constraint already forced one coordinate to match the
 * candidate exactly, it measures only the two axes the view truly shows
 * (x/y in top-down and iso, x/z in profile). Ties keep the earliest id:
 * strict `<` plus a sorted walk means two exactly-overlapping entities
 * always resolve the same way.
 */
function resolveEntity(world: World, stack: TransformStack, screen: Vec2): PickResult | null {
  let bestId: EntityId | null = null
  let bestPoint: WorldPoint | null = null
  let bestDistance = Infinity

  for (const id of entityIds(world)) {
    const entity = world.entities[id]
    if (entity === undefined) continue
    const point = entityWorldPoint(entity)
    if (point === null) continue

    // Pin the number this view destroyed with the candidate's own value.
    const constraint =
      stack.projection.name === 'profile'
        ? ({ kind: 'lane', y: point.y } as const)
        : ({ kind: 'elevation', z: point.z } as const)
    const clicked = stack.screenToWorld(screen, constraint)
    if (clicked === null) continue

    const dx = clicked.x - point.x
    const dy = clicked.y - point.y
    const dz = clicked.z - point.z
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (distance <= PICK_RADIUS && distance < bestDistance) {
      bestId = id
      bestPoint = point
      bestDistance = distance
    }
  }

  return bestId === null || bestPoint === null ? null : { kind: 'entity', id: bestId, point: bestPoint }
}

/** Layers in probing order: highest storey first, so upper floors claim clicks before the ground under them. */
function layersTopDown(world: World): TileLayer[] {
  return world.layers.slice().sort((a, b) => b.elevation - a.elevation)
}

/** The southernmost occupied cell of a column — smallest ty, nearest the
 * profile camera — i.e. exactly the cell whose color that column's slab shows. */
function frontCellInColumn(layer: TileLayer, tx: number): number | null {
  for (let ty = 0; ty < layer.height; ty += 1) {
    if (getCell(layer, tx, ty) > 0) return ty
  }
  return null
}

/**
 * The tile pass — also the hover ghost's "where will my click land?" answer
 * (docs/ARCHITECTURE.md §4: the landing cell is always visible before you
 * commit). Probes occupied storeys top-down, then falls back to the
 * ground-plane landing cell, which is reported even when empty (and even
 * past the map's edge): the honest answer to "where would this click land?"
 * is a place, not a shrug. Returns null only if the camera itself cannot be
 * inverted.
 */
export function resolveTile(world: World, stack: TransformStack, screen: Vec2): PickedTile | null {
  const settings = world.settings

  if (stack.projection.name === 'profile') {
    // One inverse gives everything profile knows: x across, z up, y pinned
    // to the front lane. The click's HEIGHT chooses the layer — whichever
    // slab band it falls inside — and the column's front cell is the pick.
    const clicked = stack.screenToWorld(screen, { kind: 'ground' })
    if (clicked === null) return null
    const tx = worldToTile(settings, Vec2.make(clicked.x, 0)).tx
    for (const layer of layersTopDown(world)) {
      if (clicked.z < layer.elevation || clicked.z > layer.elevation + PROFILE_SLAB_HEIGHT) continue
      const ty = frontCellInColumn(layer, tx)
      if (ty !== null) return { layerId: layer.id, tx, ty, elevation: layer.elevation }
    }
  } else {
    // Storey probing: "if this click landed at YOUR height, which cell is
    // that?" — the same click asks each layer a different cell, because the
    // inverse slides along the elevation vector as z changes. An occupied
    // answer wins. Honesty note: this probes TOP faces only — a click on an
    // iso WALL pixel matches no storey's top face and falls through to the
    // cell/ground hidden beneath the plateau (docs/DECISIONS.md, deferred
    // table: "Iso wall-face picking").
    for (const layer of layersTopDown(world)) {
      const clicked = stack.screenToWorld(
        screen,
        layer.elevation === 0 ? { kind: 'ground' } : { kind: 'elevation', z: layer.elevation },
      )
      if (clicked === null) continue
      const cell = worldToTile(settings, Vec2.make(clicked.x, clicked.y))
      if (getCell(layer, cell.tx, cell.ty) > 0) {
        return { layerId: layer.id, tx: cell.tx, ty: cell.ty, elevation: layer.elevation }
      }
    }
  }

  // Nothing claimed the click: the ground-plane landing cell. (In profile
  // the ground constraint pins the front lane, so this is the front row.)
  const ground = stack.screenToWorld(screen, { kind: 'ground' })
  if (ground === null) return null
  const cell = worldToTile(settings, Vec2.make(ground.x, ground.y))
  const base = world.layers.find((layer) => layer.elevation === 0) ?? null
  const occupied = base !== null && getCell(base, cell.tx, cell.ty) > 0
  return { layerId: occupied ? base.id : null, tx: cell.tx, ty: cell.ty, elevation: 0 }
}

/**
 * The full pick: entities first (they sit on top of the terrain, so they get
 * first claim on a click), then the tile pass. This is what a click in the
 * viewport runs, and what the select tool's answer is made of.
 */
export function resolvePick(world: World, stack: TransformStack, screen: Vec2): PickResult | null {
  const entityHit = resolveEntity(world, stack, screen)
  if (entityHit !== null) return entityHit
  const tile = resolveTile(world, stack, screen)
  return tile === null ? null : { kind: 'tile', tile }
}

/**
 * The ToolPointerEvent enrichment (editor-only; not in the demo): translate
 * one screen point into the world/tile pair every tool thinks in, pinned to
 * the ACTIVE layer's storey.
 *
 * Why the active layer, not a full resolvePick? Because a tool asking "where
 * is the pointer?" wants the answer on the storey it is EDITING — a brush
 * painting the ground floor must not slide onto a plateau just because the
 * cursor crossed its picture. So the constraint pins the active layer's
 * elevation (top-down and iso), or — for profile, whose screen already shows
 * z and cannot see y — the honest 'ground' constraint that pins the front
 * lane and lets the click's height speak for itself.
 *
 * `tile` is the landing cell by the taught floor-division walk
 * (worldToTile), or null when the pointer is outside the active layer's
 * bounds (or there is no active layer to be inside): out-of-bounds paints
 * are refusals, and the refusal starts here, honestly, not deep in a tool.
 */
export function pointerToCell(
  doc: World,
  stack: TransformStack,
  screen: Vec2,
  activeLayer: TileLayer | null,
): { world: WorldPoint | null; tile: { tx: number; ty: number } | null } {
  const constraint =
    stack.projection.name === 'profile'
      ? ({ kind: 'ground' } as const)
      : ({ kind: 'elevation', z: activeLayer?.elevation ?? 0 } as const)
  const world = stack.screenToWorld(screen, constraint)
  if (world === null || activeLayer === null) return { world, tile: null }

  const cell = worldToTile(doc.settings, Vec2.make(world.x, world.y))
  const inside =
    cell.tx >= 0 && cell.ty >= 0 && cell.tx < activeLayer.width && cell.ty < activeLayer.height
  return { world, tile: inside ? cell : null }
}
