/**
 * One view = one lens pointed at the shared world.
 *
 * Each window in this demo owns nothing but a Projection and the
 * TransformStack wrapped around it. The world model is one object, shared by
 * reference across all three; a view is just the assembly that turns that
 * object into pixels through ITS matrix:
 *
 *     fitCamera  — frame the whole island (camera = translation ∘ scaling)
 *     layers     — the cached tile renderers, one per (layer, projection)
 *     entities   — markers pushed point-by-point through worldToScreen
 *     overlays   — the shared selection, redrawn in this view's own geometry
 *
 * The one idea that keeps three simultaneous views honest is the painter's
 * ORDER, not any per-view special case: every drawable — whole layers and
 * individual entities alike — gets one depth key and paintersOrder decides
 * who covers whom. A layer's key opens its band (half a stride early, so
 * terrain always underlies the things standing on it); an entity's key comes
 * from projection.depth at one band ABOVE the layer that supports it. In the
 * iso window that ordering is VISIBLE: the L of crates overlaps correctly
 * because x − y + z says so, and ties break by id, deterministically.
 * (Banding is a v1 approximation with two documented artifacts — see
 * bandAbove below.)
 *
 * Alternate views draw schematic geometry (colored faces, marker dots,
 * outlines) labeled "X-ray view" in the page chrome — the curated-lens rule
 * of docs/ARCHITECTURE.md §4: projections are honest about points and modest
 * about art.
 */

import type { Entity, TileLayer, Tileset, World } from '@engine/core'
import { entityIds, getEntity } from '@engine/core'
import { Vec2 } from '@engine/math'
import { DEPTH_BAND_STRIDE, fitCamera, createTransformStack, paintersOrder } from '@engine/projection'
import type { Projection, TransformStack, WorldPoint } from '@engine/projection'
import type { RendererBackend } from '@engine/renderer'
import { createLayerRenderer } from '@engine/tilemap'
import type { LayerRenderer, RasterFactory } from '@engine/tilemap'
import { PROFILE_SLAB_HEIGHT, entityWorldPoint, markerKind } from './picking'
import type { PickedTile, Selection } from './picking'

/** A view's drawing area in CSS pixels, plus the device-pixel ratio. */
export interface ViewSize {
  readonly width: number
  readonly height: number
  readonly dpr: number
}

/** What the shared UI state looks like from one view: the selection every
 * window shows, and the hover ghost only THIS window shows (the cursor is
 * only ever in one window at a time). */
export interface ViewUi {
  readonly selection: Selection
  readonly hoverTile: PickedTile | null
}

/** One assembled window: its stack (picking reads it) and its render. */
export interface View {
  readonly projection: Projection
  readonly stack: TransformStack
  render(backend: RendererBackend, size: ViewSize, ui: ViewUi): void
}

/**
 * The world's elevation range for camera fitting: ground to two units up —
 * enough headroom that the plateau (z = 1) and anything standing on it stays
 * inside every view's frame.
 */
const Z_RANGE = [0, 2] as const

/** The viewport background — deep navy, same family as the page chrome. */
const BACKGROUND = '#0d131e'

/** Marker geometry: a small circle plus a name label, in CSS pixels (screen-
 * space size on purpose — markers are UI dots, not world objects with area). */
const MARKER_RADIUS = 7
const MARKER_EDGE = '#0d131e'
const LABEL_COLOR = '#e4eaf4'
const LABEL_FONT = '11px ui-monospace, monospace'

/** Marker fills by kind; anything unrecognized gets the neutral fallback. */
const MARKER_COLORS: Record<string, string> = {
  player: '#ffd166',
  crate: '#ff8a3d',
  tree: '#4ade80',
}
const MARKER_FALLBACK = '#e4eaf4'

/** Overlay strokes: bright for the shared selection, muted for the hover ghost. */
const SELECT_STROKE = '#8ab4ff'
const HOVER_STROKE = '#93a2b8'

/**
 * Where a layer sits inside its own depth band: half a stride early, so the
 * terrain of band k paints before EVERYTHING whose within-band key is a real
 * world coordinate (those stay within a few thousand of zero — see the
 * DEPTH_BAND_STRIDE headroom argument). "Layers first by band, then
 * entities" becomes a plain consequence of one sort key.
 */
const LAYER_OPENS_BAND = -DEPTH_BAND_STRIDE / 2

/** Options for {@link createView}. The raster factory is injected so node
 * tests can hand in a pixel-less fake and get per-tile commands to hash. */
export interface CreateViewOptions {
  readonly projection: Projection
  readonly world: World
  readonly raster: RasterFactory
}

/** One drawable in the painting queue: a depth key, a tie-breaking id, and
 * the deferred draw itself. */
interface PaintItem {
  readonly id: string
  readonly depth: number
  readonly paint: () => void
}

/** A layer's tileset by id — or an empty stand-in, so a dangling reference
 * paints loud magenta "missing tile" markers instead of crashing the view. */
function tilesetFor(world: World, layer: TileLayer): Tileset {
  return (
    world.tilesets.find((tileset) => tileset.id === layer.tilesetId) ?? {
      id: layer.tilesetId,
      name: 'missing tileset',
      tiles: [],
    }
  )
}

/**
 * The band an entity draws in: one ABOVE the highest layer at or below its
 * feet, so things standing on a storey always paint over that storey's
 * terrain. (Elevations here are exact file numbers — an entity on the
 * plateau declares z = 1, the plateau declares elevation 1 — so plain
 * comparison is enough; no epsilon games.)
 *
 * HONESTY BOX: band placement alone does NOT reproduce the taught x − y + z
 * ordering across storeys — a whole layer is one queue item, so an entity
 * either paints after ALL of a layer's terrain or before ALL of it, whatever
 * the within-band keys say. Both single-band choices provably mis-sort one
 * configuration:
 *
 * - bandAbove (support + 1 — the one shipped): a ground entity NORTH-WEST of
 *   a raised layer, i.e. BEHIND it where its terrain should occlude the
 *   marker, still paints over that layer, because band-1 entities sort after
 *   every band-1 layer regardless of x − y + z.
 * - keying by the support band instead: the fixture's ground crates at the
 *   base of the plateau's east wall would paint BEFORE the plateau layer and
 *   sink behind that wall — anything standing against a raised edge would
 *   vanish into it.
 *
 * v1 ships bandAbove because taught scenes put entities in front of terrain
 * (the artifact it keeps is the rarer configuration), and pins the choice
 * with a regression test (test/banding.test.ts) so the tradeoff is a
 * contract, not an accident. The true fix — per-diagonal-strip queue items
 * for raised iso layers, so terrain interleaves with entities at x − y
 * granularity — waits for the editor phase (docs/DECISIONS.md, deferred
 * table: "Per-cell iso paint-queue granularity").
 */
function bandAbove(world: World, z: number): number {
  let support = -1
  for (const layer of world.layers) {
    if (layer.elevation <= z && layer.layerBand > support) support = layer.layerBand
  }
  return support + 1
}

/**
 * The world-space outline of one picked cell, in THIS projection's honest
 * shape. Top-down and iso outline the cell's top face at its elevation —
 * the same four corners, which the matrices turn into a square and a 2:1
 * diamond respectively (that the code cannot tell them apart IS the lesson).
 * Profile outlines the cell's edge-on slab: a rectangle in x and z, because
 * a side view has no room for the cell's depth — only its column and its
 * storey survive the projection.
 */
function tileOutline(projection: Projection, tileSize: number, tile: PickedTile): WorldPoint[] {
  const x0 = tile.tx * tileSize
  const x1 = (tile.tx + 1) * tileSize
  const y0 = tile.ty * tileSize
  const y1 = (tile.ty + 1) * tileSize
  const z = tile.elevation
  if (projection.name === 'profile') {
    const top = z + PROFILE_SLAB_HEIGHT
    // y collapses in profile; the cell's own y0 rides along for honesty and
    // lands exactly where any other lane would.
    return [
      { x: x0, y: y0, z: top },
      { x: x1, y: y0, z: top },
      { x: x1, y: y0, z },
      { x: x0, y: y0, z },
    ]
  }
  return [
    { x: x0, y: y0, z },
    { x: x1, y: y0, z },
    { x: x1, y: y1, z },
    { x: x0, y: y1, z },
  ]
}

/**
 * Assemble one view of the world: layer renderers built once (they cache),
 * everything else computed per render. Rendering is on-demand — the caller
 * decides when a frame is worth drawing (load, resize, selection, hover);
 * nothing here schedules itself.
 */
export function createView(options: CreateViewOptions): View {
  const { projection, world, raster } = options
  const stack = createTransformStack(projection)

  // The world's ground footprint: the largest layer decides, in world units
  // (layer dims × tileSize). Every view frames this same box — three cameras
  // solving the same fitting problem through three different matrices.
  const tileSize = world.settings.tileSize
  let worldW = 0
  let worldH = 0
  for (const layer of world.layers) {
    worldW = Math.max(worldW, layer.width * tileSize)
    worldH = Math.max(worldH, layer.height * tileSize)
  }

  // tileSize rides along so each renderer's cache covers the layer's TRUE
  // world extent — the same world units the camera fit above measures in.
  const layerRenderers: Array<{ layer: TileLayer; renderer: LayerRenderer }> = world.layers.map(
    (layer) => ({
      layer,
      renderer: createLayerRenderer({
        layer,
        tileset: tilesetFor(world, layer),
        projection,
        raster,
        tileSize,
      }),
    }),
  )

  /** One marker: a filled dot at the entity's projected point, name above. */
  function drawMarker(backend: RendererBackend, entity: Entity, point: WorldPoint): void {
    const s = stack.worldToScreen(point)
    const kind = markerKind(entity)
    backend.drawCircle({
      x: s.x,
      y: s.y,
      radius: MARKER_RADIUS,
      fill: (kind !== null ? MARKER_COLORS[kind] : undefined) ?? MARKER_FALLBACK,
      stroke: MARKER_EDGE,
      lineWidth: 1.5,
    })
    backend.drawText({
      x: s.x,
      y: s.y - MARKER_RADIUS - 5,
      text: entity.name,
      fill: LABEL_COLOR,
      font: LABEL_FONT,
      align: 'center',
      baseline: 'alphabetic',
    })
  }

  /** Stroke one cell's outline in this view's own geometry. */
  function strokeTile(backend: RendererBackend, tile: PickedTile, stroke: string, lineWidth: number): void {
    backend.drawPolyline({
      points: tileOutline(projection, tileSize, tile).map((corner) => stack.worldToScreen(corner)),
      stroke,
      lineWidth,
      closed: true,
    })
  }

  return {
    projection,
    stack,

    render(backend: RendererBackend, size: ViewSize, ui: ViewUi): void {
      if (size.width <= 0 || size.height <= 0) return

      // Refit every frame: cheap (eight projected corners), and it makes the
      // camera a pure function of the current view size — resize handling
      // falls out for free, with nothing stateful to go stale.
      stack.setCamera(
        fitCamera({
          viewWidth: size.width,
          viewHeight: size.height,
          worldMin: Vec2.zero,
          worldMax: Vec2.make(worldW, worldH),
          zRange: Z_RANGE,
          projection,
        }),
      )

      backend.beginFrame({ width: size.width, height: size.height, dpr: size.dpr, background: BACKGROUND })

      // Everything through ONE painting queue. Layers open their bands;
      // entities key by projection.depth one band above their support. The
      // sort is total (depth, then id), so the picture depends only on WHAT
      // is in the world — never on iteration accidents.
      const queue: PaintItem[] = []
      for (const { layer, renderer } of layerRenderers) {
        queue.push({
          id: layer.id,
          depth: layer.layerBand * DEPTH_BAND_STRIDE + LAYER_OPENS_BAND,
          paint: () => renderer.draw(backend, stack.camera),
        })
      }
      for (const id of entityIds(world)) {
        const entity = world.entities[id]
        if (entity === undefined) continue
        const point = entityWorldPoint(entity)
        if (point === null) continue
        queue.push({
          id,
          depth: projection.depth(point, bandAbove(world, point.z)),
          paint: () => drawMarker(backend, entity, point),
        })
      }
      for (const item of paintersOrder(queue)) item.paint()

      // Overlays ride on top of the world: hover ghost first (muted), then
      // the shared selection (bright), so a selection is never hidden by the
      // cursor merely passing over it.
      if (ui.hoverTile !== null) {
        strokeTile(backend, ui.hoverTile, HOVER_STROKE, 1)
      }
      if (ui.selection !== null) {
        if (ui.selection.kind === 'tile') {
          strokeTile(backend, ui.selection.tile, SELECT_STROKE, 2)
        } else {
          const entity = getEntity(world, ui.selection.id)
          const point = entity === undefined ? null : entityWorldPoint(entity)
          if (point !== null) {
            const s = stack.worldToScreen(point)
            backend.drawCircle({
              x: s.x,
              y: s.y,
              radius: MARKER_RADIUS + 4,
              stroke: SELECT_STROKE,
              lineWidth: 2,
            })
          }
        }
      }

      backend.endFrame()
    },
  }
}
