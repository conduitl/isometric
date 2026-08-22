/**
 * Tile layers — the world's floor, stored as one flat array.
 *
 * A tile layer looks like a grid, but memory has no rows and columns — it is
 * one long shelf of numbered slots. So we store the grid as a single flat
 * array and TRANSLATE between the two views with the formula this file
 * exists to teach:
 *
 *     index = y · width + x
 *
 * Read it out loud: "skip y full rows, then walk x cells into the next one."
 * Every spreadsheet, image, and GPU texture you will ever meet uses this same
 * trick; learn it here and you have learned them all.
 *
 * Two design choices worth noticing:
 *
 * - Cells live in a Uint16Array — the engine's ONE deliberate exception to
 *   "all state is plain JSON" (docs/ARCHITECTURE.md §3). A 256×256 layer is
 *   65,536 cells; as a typed array that is 128 KB sitting in one contiguous
 *   block, cheap to read in a tight loop and cheap to copy for undo. The
 *   world-file code converts it to a plain number array at the file
 *   boundary, so saved worlds stay human-readable JSON.
 * - The layer object itself stays plain, honest data — no methods, no hidden
 *   fields. The render cache still needs to ask "has this layer changed
 *   since I last looked?", so that bookkeeping lives in a WeakMap OFF to the
 *   side (see layerRevision below): metadata about the layer, never inside
 *   it. Serializers and inspectors see exactly the data and nothing else.
 */

import type { TileLayer } from '@engine/core'
import { Vec2 } from '@engine/math'

/**
 * The v1 size cap: no layer dimension may exceed 256 cells.
 *
 * Why 256? The cached fast path sometimes has to redraw a whole layer, and a
 * school Chromebook's frame budget can absorb a 256×256 = 65,536-cell redraw
 * but not much more (docs/RISKS.md, docs/DECISIONS.md R1). A cap with a
 * friendly explanation beats a world that silently turns into a slideshow —
 * and bigger places can always be built out of more layers.
 */
export const MAX_LAYER_SIZE = 256

/** Options for {@link createTileLayer}. Only id, width, height, and tilesetId are required. */
export interface CreateTileLayerOptions {
  id: string
  name?: string
  width: number
  height: number
  elevation?: number
  layerBand?: number
  tilesetId: string
  cells?: ArrayLike<number>
  /** The slab's bottom — see {@link TileLayer.base} (@engine/core) for the
   * full plateau-vs-slab story. Omit it for exactly today's behavior. */
  base?: number
}

/**
 * Build a tile layer: a width×height grid of cell values, all zero (empty)
 * unless `cells` provides initial contents. Cell value N > 0 refers to the
 * tileset's tiles[N − 1]; 0 means "nothing here".
 *
 * Defaults: name = the id, elevation 0, layerBand 0. Values outside the
 * uint16 range 0..65535 wrap silently (that is what the typed array does) —
 * the schema layer above is where out-of-range tile ids get diagnosed.
 *
 * `base` is stored ONLY when the caller provides it — an omitted `base`
 * means the returned layer has no `base` key at all, not a `base: undefined`
 * key, so a layer built exactly as it was before this option existed comes
 * out byte-for-byte the same object shape.
 */
export function createTileLayer(options: CreateTileLayerOptions): TileLayer {
  const { id, width, height } = options

  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(
      `tile layer "${id}": width and height must be whole numbers of at least 1 — got ${width}×${height}`,
    )
  }
  if (width > MAX_LAYER_SIZE || height > MAX_LAYER_SIZE) {
    throw new Error(
      `tile layer "${id}" wants to be ${width}×${height}, but the limit is ` +
        `${MAX_LAYER_SIZE}×${MAX_LAYER_SIZE} per layer. Bigger layers can't be redrawn inside a ` +
        `school Chromebook's frame budget (docs/RISKS.md, docs/DECISIONS.md R1) — ` +
        `build bigger places out of several layers instead.`,
    )
  }

  const cellCount = width * height
  let cells: Uint16Array
  if (options.cells === undefined) {
    cells = new Uint16Array(cellCount)
  } else {
    if (options.cells.length !== cellCount) {
      throw new Error(
        `tile layer "${id}": got ${options.cells.length} cell values, but a ${width}×${height} ` +
          `layer needs exactly ${width}·${height} = ${cellCount} of them`,
      )
    }
    cells = Uint16Array.from(options.cells)
  }

  return {
    id,
    name: options.name ?? id,
    width,
    height,
    elevation: options.elevation ?? 0,
    layerBand: options.layerBand ?? 0,
    tilesetId: options.tilesetId,
    cells,
    ...(options.base === undefined ? {} : { base: options.base }),
  }
}

/**
 * THE taught formula: the flat-array slot of grid cell (x, y) is
 *
 *     index = y · width + x
 *
 * because the cells of row 0 occupy slots 0..width−1, row 1 occupies the
 * next `width` slots, and so on — y whole rows to skip, then x more steps.
 * (The inverse is just as mechanical: x = index % width, y = the whole-number
 * quotient.)
 *
 * Returns −1 for any (x, y) outside the grid — including fractional
 * coordinates, which name a point BETWEEN cells, not a cell. Use
 * {@link worldToTile} first if you are holding world coordinates.
 */
export function cellIndex(layer: TileLayer, x: number, y: number): number {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= layer.width ||
    y >= layer.height
  ) {
    return -1
  }
  return y * layer.width + x
}

/**
 * Read one cell. Out-of-bounds reads answer 0 ("nothing there") instead of
 * throwing: painting tools probe neighbors freely, and the world beyond the
 * layer's edge genuinely is empty. Allocation-free — this runs inside paint
 * strokes and render loops.
 */
export function getCell(layer: TileLayer, x: number, y: number): number {
  const index = cellIndex(layer, x, y)
  if (index === -1) return 0
  return layer.cells[index] ?? 0
}

/**
 * The render cache's private notebook about each layer: how many times it
 * has been written (`revision`) and which cells changed since the cache last
 * looked (`dirty`, as flat indices — a Set so painting the same cell twenty
 * times during a brush stroke records it once).
 *
 * Why a WeakMap instead of fields on the layer? Because TileLayer is plain
 * serializable data by contract — save files, undo, and inspectors all read
 * it — and render bookkeeping has no business appearing in any of those. A
 * WeakMap hangs private metadata OFF an object without touching the object,
 * and forgets the metadata automatically when the layer itself is garbage
 * collected. Perfect fit.
 */
interface LayerBookkeeping {
  revision: number
  dirty: Set<number>
}

const bookkeeping = new WeakMap<TileLayer, LayerBookkeeping>()

/**
 * Write one cell. Returns false (and changes nothing) when (x, y) is outside
 * the grid, true otherwise. Every successful write bumps the layer's
 * revision and records the cell as dirty, which is how the cached renderer
 * knows to repaint exactly that cell instead of all 65,536.
 *
 * This is the paint-stroke hot path — called once per cell per pointer move
 * — so it allocates nothing per call (the bookkeeping record is created once
 * per layer, on the first write ever).
 */
export function setCell(layer: TileLayer, x: number, y: number, value: number): boolean {
  const index = cellIndex(layer, x, y)
  if (index === -1) return false
  layer.cells[index] = value
  let book = bookkeeping.get(layer)
  if (book === undefined) {
    book = { revision: 0, dirty: new Set() }
    bookkeeping.set(layer, book)
  }
  book.revision += 1
  book.dirty.add(index)
  return true
}

/**
 * How many successful writes this layer has ever taken — 0 for a fresh (or
 * never-painted) layer, and strictly increasing with every setCell. A cache
 * that remembers the revision it painted at can answer "am I stale?" with
 * one integer comparison, which is the cheapest possible change detector.
 */
export function layerRevision(layer: TileLayer): number {
  return bookkeeping.get(layer)?.revision ?? 0
}

/**
 * Take (and clear) the list of cells written since the last drain, as flat
 * indices. In-package plumbing for the layer renderer — not part of the
 * package's public surface.
 *
 * Single-consumer by design: the dirty list is a hand-off, not a broadcast.
 * If two renderers ever watch one layer, the second drains an empty list,
 * notices the revision moved anyway, and falls back to a full repaint — a
 * slower frame, never a wrong one.
 */
export function drainDirtyCells(layer: TileLayer): number[] {
  const book = bookkeeping.get(layer)
  if (book === undefined || book.dirty.size === 0) return []
  const cells = Array.from(book.dirty)
  book.dirty.clear()
  return cells
}

/**
 * The world-space CENTER of tile (tx, ty): ((tx + 0.5) · tileSize,
 * (ty + 0.5) · tileSize). The +0.5 is the whole story — tile (0, 0) OWNS the
 * square from 0 to tileSize, so its center sits half a tile in. Entities
 * snapped to tiles stand on centers; that is why they look centered.
 */
export function tileToWorld(settings: { tileSize: number }, tx: number, ty: number): Vec2 {
  return Vec2.make((tx + 0.5) * settings.tileSize, (ty + 0.5) * settings.tileSize)
}

/**
 * Which tile owns world point p: floor(p / tileSize) on each axis.
 *
 * floor — not truncation — and the difference only shows up left of zero:
 * floor always rounds DOWN, truncation rounds toward zero. World x = −0.5
 * (with tileSize 1) lives in tile −1, whose square spans −1..0; truncation
 * would answer 0 and put the point in the wrong tile. `Math.trunc` (and
 * `(x | 0)`, and casting to int in most languages) all make exactly this
 * mistake — a classic off-by-one that only bites on the negative side of
 * the map.
 */
export function worldToTile(settings: { tileSize: number }, p: Vec2): { tx: number; ty: number } {
  return {
    tx: Math.floor(p.x / settings.tileSize),
    ty: Math.floor(p.y / settings.tileSize),
  }
}
