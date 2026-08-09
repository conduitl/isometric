/**
 * The scene renderer — the editor's picture of the document, one painters
 * queue and a stack of honest overlays.
 *
 * The world-drawing assembly is lifted from apps/three-windows/src/views.ts
 * (the Phase 1 demo proved it): every drawable — whole layers and individual
 * entities alike — gets ONE depth key and paintersOrder decides who covers
 * whom. A layer opens its band half a stride early so terrain always
 * underlies the things standing on it; an entity keys by projection.depth
 * one band above its supporting storey. No per-view special cases — the
 * picture depends only on what is in the world.
 *
 * Where the editor deliberately departs from the demo:
 *
 * 1. **The camera is the caller's, untouched.** The demo refit every frame
 *    (its camera was a pure function of view size); the editor's camera is
 *    USER STATE — pan and zoom the student chose — owned by the camera
 *    controller. Refitting here would snap their viewpoint back every frame.
 * 2. **entityOverride** is the preview protocol's rendering half: while a
 *    drag is live, THAT entity draws at the override point — depth key
 *    included, so the ghost sorts exactly where it would land — instead of
 *    its committed components. Nothing else about the frame changes.
 * 3. **Layer renderers are cached in a Map keyed by the TileLayer OBJECT.**
 *    Entity- and settings-scale commands go through Immer with structural
 *    sharing: untouched branches — the layers array, every layer, every
 *    Uint16Array — stay reference-identical across document swaps, so the
 *    cache survives every non-tile edit for free. Tile strokes mutate cells
 *    in place, and the layer's revision bookkeeping invalidates raster
 *    pixels without touching renderer identity. Only loading a new world
 *    mints new layer objects (and possibly a new projection) — and the
 *    session calls reset() there, which is why a map keyed only by layer
 *    can never go stale.
 * 4. **Grid, cursor, and compass overlays** — editor furniture the demo
 *    never needed. The keyboard cell cursor draws with the same first-class
 *    brightness as a selection: keyboard-only operation is a Phase 2 exit
 *    requirement, not an afterthought. The axis compass is permanent
 *    "which way is north" furniture (ARCHITECTURE §3's owned z-up friction):
 *    two screen arrows showing where world east and north land under THIS
 *    projection, drawn every frame, in every lens.
 */

import type { Entity, EntityId, TileLayer, Tileset, World } from '@engine/core'
import { entityIds, getEntity } from '@engine/core'
import { Vec2 } from '@engine/math'
import { DEPTH_BAND_STRIDE, paintersOrder } from '@engine/projection'
import type { Projection, TransformStack, WorldPoint } from '@engine/projection'
import type { RendererBackend } from '@engine/renderer'
import { createLayerRenderer, PROFILE_SLAB_HEIGHT } from '@engine/tilemap'
import type { LayerRenderer, RasterFactory } from '@engine/tilemap'
import { entityWorldPoint, markerKind } from './picking'
import type { PickedTile, Selection } from './types'

/** The viewport background — deep navy, same family as the app chrome. */
const BACKGROUND = '#0d131e'

/** Marker geometry (from views.ts): a small circle plus a name label, in CSS
 * pixels — screen-space size on purpose; markers are UI dots, not world
 * objects with area. */
const MARKER_RADIUS = 7
const MARKER_EDGE = '#0d131e'
const LABEL_COLOR = '#e4eaf4'
const LABEL_FONT = '11px ui-monospace, monospace'

/** Marker fills by kind (from views.ts); anything unrecognized gets the
 * neutral fallback. */
const MARKER_COLORS: Record<string, string> = {
  player: '#ffd166',
  crate: '#ff8a3d',
  tree: '#4ade80',
}
const MARKER_FALLBACK = '#e4eaf4'

/** Overlay strokes: muted hover ghost, bright keyboard cursor, selection blue. */
const HOVER_STROKE = '#93a2b8'
const CURSOR_STROKE = '#ffd166'
const SELECT_STROKE = '#8ab4ff'
const GRID_STROKE = '#2a3242'
const COMPASS_COLOR = '#93a2b8'

/** Compass layout: arrows this long, rooted this far into the corner. */
const COMPASS_LENGTH = 28
const COMPASS_ORIGIN = 40

/**
 * Where a layer sits inside its own depth band: half a stride early, so the
 * terrain of band k paints before EVERYTHING whose within-band key is a real
 * world coordinate. "Layers first by band, then entities" becomes a plain
 * consequence of one sort key. (From views.ts, unchanged.)
 */
const LAYER_OPENS_BAND = -DEPTH_BAND_STRIDE / 2

/** The transient bits of a frame the session hands in alongside the doc. */
export interface RenderUi {
  readonly selection: Selection
  readonly hoverTile: PickedTile | null
  /** The keyboard cell cursor (on the active layer), or null when hidden. */
  readonly cursorTile: { readonly tx: number; readonly ty: number } | null
  /** The preview protocol's rendering half: draw THIS entity THERE. */
  readonly entityOverride: { readonly id: EntityId; readonly point: WorldPoint } | null
  readonly activeLayerId: string | null
  readonly grid: boolean
}

/** A frame's drawing area in CSS pixels, plus the device-pixel ratio. */
export interface SceneSize {
  readonly width: number
  readonly height: number
  readonly dpr: number
}

/** The renderer the session drives once per dirty frame. */
export interface SceneRenderer {
  render(backend: RendererBackend, doc: World, stack: TransformStack, size: SceneSize, ui: RenderUi): void
  /** Drop every cached layer renderer — called on loadWorld, when layer
   * objects (and possibly the projection) are replaced wholesale. */
  reset(): void
}

/** One drawable in the painting queue: a depth key, a tie-breaking id, and
 * the deferred draw itself. */
interface PaintItem {
  readonly id: string
  readonly depth: number
  readonly paint: () => void
}

/** A layer's tileset by id — or an empty stand-in, so a dangling reference
 * paints loud magenta "missing tile" markers instead of crashing the frame.
 * (From views.ts.) */
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
 * comparison is enough; no epsilon games.) Lifted from views.ts, honesty
 * box and all:
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
 * - keying by the support band instead: anything standing against a raised
 *   edge would paint BEFORE that layer and vanish into its wall.
 *
 * v1 ships bandAbove because taught scenes put entities in front of terrain
 * (the artifact it keeps is the rarer configuration). The true fix —
 * per-diagonal-strip queue items for raised iso layers — waits in
 * docs/DECISIONS.md's deferred table ("Per-cell iso paint-queue granularity").
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
 * shape (from views.ts). Top-down and iso outline the cell's top face at its
 * elevation — the same four corners, which the matrices turn into a square
 * and a 2:1 diamond respectively (that the code cannot tell them apart IS
 * the lesson). Profile outlines the cell's edge-on slab: a rectangle in x
 * and z, because a side view has no room for the cell's depth — only its
 * column and its storey survive the projection.
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

/** Build the session's scene renderer around an injected raster factory —
 * the real OffscreenCanvas one in the app, a pixel-less fake in node tests
 * (whose null `source` flips layers onto the per-tile command path). */
export function createSceneRenderer(opts: { raster: RasterFactory }): SceneRenderer {
  const { raster } = opts

  // The layer-renderer cache, keyed by layer OBJECT identity — see header
  // point 3 for why identity is the right key and reset() the only eviction.
  const layerRenderers = new Map<TileLayer, LayerRenderer>()

  function rendererFor(doc: World, projection: Projection, layer: TileLayer): LayerRenderer {
    let renderer = layerRenderers.get(layer)
    if (renderer === undefined) {
      renderer = createLayerRenderer({
        layer,
        tileset: tilesetFor(doc, layer),
        projection,
        raster,
        tileSize: doc.settings.tileSize,
      })
      layerRenderers.set(layer, renderer)
    }
    return renderer
  }

  /** One marker: a filled dot at the entity's projected point, name above. */
  function drawMarker(backend: RendererBackend, stack: TransformStack, entity: Entity, point: WorldPoint): void {
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

  /** Stroke one cell's outline in this projection's own geometry. */
  function strokeTile(
    backend: RendererBackend,
    stack: TransformStack,
    tileSize: number,
    tile: PickedTile,
    stroke: string,
    lineWidth: number,
  ): void {
    backend.drawPolyline({
      points: tileOutline(stack.projection, tileSize, tile).map((corner) => stack.worldToScreen(corner)),
      stroke,
      lineWidth,
      closed: true,
    })
  }

  /**
   * The cell grid over the ACTIVE layer's extent, at its elevation — drawn
   * after the world so the lines read as an overlay, not terrain. Straight
   * world lines stay straight under an affine projection∘camera, so each
   * line is two projected endpoints — (width+1) + (height+1) polylines
   * total. In profile the north-running lines collapse to points and the
   * east-running lines pile onto one another: the honest picture of a grid
   * seen edge-on.
   */
  function drawGrid(backend: RendererBackend, doc: World, stack: TransformStack, layer: TileLayer): void {
    const tileSize = doc.settings.tileSize
    const z = layer.elevation
    const worldW = layer.width * tileSize
    const worldH = layer.height * tileSize
    for (let tx = 0; tx <= layer.width; tx += 1) {
      const x = tx * tileSize
      backend.drawPolyline({
        points: [stack.worldToScreen({ x, y: 0, z }), stack.worldToScreen({ x, y: worldH, z })],
        stroke: GRID_STROKE,
        lineWidth: 1,
      })
    }
    for (let ty = 0; ty <= layer.height; ty += 1) {
      const y = ty * tileSize
      backend.drawPolyline({
        points: [stack.worldToScreen({ x: 0, y, z }), stack.worldToScreen({ x: worldW, y, z })],
        stroke: GRID_STROKE,
        lineWidth: 1,
      })
    }
  }

  /**
   * One compass arrow: where a unit world direction lands under THIS
   * projection, normalized to a fixed screen length. The direction goes
   * through projection.project alone — not the camera — because the editor's
   * cameras are axis-aligned POSITIVE scalings (the controller's invariant),
   * which preserve every direction exactly; the projection is the only thing
   * that bends axes, and the only thing the compass teaches.
   *
   * A direction the projection destroys (profile's north lands on (0, 0))
   * draws nothing: an arrow of length zero has no direction to show, and its
   * absence IS the lesson — that lens genuinely cannot see that axis.
   */
  function drawAxisArrow(backend: RendererBackend, direction: Vec2, label: string): void {
    const length = Math.hypot(direction.x, direction.y)
    if (length < 1e-9) return
    const ux = direction.x / length
    const uy = direction.y / length
    const origin = Vec2.make(COMPASS_ORIGIN, COMPASS_ORIGIN)
    const tip = Vec2.make(origin.x + ux * COMPASS_LENGTH, origin.y + uy * COMPASS_LENGTH)
    backend.drawPolyline({ points: [origin, tip], stroke: COMPASS_COLOR, lineWidth: 1.5 })
    // Arrowhead: two short strokes swept back from the tip, built from the
    // unit direction and its perpendicular (−uy, ux) — no trig needed.
    const head = 5
    backend.drawPolyline({
      points: [
        Vec2.make(tip.x - ux * head - uy * head * 0.6, tip.y - uy * head + ux * head * 0.6),
        tip,
        Vec2.make(tip.x - ux * head + uy * head * 0.6, tip.y - uy * head - ux * head * 0.6),
      ],
      stroke: COMPASS_COLOR,
      lineWidth: 1.5,
    })
    backend.drawText({
      x: tip.x + ux * 10,
      y: tip.y + uy * 10,
      text: label,
      fill: COMPASS_COLOR,
      font: LABEL_FONT,
      align: 'center',
      baseline: 'middle',
    })
  }

  return {
    render(backend: RendererBackend, doc: World, stack: TransformStack, size: SceneSize, ui: RenderUi): void {
      if (size.width <= 0 || size.height <= 0) return
      const projection = stack.projection
      const tileSize = doc.settings.tileSize
      const activeLayer = doc.layers.find((layer) => layer.id === ui.activeLayerId)

      backend.beginFrame({ width: size.width, height: size.height, dpr: size.dpr, background: BACKGROUND })

      // Everything through ONE painting queue. Layers open their bands;
      // entities key by projection.depth one band above their support. The
      // sort is total (depth, then id), so the picture depends only on WHAT
      // is in the world — never on iteration accidents.
      const queue: PaintItem[] = []
      for (const layer of doc.layers) {
        const renderer = rendererFor(doc, projection, layer)
        queue.push({
          id: layer.id,
          depth: layer.layerBand * DEPTH_BAND_STRIDE + LAYER_OPENS_BAND,
          paint: () => renderer.draw(backend, stack.camera),
        })
      }
      for (const id of entityIds(doc)) {
        const entity = doc.entities[id]
        if (entity === undefined) continue
        // The preview protocol: a live drag's ghost draws at the override
        // point — including its depth key, so it sorts where it would LAND.
        const point =
          ui.entityOverride !== null && ui.entityOverride.id === id
            ? ui.entityOverride.point
            : entityWorldPoint(entity)
        if (point === null) continue
        queue.push({
          id,
          depth: projection.depth(point, bandAbove(doc, point.z)),
          paint: () => drawMarker(backend, stack, entity, point),
        })
      }
      for (const item of paintersOrder(queue)) item.paint()

      // The grid rides on top of the world, under the pick overlays.
      if (ui.grid && activeLayer !== undefined) drawGrid(backend, doc, stack, activeLayer)

      // Overlays, dimmest first: hover ghost, then the keyboard cursor, then
      // the selection — so a selection is never hidden by the cursor merely
      // passing over it, and the cursor never hides behind its own hover.
      if (ui.hoverTile !== null) {
        strokeTile(backend, stack, tileSize, ui.hoverTile, HOVER_STROKE, 1)
      }
      if (ui.cursorTile !== null) {
        // The cursor lives on the active layer's storey by definition.
        const cursorCell: PickedTile = {
          layerId: activeLayer?.id ?? null,
          tx: ui.cursorTile.tx,
          ty: ui.cursorTile.ty,
          elevation: activeLayer?.elevation ?? 0,
        }
        strokeTile(backend, stack, tileSize, cursorCell, CURSOR_STROKE, 2)
      }
      if (ui.selection !== null) {
        if (ui.selection.kind === 'tile') {
          strokeTile(backend, stack, tileSize, ui.selection.tile, SELECT_STROKE, 2)
        } else {
          const entity = getEntity(doc, ui.selection.id)
          // The ring follows the drag ghost too — a selected entity mid-drag
          // is still the selected entity, wherever it currently appears.
          const point =
            ui.entityOverride !== null && ui.entityOverride.id === ui.selection.id
              ? ui.entityOverride.point
              : entity === undefined
                ? null
                : entityWorldPoint(entity)
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

      // The axis compass, always, on top of everything: permanent "which way
      // is north" furniture (ARCHITECTURE §3), one arrow per ground axis.
      drawAxisArrow(backend, projection.project({ x: 1, y: 0, z: 0 }), 'E')
      drawAxisArrow(backend, projection.project({ x: 0, y: 1, z: 0 }), 'N')

      backend.endFrame()
    },

    reset(): void {
      layerRenderers.clear()
    },
  }
}
