/**
 * Scene-figure rendering — the engine drawing pictures INSIDE the lesson.
 *
 * A lesson step's `scene` figure (types in @engine/tutorial) names a fixture
 * world, a projection, and optional lens overlays; this module turns that
 * data into pixels using the exact machinery the editor viewport runs — the
 * same fixture builders (fixtures.ts), the same default projections the
 * session constructs, the same scene renderer (render.ts), the same lens
 * overlay code. That sameness is the figure's honesty guarantee: when a
 * caption says "legs 3 and 4, distance 5", the right-triangle in the picture
 * MEASURED those numbers from the fixture's marker positions, through the
 * same `worldToScreen` a student's own crate travels.
 *
 * Deliberately still: one draw per call, no rAF loop, no camera state — the
 * camera refits to frame the whole fixture at every draw, because a figure
 * is a framed illustration, not a viewport (the docs site's ProjectionDemo
 * set this precedent). An unknown fixture id attaches nothing — quietly,
 * like a missing anchor: the lesson keeps working on prose alone.
 */

import { Vec2 } from '@engine/math'
import { createIso, createProfile, createTopDown, createTransformStack, fitCamera } from '@engine/projection'
import type { Projection } from '@engine/projection'
import { createCanvas2dBackend } from '@engine/renderer-canvas2d'
import { createOffscreenRasterFactory } from '@engine/tilemap'
import type { LensOverlaySpec, ViewProjectionName } from '@engine/tutorial'
import { fitZRange } from '../camera'
import { FIXTURES } from '../fixtures'
import { createSceneRenderer } from '../render'
import type { SceneSize } from '../render'

/** What a scene figure needs from lesson data (the `scene` arm of
 * StepFigure, minus presentation-only text). */
export interface SceneFigureData {
  readonly fixture: string
  readonly projection: ViewProjectionName
  readonly overlays?: ReadonlyArray<LensOverlaySpec>
}

/** The same default projections the session constructs for the viewport —
 * a figure must show the very matrices the editor uses, not near-twins. */
function projectionFor(name: ViewProjectionName): Projection {
  switch (name) {
    case 'topdown':
      return createTopDown()
    case 'iso':
      return createIso()
    case 'profile':
      return createProfile()
  }
}

/**
 * Bind a scene figure to a canvas. Returns a draw function the owner calls
 * whenever the canvas has (new) room — mount and resize — or null when the
 * fixture id resolves to nothing (draw NO picture, never a wrong one).
 *
 * The fixture document and the layer-raster cache live inside the closure:
 * built once, redrawn cheaply at every size. Nothing here needs disposing —
 * dropping the closure drops the caches.
 */
export function attachSceneFigure(
  canvas: HTMLCanvasElement,
  figure: SceneFigureData,
): ((size: SceneSize) => void) | null {
  const build = FIXTURES[figure.fixture]
  if (build === undefined) return null

  const doc = build()
  const projection = projectionFor(figure.projection)
  const backend = createCanvas2dBackend(canvas)
  const renderer = createSceneRenderer({ raster: createOffscreenRasterFactory() })
  const overlays = figure.overlays ?? []

  // The fixture's ground footprint, largest layer deciding — the same
  // fitting box the viewport camera uses.
  const tileSize = doc.settings.tileSize
  let worldW = 0
  let worldH = 0
  for (const layer of doc.layers) {
    worldW = Math.max(worldW, layer.width * tileSize)
    worldH = Math.max(worldH, layer.height * tileSize)
  }

  return (size: SceneSize): void => {
    if (size.width <= 0 || size.height <= 0) return
    const camera = fitCamera({
      viewWidth: size.width,
      viewHeight: size.height,
      worldMin: Vec2.zero,
      worldMax: Vec2.make(worldW, worldH),
      zRange: fitZRange(doc),
      projection,
    })
    const stack = createTransformStack(projection, camera)
    renderer.render(backend, doc, stack, size, {
      selection: null,
      hoverTile: null,
      cursorTile: null,
      entityOverride: null,
      // The grid rides along on the ground layer: figures are counting
      // pictures, and countable cells need visible seams.
      activeLayerId: doc.layers[0]?.id ?? null,
      grid: true,
      overlays,
    })
  }
}
