/*
 * One world, one exact text.
 *
 * serializeWorld is CANONICAL: the same world always becomes the same bytes,
 * down to the last space. That sounds fussy, but three real features stand
 * on it:
 *
 * - The atomic save (slots.ts) proves a save landed safely by re-reading and
 *   re-parsing what the storage actually kept. That proof only means
 *   something if serialization has no moods.
 * - `serialize ∘ parse ∘ serialize` being byte-identical is a standing CI
 *   property (docs/ARCHITECTURE.md §11) — the cheapest possible detector for
 *   "the loader quietly dropped something".
 * - Kids keep worlds in git and diff them (the glass box encourages reading
 *   your own files). A canonical writer means a one-tile edit is a one-line
 *   diff, not a reshuffled file.
 *
 * The canonical rules, all visible in the output:
 *
 * - Top-level field order is FIXED: formatVersion, meta, settings,
 *   nextEntityId, tilesets, layers, entities. Version first, so even a
 *   half-transferred file announces what it is.
 * - Entities are an ARRAY in the file, sorted by the number in their id —
 *   "e2" before "e10", which alphabetical sorting would get wrong. In memory
 *   the world keys entities by id (a record) so undo patches stay id-stable;
 *   the array is purely a file-format shape. Both facts are deliberate
 *   red-team decisions (docs/ARCHITECTURE.md §3, §6).
 * - A component's fields round-trip verbatim — unknown components are opaque
 *   blobs — but the component NAMES within an entity are written sorted, so
 *   insertion history never leaks into the bytes.
 * - Arrays of plain numbers print on one line. A layer's cells are a map;
 *   `[3, 3, 3, 2, 1, 2]` reads like terrain, one number per tile, while one
 *   number per LINE would turn a 6×5 layer into 30 lines of noise.
 * - Negative zero prints as plain 0 — the format does not keep −0 and 0
 *   apart (see printNumber for why that is a contract, not an accident).
 * - 2-space indent everywhere else, because humans read these files.
 */

import { compareEntityIds } from '@engine/core'
import type { Entity, TileDef, TileLayer, Tileset, World } from '@engine/core'
import { FORMAT_VERSION } from './schema'

/**
 * The number inside an entity id: "e12" → 12. Returns NaN for ids that don't
 * match the `e<number>` policy — serializeWorld refuses to write such ids,
 * and the schema refuses to read them, so a NaN here never reaches a file.
 */
export function entityIdNumber(id: string): number {
  return /^e[0-9]+$/.test(id) ? Number(id.slice(1)) : Number.NaN
}

/**
 * Writes a world as canonical version-1 JSON text (see the file header for
 * the exact rules). The in-memory Uint16Array cells become plain number
 * arrays — the file stays 100% ordinary JSON that any tool can read.
 *
 * Throws if any entity id breaks the `e<number>` policy: a world holding
 * such an id would serialize into bytes the loader REJECTS, and that error
 * would surface later, at load time, blamed on the wrong step. Refusing at
 * the door, with the id named, keeps the diagnosis honest.
 */
export function serializeWorld(world: World): string {
  for (const entity of Object.values(world.entities)) {
    if (Number.isNaN(entityIdNumber(entity.id))) {
      throw new Error(
        `entity id "${entity.id}" doesn't follow the id policy — ids are the letter "e" ` +
          'followed by a number, like "e12". A file holding this id would be refused on ' +
          'loading, so it is refused here, before anything is written.',
      )
    }
  }

  // File order and memory order share ONE comparator by construction —
  // @engine/core's compareEntityIds, the same function behind entityIds().
  const entities = Object.values(world.entities)
    .slice()
    .sort((a, b) => compareEntityIds(a.id, b.id))
    .map(entityToDoc)

  const doc = {
    formatVersion: FORMAT_VERSION,
    meta: {
      worldId: world.meta.worldId,
      name: world.meta.name,
    },
    settings: {
      tileSize: world.settings.tileSize,
      primaryProjection: world.settings.primaryProjection,
      fixedDt: world.settings.fixedDt,
      seed: world.settings.seed,
    },
    nextEntityId: world.nextEntityId,
    tilesets: world.tilesets.map(tilesetToDoc),
    layers: world.layers.map(layerToDoc),
    entities,
  }

  return `${printValue(doc, '') ?? '{}'}\n`
}

// --- world pieces -> plain documents, each field placed deliberately -------

function entityToDoc(entity: Entity): Record<string, unknown> {
  // Component names sorted; component VALUES untouched. The values may
  // belong to components this app has never heard of, and their bytes are
  // not ours to rearrange (the opaque-blob promise, docs/DECISIONS.md D1).
  const components: Record<string, unknown> = {}
  for (const name of Object.keys(entity.components).sort()) {
    components[name] = entity.components[name]
  }
  return { id: entity.id, name: entity.name, components }
}

function layerToDoc(layer: TileLayer): Record<string, unknown> {
  return {
    id: layer.id,
    name: layer.name,
    width: layer.width,
    height: layer.height,
    elevation: layer.elevation,
    layerBand: layer.layerBand,
    tilesetId: layer.tilesetId,
    cells: Array.from(layer.cells),
  }
}

function tilesetToDoc(tileset: Tileset): Record<string, unknown> {
  return { id: tileset.id, name: tileset.name, tiles: tileset.tiles.map(tileToDoc) }
}

function tileToDoc(tile: TileDef): Record<string, unknown> {
  // Optional face colors are written only when present, always in the same
  // top/left/right/side order — absent and undefined look identical in the file.
  const colors: Record<string, string> = { top: tile.colors.top }
  if (tile.colors.left !== undefined) colors.left = tile.colors.left
  if (tile.colors.right !== undefined) colors.right = tile.colors.right
  if (tile.colors.side !== undefined) colors.side = tile.colors.side
  return { name: tile.name, colors }
}

// --- the canonical printer -------------------------------------------------

const INDENT = '  '

/**
 * Prints one number — the ONLY place a number becomes file text, shared by
 * printValue and printArray's one-line fast path so the two can never drift.
 * Two rules, and both are contracts of the format:
 *
 * - Non-finite numbers (NaN, ±Infinity) become null. JSON has no spelling
 *   for them; this matches JSON.stringify, so component blobs behave the
 *   way their owners expect.
 * - Negative zero becomes "0". The file format does NOT promise to keep −0
 *   and 0 apart: JSON.stringify already prints both as "0", and testkit's
 *   stableStringify (the replay-hash foundation) treats them as one value.
 *   A component leaning on that distinction is leaning on something the
 *   format never offered — normalizing on the very first save makes the
 *   mistake impossible to depend on by accident.
 */
function printNumber(value: number): string {
  if (!Number.isFinite(value)) return 'null'
  return Object.is(value, -0) ? '0' : JSON.stringify(value)
}

/**
 * Prints one JSON value. Follows JSON.stringify's semantics exactly (skip
 * undefined object entries, null out non-finite numbers, print −0 as 0 —
 * see printNumber) so component blobs behave the way their owners expect —
 * the only difference is layout: number-only arrays stay on one line,
 * everything else gets 2-space indents. Returns undefined for values JSON
 * has no spelling for (functions, symbols).
 */
function printValue(value: unknown, indent: string): string | undefined {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return printNumber(value)
  if (typeof value !== 'object') return undefined
  if (Array.isArray(value)) return printArray(value, indent)
  return printObject(value as Record<string, unknown>, indent)
}

function printArray(items: ReadonlyArray<unknown>, indent: string): string {
  if (items.length === 0) return '[]'
  const numbers = items.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
  if (numbers.length === items.length) {
    return `[${numbers.map(printNumber).join(', ')}]`
  }
  const inner = indent + INDENT
  const lines = items.map((item) => inner + (printValue(item, inner) ?? 'null'))
  return `[\n${lines.join(',\n')}\n${indent}]`
}

function printObject(record: Record<string, unknown>, indent: string): string {
  const inner = indent + INDENT
  const lines: string[] = []
  for (const key of Object.keys(record)) {
    const printed = printValue(record[key], inner)
    if (printed === undefined) continue
    lines.push(`${inner}${JSON.stringify(key)}: ${printed}`)
  }
  if (lines.length === 0) return '{}'
  return `{\n${lines.join(',\n')}\n${indent}}`
}
