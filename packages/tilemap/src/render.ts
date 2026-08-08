/**
 * The cached fast path — why 65,536 tiles can cost one draw call.
 *
 * ## The problem
 *
 * A fully zoomed-out 256×256 layer is 65,536 tiles. Draw each one as its own
 * filled shape at 60 fps and you are asking a school Chromebook for four
 * million polygon fills a second — it dies, visibly (docs/RISKS.md). Yet
 * almost none of that work changes from frame to frame: the tiles are the
 * same tiles. Only the CAMERA moved.
 *
 * ## The idea: split the pipeline where it changes
 *
 * Every tile's screen position is `camera ∘ projection` applied to its world
 * corners (docs/ARCHITECTURE.md §4). The projection half is expensive in
 * bulk — tens of thousands of applications — but CONSTANT for a given layer.
 * The camera half changes every frame — but it is one affine map, applied
 * once. So we split exactly there:
 *
 *   1. ONCE: render the whole layer into an offscreen bitmap in VIEW-PLANE
 *      coordinates — projection applied, camera deliberately NOT.
 *   2. EVERY FRAME: draw that one bitmap through the camera. Scaling a
 *      picture scales every tile in it simultaneously; the GPU-backed blit
 *      does in one operation what per-tile drawing did in 65,536.
 *
 * Why is the cheap half legal? Because the camera is affine: it maps our
 * cached rectangle to a rectangle (for the axis-aligned scale+translate
 * cameras v1 uses) and treats every pixel in it identically. "Caching works
 * when you can factor the work into (expensive × rarely changes) ∘ (cheap ×
 * changes often)" — that sentence is the whole lesson, and it is the same
 * reason browsers cache layers and GPUs cache textures.
 *
 * ## Keeping the cache honest: invalidation
 *
 * A stale cache is a lie on screen, so every setCell bumps the layer's
 * revision and records the touched cell (layer.ts). On draw, a revision
 * mismatch triggers repainting — of exactly the dirty cells for top-down
 * (their view rects are disjoint per cell, so clear-rect + fill-rect is
 * surgical), and of the whole layer for iso and profile. That conservatism
 * is a documented v1 simplification: an iso cell's walls overlap its
 * neighbors' pixels, so a correct minimal patch needs neighborhood math that
 * arrives with the editor phase. Painting happens at editor rate (a few
 * cells per stroke), never per frame, so "correct but occasionally lazy"
 * costs nothing that matters — the per-frame path is one blit either way.
 *
 * ## The honest limits
 *
 * - A ROTATED (or mirrored) camera would need the blit to resample the cache
 *   under a non-axis-aligned map; v1 falls back to per-tile drawing for
 *   those, correct if slower. Axis-aligned scale + translate — every camera
 *   fitCamera produces — takes the fast path.
 * - The cache raster is capped at 4096 px per side: bigger canvases exceed
 *   common GPU texture limits and Chromebook memory budgets, so beyond the
 *   cap we lower the cache resolution instead of allocating a monster.
 * - No real pixel store (headless tests: raster.source === null)? Fall back
 *   to per-tile draw commands so the geometry stays visible to hashing.
 */

import type { TileDef, TileLayer, Tileset } from '@engine/core'
import { Mat3, Vec2 } from '@engine/math'
import type { Projection } from '@engine/projection'
import type { RendererBackend } from '@engine/renderer'
import { drainDirtyCells, getCell, layerRevision } from './layer'
import type { RasterFactory, RasterTarget } from './raster'

/**
 * Cache resolution: how many raster pixels one view-plane unit gets
 * (default 16). At the default projections one tile is roughly one view
 * unit, so a cached tile is a 16×16 sprite — crisp at typical zooms, and
 * when zoomed OUT (the case that used to melt Chromebooks) the blit shrinks
 * the cache and quality only improves.
 */
const DEFAULT_CACHE_PIXELS_PER_UNIT = 16

/**
 * Hard ceiling on cache raster dimensions. 4096 is the classic safe GPU
 * texture size, and a 4096×4096 RGBA canvas is already 64 MB — about as
 * much as a school Chromebook will forgive. A 256×256-tile layer at the
 * default 16 px/unit lands exactly on this cap; asking for more resolution
 * lowers pixels-per-unit instead of allocating past the cap.
 */
const MAX_CACHE_DIMENSION = 4096

/**
 * Profile view draws each layer EDGE-ON: a thin slab this many world units
 * tall per occupied column. Thick enough to see and click, thin enough to
 * read as "the floor seen from the side" — the honest X-ray schematic of
 * ARCHITECTURE §4, not fake side-view art.
 */
export const PROFILE_SLAB_HEIGHT = 0.15

/**
 * A cell value pointing past the end of the tileset paints loud magenta
 * instead of nothing: a kid who hand-edited their world file should SEE
 * "something references a missing tile", not wonder where their wall went.
 */
const MISSING_TILE: TileDef = { name: 'missing tile', colors: { top: '#ff00ff' } }

/**
 * Default shading for iso walls when the tileset gives no explicit
 * left/right colors: scale the top color toward black, as if lit from the
 * north-west. Under the south-east camera (docs/DECISIONS.md D7) the two
 * walls the viewer can see are the SOUTH face (screen lower-left — painted
 * with the tileset's `left` color when one exists) and the EAST face
 * (screen lower-right — the tileset's `right` color). The south face points
 * squarely away from a north-west light, so it takes the deeper shade; the
 * east face catches that light at a graze and stays lighter. Multiplying
 * each RGB channel by the same factor darkens without changing hue — the
 * cheapest believable shadow.
 */
const SOUTH_WALL_SHADE = 0.55
const EAST_WALL_SHADE = 0.75

/** Draws one tile layer: cached blit when it can, per-tile commands when it must. */
export interface LayerRenderer {
  draw(backend: RendererBackend, camera: Mat3): void
}

/** Options for {@link createLayerRenderer}. */
export interface LayerRendererOptions {
  layer: TileLayer
  tileset: Tileset
  projection: Projection
  raster: RasterFactory
  cachePixelsPerUnit?: number
  /**
   * World units per grid cell — `world.settings.tileSize`. The layer's grid
   * is stored in CELLS, but cameras, entities, and picking all speak WORLD
   * units, so cell corners are scaled by tileSize on the ground axes before
   * projecting. Elevation is NEVER scaled: `layer.elevation` and
   * {@link PROFILE_SLAB_HEIGHT} are already world units. Default 1 (one
   * cell = one world unit).
   */
  tileSize?: number
}

/**
 * Where tile geometry gets painted, without saying how. The same
 * per-projection geometry code drives two very different outputs — the
 * cache raster (view units scaled to raster pixels) and the per-tile
 * fallback (view units through the camera into backend commands) — so the
 * geometry itself is written exactly once. Coordinates are view-plane units.
 */
interface PaintSurface {
  rect(color: string, x: number, y: number, w: number, h: number): void
  poly(color: string, points: readonly Vec2[]): void
}

/**
 * Darken a #rgb or #rrggbb color by multiplying each channel by `factor`.
 * Anything unparseable passes through unchanged — a wrong shade is a
 * cosmetic bug, not a crash.
 */
function shadeHex(color: string, factor: number): string {
  if (!color.startsWith('#')) return color
  const hex = color.slice(1)
  if ((hex.length !== 3 && hex.length !== 6) || !/^[0-9a-fA-F]+$/.test(hex)) return color
  const full = hex.length === 3 ? hex.replace(/./g, (ch) => ch + ch) : hex
  let out = '#'
  for (let i = 0; i < 6; i += 2) {
    const channel = Math.floor(parseInt(full.slice(i, i + 2), 16) * factor)
    out += Math.max(0, Math.min(255, channel)).toString(16).padStart(2, '0')
  }
  return out
}

/**
 * Build the cached renderer for one layer under one projection.
 *
 * The cache is laid out at creation: project the layer's world-space
 * bounding box (at every elevation its geometry can reach) into the view
 * plane, and size a raster over that box at `cachePixelsPerUnit` (default
 * 16, capped so no side exceeds 4096 px). Layer width/height/elevation and
 * tileSize are treated as fixed for the renderer's lifetime; cell VALUES may
 * change freely — that is what the revision/dirty bookkeeping tracks.
 */
export function createLayerRenderer(options: LayerRendererOptions): LayerRenderer {
  const { layer, tileset, projection } = options
  const tileSize = options.tileSize ?? 1

  const project = (x: number, y: number, z: number): Vec2 => projection.project({ x, y, z })

  // Grid → world → view, in one step. Cell coordinates are GRID numbers, but
  // the projections speak WORLD units, so ground coordinates scale by
  // tileSize on the way in. z passes through untouched: elevations
  // (layer.elevation, PROFILE_SLAB_HEIGHT) are already world units, and
  // scaling them with the grid pitch would make walls grow taller whenever
  // tiles grew wider.
  const projectCell = (gx: number, gy: number, z: number): Vec2 =>
    project(gx * tileSize, gy * tileSize, z)

  // ---- The view-plane bounding box of everything this layer can draw. ----
  //
  // The projection is affine, so extremes can only happen at corners: the
  // four corners of the layer's world rectangle (grid corners × tileSize —
  // the TRUE world extent, which is what the cache raster must cover), at
  // the lowest and highest z its geometry touches (iso walls drop from the
  // elevation to the ground; profile slabs rise PROFILE_SLAB_HEIGHT above
  // it; top-down is flat).
  const zExtents: number[] =
    projection.name === 'profile'
      ? [layer.elevation, layer.elevation + PROFILE_SLAB_HEIGHT]
      : projection.name === 'iso' && layer.elevation > 0
        ? [0, layer.elevation]
        : [layer.elevation]

  let viewMinX = Infinity
  let viewMinY = Infinity
  let viewMaxX = -Infinity
  let viewMaxY = -Infinity
  for (const z of zExtents) {
    for (const corner of [
      [0, 0],
      [layer.width, 0],
      [layer.width, layer.height],
      [0, layer.height],
    ] as const) {
      const v = projectCell(corner[0], corner[1], z)
      viewMinX = Math.min(viewMinX, v.x)
      viewMinY = Math.min(viewMinY, v.y)
      viewMaxX = Math.max(viewMaxX, v.x)
      viewMaxY = Math.max(viewMaxY, v.y)
    }
  }

  // ---- Cache resolution, honoring the 4096 px cap. ----
  let ppu = options.cachePixelsPerUnit ?? DEFAULT_CACHE_PIXELS_PER_UNIT
  const rawW = Math.ceil((viewMaxX - viewMinX) * ppu)
  const rawH = Math.ceil((viewMaxY - viewMinY) * ppu)
  if (rawW > MAX_CACHE_DIMENSION || rawH > MAX_CACHE_DIMENSION) {
    ppu *= Math.min(MAX_CACHE_DIMENSION / rawW, MAX_CACHE_DIMENSION / rawH)
  }
  const rasterW = Math.max(1, Math.min(MAX_CACHE_DIMENSION, Math.ceil((viewMaxX - viewMinX) * ppu)))
  const rasterH = Math.max(1, Math.min(MAX_CACHE_DIMENSION, Math.ceil((viewMaxY - viewMinY) * ppu)))

  // Ceil rounded the raster up to whole pixels, so declare the cache to
  // cover exactly rasterW/ppu × rasterH/ppu view units (a sliver more than
  // the geometry needs; the extra edge stays transparent). Now one raster
  // pixel is EXACTLY 1/ppu view units everywhere — the paint math below and
  // the blit math in draw() share this fact, and sharing it exactly is what
  // keeps cache pixels and screen positions from drifting half a pixel
  // apart (a drift you would see as a seam between layers).
  const coveredViewW = rasterW / ppu
  const coveredViewH = rasterH / ppu

  const cache: RasterTarget = options.raster(rasterW, rasterH)
  const blitLabel = `tilemap:${layer.id}`

  // Revision the cache pixels currently reflect; −1 = never painted, so the
  // first blit always triggers a full paint no matter what the layer's
  // revision count happens to be.
  let paintedRevision = -1

  const toRasterX = (viewX: number): number => (viewX - viewMinX) * ppu
  const toRasterY = (viewY: number): number => (viewY - viewMinY) * ppu

  /** Paints view-unit geometry into the cache raster (view → raster pixels). */
  const rasterSurface: PaintSurface = {
    rect(color, x, y, w, h): void {
      cache.fillRect(color, toRasterX(x), toRasterY(y), w * ppu, h * ppu)
    },
    poly(color, points): void {
      cache.fillPoly(
        color,
        points.map((p) => Vec2.make(toRasterX(p.x), toRasterY(p.y))),
      )
    },
  }

  /** Cell value → tile definition, with the loud magenta stand-in for bad references. */
  const tileFor = (value: number): TileDef => tileset.tiles[value - 1] ?? MISSING_TILE

  /**
   * A top-down cell's rectangle in view units. Corners go through the
   * projection like everything else, then min/max sorts them out — the
   * top-down y-flip (project y = −s·y) turns the cell's (tx, ty) SOUTH-WEST
   * corner (its smallest world y; world y grows north) into the view-plane
   * BOTTOM-left, and the north-west corner (tx, ty+1) into the top-left.
   * Follow that one flip across the whole map and you get the connective
   * lesson: tile row 0 is the map's SOUTHERN edge, so it renders at the
   * BOTTOM of the top-down window. Neighboring cells share these exact
   * corner values (same formula, same floats), which is why patching one
   * cell can never leave a gap or overlap against the next: their shared
   * edge is bit-identical.
   */
  function cellViewRect(tx: number, ty: number): { x: number; y: number; w: number; h: number } {
    const a = projectCell(tx, ty, layer.elevation)
    const b = projectCell(tx + 1, ty + 1, layer.elevation)
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    }
  }

  // ---- Per-projection tile geometry: the three procedural "asset sets". ----

  /** Top-down: one unit square per occupied cell, in reading order. */
  function paintTopdown(surface: PaintSurface): void {
    for (let ty = 0; ty < layer.height; ty += 1) {
      for (let tx = 0; tx < layer.width; tx += 1) {
        const value = getCell(layer, tx, ty)
        if (value === 0) continue
        const r = cellViewRect(tx, ty)
        surface.rect(tileFor(value).colors.top, r.x, r.y, r.w, r.h)
      }
    }
  }

  /**
   * Iso: each cell's square projects to a 2:1 diamond (its top face). A
   * raised layer also grows walls, dropping from the top face to the ground
   * plane z = 0 — but only the faces the SOUTH-EAST camera (docs/DECISIONS.md
   * D7) can see: the SOUTH wall (the cell's y-min side, screen lower-left)
   * and the EAST wall (its x-max side, screen lower-right), and only where
   * the same-layer neighbor on that side — (tx, ty−1) for south, (tx+1, ty)
   * for east — is empty or off the map; a face pressed against an occupied
   * neighbor is buried and never drawn. Per cell: south wall, east wall, then
   * the top face over both, so the top owns the shared upper edges.
   *
   * Cells are visited in ascending x − y — the within-band iso depth
   * relation of the south-east camera (a step east comes toward the viewer,
   * a step north goes away) — walking diagonal by diagonal, so every cell's
   * walls are painted before any cell in front of it (further east or south)
   * covers their shared pixels. Painter's algorithm, inside a single layer.
   */
  function paintIso(surface: PaintSurface): void {
    const e = layer.elevation
    // x − y ranges from −(height − 1) (the far, north-west corner) up to
    // width − 1 (the near, south-east corner); cells on one diagonal share a
    // depth key and never overlap, so ascending tx inside a diagonal is pure
    // determinism, not geometry.
    for (let diagonal = -(layer.height - 1); diagonal <= layer.width - 1; diagonal += 1) {
      const txFirst = Math.max(0, diagonal)
      const txLast = Math.min(layer.width - 1, layer.height - 1 + diagonal)
      for (let tx = txFirst; tx <= txLast; tx += 1) {
        const ty = tx - diagonal
        const value = getCell(layer, tx, ty)
        if (value === 0) continue
        const tile = tileFor(value)
        if (e > 0) {
          // getCell answers 0 both for empty cells and for coordinates off
          // the map — exactly the two cases where the face is exposed.
          if (getCell(layer, tx, ty - 1) === 0) {
            const south = tile.colors.left ?? shadeHex(tile.colors.top, SOUTH_WALL_SHADE)
            surface.poly(south, [
              projectCell(tx, ty, e),
              projectCell(tx + 1, ty, e),
              projectCell(tx + 1, ty, 0),
              projectCell(tx, ty, 0),
            ])
          }
          if (getCell(layer, tx + 1, ty) === 0) {
            const east = tile.colors.right ?? shadeHex(tile.colors.top, EAST_WALL_SHADE)
            surface.poly(east, [
              projectCell(tx + 1, ty, e),
              projectCell(tx + 1, ty + 1, e),
              projectCell(tx + 1, ty + 1, 0),
              projectCell(tx + 1, ty, 0),
            ])
          }
        }
        surface.poly(tile.colors.top, [
          projectCell(tx, ty, e),
          projectCell(tx + 1, ty, e),
          projectCell(tx + 1, ty + 1, e),
          projectCell(tx, ty + 1, e),
        ])
      }
    }
  }

  /**
   * Profile: the layer is EDGE-ON — a horizontal plane seen from the side is
   * a line, so we draw the honest schematic: one thin slab per occupied
   * COLUMN, at the layer's elevation. Profile collapses y entirely (its
   * ground matrix is rank-deficient — the lesson), so a whole column of
   * cells lands on the same screen pixels; the SOUTHERNMOST occupied cell
   * (smallest ty — nearest the camera, which looks from the south) decides
   * the column's color, exactly as a painter's sort of the individual cells
   * would have. y = 0 goes into the projection below only because SOME y
   * must; any other value lands identically.
   */
  function paintProfile(surface: PaintSurface): void {
    const zBottom = layer.elevation
    const zTop = layer.elevation + PROFILE_SLAB_HEIGHT
    for (let tx = 0; tx < layer.width; tx += 1) {
      let tile: TileDef | null = null
      for (let ty = 0; ty < layer.height; ty += 1) {
        const value = getCell(layer, tx, ty)
        if (value > 0) {
          tile = tileFor(value)
          break
        }
      }
      if (tile === null) continue
      surface.poly(tile.colors.side ?? tile.colors.top, [
        projectCell(tx, 0, zTop),
        projectCell(tx + 1, 0, zTop),
        projectCell(tx + 1, 0, zBottom),
        projectCell(tx, 0, zBottom),
      ])
    }
  }

  /** The full layer, through whichever surface, in the projection's own order. */
  function paintLayer(surface: PaintSurface): void {
    switch (projection.name) {
      case 'topdown':
        paintTopdown(surface)
        break
      case 'iso':
        paintIso(surface)
        break
      case 'profile':
        paintProfile(surface)
        break
    }
  }

  /**
   * Surgical top-down patch: erase exactly one cell's raster rect, refill it
   * if the cell is still occupied. clear-then-fill (not just fill) because
   * the edit may have EMPTIED the cell, and because layer pixels start
   * transparent — painting over is not the same as replacing.
   */
  function repaintTopdownCell(index: number): void {
    const tx = index % layer.width
    const ty = (index - tx) / layer.width
    const r = cellViewRect(tx, ty)
    const rx = toRasterX(r.x)
    const ry = toRasterY(r.y)
    const rw = r.w * ppu
    const rh = r.h * ppu
    cache.clear(rx, ry, rw, rh)
    const value = getCell(layer, tx, ty)
    if (value > 0) {
      cache.fillRect(tileFor(value).colors.top, rx, ry, rw, rh)
    }
  }

  /** Bring the cache raster up to date with the layer, doing as little as honestly possible. */
  function syncCache(): void {
    const revision = layerRevision(layer)
    if (revision === paintedRevision) return

    const dirty = drainDirtyCells(layer)
    const canPatch = paintedRevision !== -1 && projection.name === 'topdown' && dirty.length > 0
    if (canPatch) {
      // Ascending index order: not needed for correctness (top-down cell
      // rects are disjoint) but it makes the raster call sequence a pure
      // function of WHICH cells changed, not the order a brush visited them
      // — one less way for logs to differ between identical edits.
      dirty.sort((a, b) => a - b)
      for (const index of dirty) repaintTopdownCell(index)
    } else {
      // Full repaint: first paint ever, iso/profile edits (v1's documented
      // conservatism — see the file header), or a revision that moved with
      // no dirty list to show for it (someone else drained it).
      cache.clear(0, 0, cache.width, cache.height)
      paintLayer(rasterSurface)
    }
    paintedRevision = revision
  }

  /**
   * The slow-but-always-correct path: every tile as its own backend command,
   * view units mapped through the camera by hand. Used headless (no pixel
   * store to cache into) and under rotated/mirrored cameras (a blit cannot
   * resample). Deterministic command order falls straight out of the
   * deterministic geometry order in paintLayer.
   */
  function emitPerTile(backend: RendererBackend, camera: Mat3): void {
    const emitQuad = (color: string, points: readonly Vec2[]): void => {
      backend.drawPolyline({
        points: points.map((p) => Mat3.apply(camera, p)),
        fill: color,
      })
    }
    paintLayer({
      rect: (color, x, y, w, h) =>
        emitQuad(color, [
          Vec2.make(x, y),
          Vec2.make(x + w, y),
          Vec2.make(x + w, y + h),
          Vec2.make(x, y + h),
        ]),
      poly: emitQuad,
    })
  }

  return {
    draw(backend: RendererBackend, camera: Mat3): void {
      // The blit can only reproduce what an axis-aligned camera does to the
      // cache: scale it and move it. Any rotation or shear (b, c ≠ 0) — or a
      // mirror (negative scale), which a dest rect cannot express — takes
      // the per-tile path instead. Correctness never depends on the cache.
      const axisAligned = camera.b === 0 && camera.c === 0 && camera.a > 0 && camera.d > 0
      const source = cache.source
      if (source === null || !axisAligned) {
        emitPerTile(backend, camera)
        return
      }

      syncCache()

      // The blit's dest rect, spelled out. Raster pixel (0, 0) sits at
      // view-plane point (viewMinX, viewMinY), and the raster covers exactly
      // coveredViewW × coveredViewH view units (see the covered-view note
      // above). An axis-aligned camera {a, d, tx, ty} maps view point
      // (vx, vy) to (a·vx + tx, d·vy + ty), so the cache's top-left corner
      // and extent land at:
      //
      //     dx = a · viewMinX + tx        dw = a · coveredViewW
      //     dy = d · viewMinY + ty        dh = d · coveredViewH
      //
      // Deliberately NOT rounded: snapping dx or dw to whole pixels would
      // shift this layer's image by up to half a pixel relative to anything
      // drawn from the same camera without snapping — visible as a seam
      // where two layers meet. The backend resamples sub-pixel rects fine.
      backend.drawImage({
        source,
        label: blitLabel,
        dx: camera.a * viewMinX + camera.tx,
        dy: camera.d * viewMinY + camera.ty,
        dw: camera.a * coveredViewW,
        dh: camera.d * coveredViewH,
      })
    },
  }
}
