/**
 * The figurine pipeline — a WORLD flattened into a portable miniature.
 *
 * A character can be AUTHORED as a world (the bear figure, fixtures.ts: ten
 * stacked tile layers, one per z-slice) and then CONVERTED into a figurine —
 * a small, self-contained, JSON-serializable description of the same shape
 * that an entity can carry as a component and the renderer can draw scaled
 * into a single cell. The conversion is the whole idea: nothing downstream
 * (an entity's `figurine` component, a save file, the renderer) ever needs a
 * tileset or a tile layer again — every color a voxel needs was already
 * resolved to a hex triple at conversion time, so a figurine never depends on
 * a tileset existing where it lands.
 *
 * ## The shape
 *
 * `slices` is the figure read bottom to top, one entry per source tile layer
 * (in the world's own layer order): `top`/`base` are that slice's elevation
 * span (straight off {@link TileLayer.elevation} and `.base` — a plateau's
 * `base` defaults to 0, exactly as the renderer already reads it), and `rows`
 * is the slice's own picture, TOP-ROW-FIRST screen ASCII — the same
 * orientation and flip convention `fixtures.ts`'s `decodeCharRows` uses, so a
 * figurine's rows read on the page exactly like the art they were cut from.
 *
 * `palette` is one flat array of resolved `{top, left, right}` hex triples —
 * a voxel's row CHARACTER indexes into it (see {@link figurineCellAt}), off
 * by one exactly like a `Tileset`'s own cell values (0 stays reserved for
 * "empty", spelled `.` in a row). Colors are resolved from the SOURCE
 * tileset(s) at conversion, not looked up again at draw time — a wall that
 * had no explicit `left`/`right` gets the tilemap's own north-west-lit shade
 * (the same SOUTH_WALL_SHADE / EAST_WALL_SHADE factors @engine/tilemap's iso
 * walls use, copied here rather than imported: apps may depend on packages,
 * and a private renderer constant is not a published seam to reach across).
 *
 * ## Why a generic character alphabet, not the source art's own letters
 *
 * `fixtures.ts` hand-picks mnemonic letters (`B` for bear brown, `Y` for
 * chick yellow) because a human is choosing them to make the SOURCE readable.
 * A converter has no such context — it only knows palette POSITIONS — so
 * {@link FIGURINE_CHARS} is one fixed, arbitrary, order-stable alphabet
 * (digits then letters) used for every figurine ever converted. The result
 * is still self-documenting in the sense that matters for a saved file: a
 * grid of characters you can look at and count, not a base64 blob.
 */

import type { Entity, TileLayer, Tileset, World } from '@engine/core'
import { EAST_WALL_SHADE, getCell, shadeHex, SOUTH_WALL_SHADE } from '@engine/tilemap'
import { createBearFigure } from './fixtures'

/**
 * The footprint cap, per side. 32×32 keeps a figurine's row strings short
 * enough to stay readable in a saved file and its per-frame quad count small
 * enough that drawing several of them stays a rendering non-event — a world
 * bigger than this is refused outright rather than silently truncated (a
 * truncated character would be a different, unnoticed character).
 */
export const MAX_FIGURINE_SIZE = 32

/** '.' is empty (cell value 0, the world format's own convention); every
 * other character is a 1-based index into {@link Figurine.palette} — digits
 * first, then lowercase, then uppercase, 61 slots deep. See the file header
 * for why the alphabet is generic rather than mnemonic. */
const FIGURINE_CHARS = '123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

// Wall shading comes straight from @engine/tilemap's exported convention
// (SOUTH_WALL_SHADE / EAST_WALL_SHADE / shadeHex, imported above): a
// figurine's unlit walls must match the walls of a world built from the very
// same tileset, and importing the one convention is what makes that survive
// a lighting retune.

/** One resolved voxel color triple — the figurine's own tiny tileset entry,
 * carrying no reference back to any source `Tileset`. */
export interface FigurinePaletteEntry {
  readonly top: string
  readonly left: string
  readonly right: string
}

/** One z-slice of a figurine: its elevation span, plus its picture as
 * top-row-first screen ASCII (see the file header for the convention). */
export interface FigurineSlice {
  readonly top: number
  readonly base: number
  readonly rows: readonly string[]
}

/**
 * A whole miniature: plain, JSON-serializable data (`size`, `slices`,
 * `palette`) with nothing in it a save file cannot round-trip and nothing in
 * it that reaches back into the world it was cut from.
 */
export interface Figurine {
  /** The footprint, cells per side — every slice is `size` × `size`. */
  readonly size: number
  /** Bottom to top, in the source world's own layer order. */
  readonly slices: readonly FigurineSlice[]
  readonly palette: readonly FigurinePaletteEntry[]
}

/** encode: combined palette index (0-based) → row character. Throws rather
 * than truncate — see {@link MAX_FIGURINE_SIZE}'s doc comment for why a
 * silently-wrong character is worse than a loud refusal. */
function charForIndex(index: number): string {
  const ch = FIGURINE_CHARS[index]
  if (ch === undefined) {
    throw new Error(
      `figurineFromWorld: this figure needs more than ${FIGURINE_CHARS.length} distinct tile colors — ` +
        'the figurine character alphabet has run out',
    )
  }
  return ch
}

/** decode: row character → combined palette index, 1-based (0 = empty),
 * exactly the world format's own cell-value convention. */
function valueForChar(ch: string): number {
  if (ch === '.') return 0
  const index = FIGURINE_CHARS.indexOf(ch)
  if (index === -1) {
    throw new Error(`figurine: unknown character '${ch}' in a slice row`)
  }
  return index + 1
}

/**
 * The voxel value at engine-space (vx, vy) within one slice: 0 (empty) or a
 * 1-based index into the figurine's `palette`. Applies the SAME screen-row
 * flip `fixtures.ts`'s `decodeCharRows` documents (row 0 is the TOP of the
 * picture, so engine row `vy` lives at string index `size − 1 − vy`) — the
 * one thing every reader of a figurine's rows must get right, so it lives in
 * exactly one function. Off the slice's own footprint (vx or vy outside
 * `[0, size)`) reads as empty, the same "off the map is empty" convention
 * `@engine/tilemap`'s `getCell` uses — which is what lets the renderer's
 * hidden-face culling treat a figurine's own edges as honestly exposed.
 */
export function figurineCellAt(slice: FigurineSlice, size: number, vx: number, vy: number): number {
  if (vx < 0 || vx >= size || vy < 0 || vy >= size) return 0
  const row = slice.rows[size - 1 - vy]
  if (row === undefined) return 0
  const ch = row[vx]
  return ch === undefined ? 0 : valueForChar(ch)
}

/** Options for {@link figurineFromWorld}. */
export interface FigurineFromWorldOptions {
  /** Tile-layer ids to leave out of the conversion — a decorative floor
   * beneath a voxel figure, say, that should not become part of the
   * miniature it stands on. */
  readonly exclude?: readonly string[]
}

/**
 * Convert a WORLD into a {@link Figurine}: walk its tile layers (skipping
 * any id named in `opts.exclude`), turn each into one slice, and resolve
 * every color the slices reference into one flat, deduplicated palette.
 *
 * Returns `null` for a world left with no tile layers after exclusion —
 * there is no shape to carry. Every included layer must share one SQUARE
 * footprint (a figurine has one `size`, not one per slice) and that
 * footprint must not exceed {@link MAX_FIGURINE_SIZE}; both are refused
 * loudly rather than silently reshaped, because a silently cropped or
 * stretched figure is a wrong figure nobody asked for.
 *
 * Deterministic and pure: no randomness, no mutation of `world`, and the
 * SAME world always converts to byte-identical output — the fact
 * {@link PIP_FIGURINE} below leans on to build itself once, at module load.
 */
export function figurineFromWorld(world: World, opts: FigurineFromWorldOptions = {}): Figurine | null {
  const exclude = new Set(opts.exclude ?? [])
  const layers = world.layers.filter((layer) => !exclude.has(layer.id))
  const first = layers[0]
  if (first === undefined) return null

  if (first.width !== first.height) {
    throw new Error(
      `figurineFromWorld: layer '${first.id}' is ${first.width}×${first.height} — a figurine's footprint must be square`,
    )
  }
  const size = first.width
  if (size > MAX_FIGURINE_SIZE) {
    throw new Error(`figurineFromWorld: a ${size}×${size} footprint exceeds the ${MAX_FIGURINE_SIZE}-cell cap`)
  }
  for (const layer of layers) {
    if (layer.width !== size || layer.height !== size) {
      throw new Error(
        `figurineFromWorld: layer '${layer.id}' is ${layer.width}×${layer.height}, not ${size}×${size} like ` +
          `'${first.id}' — every slice of one figurine must share its footprint`,
      )
    }
  }

  // One combined palette across every tileset the included layers touch,
  // built lazily in first-seen order. Most figurines (Pip included) draw
  // every slice from ONE shared tileset, in which case this simply resolves
  // it once; a figure whose layers name different tilesets still converts
  // correctly, each layer's cell values landing at its own tileset's offset
  // into the one flat array.
  const palette: FigurinePaletteEntry[] = []
  const tilesetOffsets = new Map<string, number>()
  function offsetFor(tilesetId: string): number {
    const cached = tilesetOffsets.get(tilesetId)
    if (cached !== undefined) return cached
    const tileset: Tileset | undefined = world.tilesets.find((candidate) => candidate.id === tilesetId)
    if (tileset === undefined) {
      // Loud refusal, same policy as charForIndex: a dangling tilesetId
      // would silently decode this layer's cells into the NEXT tileset's
      // palette slots (wrong colors) or into nothing (invisible voxels).
      throw new Error(`figurineFromWorld: layer tileset '${tilesetId}' does not exist in this world`)
    }
    const offset = palette.length
    tilesetOffsets.set(tilesetId, offset)
    for (const tile of tileset.tiles) {
      const top = tile.colors.top
      palette.push({
        top,
        left: tile.colors.left ?? shadeHex(top, SOUTH_WALL_SHADE),
        right: tile.colors.right ?? shadeHex(top, EAST_WALL_SHADE),
      })
    }
    return offset
  }

  const slices: FigurineSlice[] = layers.map((layer: TileLayer) => {
    const offset = offsetFor(layer.tilesetId)
    const rows: string[] = []
    for (let r = 0; r < size; r += 1) {
      const ty = size - 1 - r // the same flip figurineCellAt reads back
      let row = ''
      for (let tx = 0; tx < size; tx += 1) {
        const value = getCell(layer, tx, ty)
        row += value === 0 ? '.' : charForIndex(offset + value - 1)
      }
      rows.push(row)
    }
    return { top: layer.elevation, base: layer.base ?? 0, rows }
  })

  // Slices sorted bottom-to-top, refusing overlap loudly: the renderer's
  // hidden-face culling reads slices[i + 1] as "the slab above", so the
  // order and the non-overlap ARE the data's contract, established here at
  // conversion, verified again by readFigurine at every file boundary.
  slices.sort((a, b) => a.base - b.base)
  for (let i = 1; i < slices.length; i += 1) {
    const below = slices[i - 1]
    const slice = slices[i]
    if (below !== undefined && slice !== undefined && slice.base < below.top) {
      throw new Error(
        `figurineFromWorld: overlapping slabs (a slice based at ${slice.base} inside one topping at ${below.top}) — ` +
          'a figurine is a stack, not a pile',
      )
    }
  }

  return { size, slices, palette }
}

/**
 * Shape-check an entity's `figurine` component the way `picking.ts` checks
 * `position`/`elevation`/`marker`: components are opaque blobs at the file
 * boundary (a hand-edited world can hold anything), so every field is
 * verified before it is believed, and any mismatch answers `null` instead of
 * throwing mid-frame. Used by the renderer to decide "does this entity draw
 * as a miniature?" without ever trusting a bare cast.
 */
export function readFigurine(entity: Entity): Figurine | null {
  const raw = entity.components['figurine']
  if (raw === null || typeof raw !== 'object') return null
  const { size, slices, palette } = raw as { size?: unknown; slices?: unknown; palette?: unknown }
  // The size cap guards the RENDERER here, not just authoring taste: the
  // miniature walk visits size² cells per slice every frame, so a
  // hand-edited size of 100000 would hang the tab. Same cap as conversion.
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > MAX_FIGURINE_SIZE) return null
  if (!Array.isArray(slices) || slices.length > MAX_FIGURINE_SIZE || !Array.isArray(palette)) return null

  const readSlices: FigurineSlice[] = []
  for (const candidate of slices) {
    if (typeof candidate !== 'object' || candidate === null) return null
    const { top, base, rows } = candidate as { top?: unknown; base?: unknown; rows?: unknown }
    if (typeof top !== 'number' || typeof base !== 'number' || !Number.isFinite(top) || !Number.isFinite(base)) {
      return null
    }
    if (base >= top) return null // a slab must have height
    // Bottom-to-top, non-overlapping — the invariant the renderer's
    // "slices[i + 1] is the slab above" culling stands on.
    const below = readSlices[readSlices.length - 1]
    if (below !== undefined && base < below.top) return null
    // Every character must decode: valueForChar throws on a stranger, and a
    // draw call is the wrong place to find that out. A row longer than the
    // footprint smuggles the same problem in sideways, so it is refused too.
    if (
      !Array.isArray(rows) ||
      rows.length > size ||
      !rows.every(
        (row) =>
          typeof row === 'string' &&
          row.length <= size &&
          [...row].every((ch) => ch === '.' || FIGURINE_CHARS.includes(ch)),
      )
    ) {
      return null
    }
    readSlices.push({ top, base, rows: rows as string[] })
  }

  const readPalette: FigurinePaletteEntry[] = []
  for (const candidate of palette) {
    if (typeof candidate !== 'object' || candidate === null) return null
    const { top, left, right } = candidate as { top?: unknown; left?: unknown; right?: unknown }
    if (typeof top !== 'string' || typeof left !== 'string' || typeof right !== 'string') return null
    readPalette.push({ top, left, right })
  }

  return { size, slices: readSlices, palette: readPalette }
}

/**
 * The one built-in figurine, v1 ships: Pip, converted from the bear FIGURE
 * fixture (fixtures.ts's `createBearFigure`), floor excluded — a figurine is
 * the shape, not the ground it happened to be authored on. Built once, at
 * module load, from the exact same builder the 'bear-figure' lesson fixture
 * uses: the conversion function IS the production path, and this constant is
 * the proof, not a separately-authored asset that could drift from it.
 */
const pipFigurine = figurineFromWorld(createBearFigure(), { exclude: ['floor'] })
if (pipFigurine === null) {
  // Unreachable in practice (createBearFigure always emits ten z-slices plus
  // a floor), but a null here would mean the fixture lost every tile layer —
  // exactly the kind of drift this module refuses to ship silently.
  throw new Error('figurine: the bear figure fixture lost every tile layer — PIP_FIGURINE cannot be built')
}
export const PIP_FIGURINE: Figurine = pipFigurine
