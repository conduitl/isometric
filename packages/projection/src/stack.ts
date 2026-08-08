/**
 * The TransformStack — the full world-to-screen pipeline as a named,
 * enumerable, invertible object.
 *
 * A point reaches the screen in exactly two hops:
 *
 *     world (x, y, z) ──projection──▶ view plane (2D) ──camera──▶ screen (CSS px)
 *
 * The projection flattens three numbers to two (see types.ts); the camera
 * is an ordinary Mat3 — pan is its translation, zoom is its scale. Keeping
 * the two hops separate is the point: "every perspective is a different
 * matrix" and "the camera is just a matrix" are two different lessons, and
 * gluing them into one anonymous function would erase both. The Tier-3
 * transform panel is literally a rendering of stages().
 *
 * Going backwards runs the same pipeline mirror-imaged: un-camera the
 * screen point with Mat3.invert (a true inverse — cameras are invertible
 * unless someone zooms to exactly nothing), then un-project with a
 * constraint (a one-number-back inverse — see Projection.inverse). Every
 * editor click takes this walk.
 */

import { Mat3 } from '@engine/math'
import type { Vec2 } from '@engine/math'
import type { InverseConstraint, Projection, WorldPoint } from './types'

/**
 * One named hop of the pipeline, as data for inspectors. A 'matrix' stage
 * carries its Mat3; the 'projection' stage does not — a projection is not a
 * matrix (it eats a third coordinate), which is exactly why it gets its own
 * kind instead of being squeezed into one.
 */
export interface TransformStage {
  readonly name: string
  readonly kind: 'projection' | 'matrix'
  readonly matrix?: Mat3
}

/**
 * The pipeline object. `worldToScreen` composes the two hops forward;
 * `screenToWorld` walks them backwards; `stages()` names them in order for
 * anything that wants to draw or explain the pipeline.
 */
export interface TransformStack {
  readonly projection: Projection
  readonly camera: Mat3
  setCamera(camera: Mat3): void
  worldToScreen(p: WorldPoint): Vec2
  screenToWorld(s: Vec2, c: InverseConstraint): WorldPoint | null
  stages(): readonly TransformStage[]
}

/**
 * Build a TransformStack around a projection and an optional starting
 * camera (default: identity — the view plane IS the screen until someone
 * pans or zooms).
 *
 * `screenToWorld` returns null in two honest cases: the camera cannot be
 * inverted (a zero-scale camera collapsed the screen to a line — there is
 * no "which pixel did you mean" anymore), or the projection rejects the
 * constraint kind (see each factory in projections.ts).
 */
export function createTransformStack(
  projection: Projection,
  camera: Mat3 = Mat3.identity,
): TransformStack {
  let current = camera

  return {
    projection,

    get camera() {
      return current
    },

    setCamera(next: Mat3): void {
      current = next
    },

    worldToScreen(p: WorldPoint): Vec2 {
      // The composition, spelled out: project first, camera second.
      return Mat3.apply(current, projection.project(p))
    },

    screenToWorld(s: Vec2, c: InverseConstraint): WorldPoint | null {
      const inverseCamera = Mat3.invert(current)
      if (inverseCamera === null) return null
      return projection.inverse(Mat3.apply(inverseCamera, s), c)
    },

    stages(): readonly TransformStage[] {
      return [
        { name: 'projection', kind: 'projection' },
        { name: 'camera', kind: 'matrix', matrix: current },
      ]
    },
  }
}

/** Default breathing room between the fitted world and the view edge, in CSS px. */
const DEFAULT_FIT_PADDING = 24

/**
 * Build the camera that frames a world region: "zoom and pan so this box
 * fills the view, with a little breathing room."
 *
 * The method is the lesson in miniature:
 *
 * 1. Push the corners of the world box through the PROJECTION (both bottom
 *    and top of the z range — a tall building sticks out past its
 *    footprint in profile and iso). Eight world corners land as eight
 *    view-plane points; take their bounding box. Only corners need
 *    projecting: linear maps send boxes to shapes whose extremes come from
 *    corners, so if the corners fit, everything between them fits.
 * 2. Choose ONE scale for both axes — the larger of the two would crop, so
 *    take the smaller of width-fit and height-fit. Uniform scale is not
 *    negotiable: unequal sx/sy would silently squash the projection's
 *    carefully-taught shape (a 2:1 diamond must stay 2:1).
 * 3. Translate so the center of the projected bounds sits at the center of
 *    the view: `camera = translation ∘ scaling` — scale first, then shift,
 *    the standard inner-runs-first composition.
 *
 * Degenerate boxes stay honest: a profile view of a flat ground-only world
 * projects to a horizontal line (zero height), so only the width dimension
 * votes on scale; a single point has nothing to fit and gets scale 1.
 */
export function fitCamera(opts: {
  viewWidth: number
  viewHeight: number
  worldMin: Vec2
  worldMax: Vec2
  zRange?: readonly [number, number]
  projection: Projection
  padding?: number
}): Mat3 {
  const { viewWidth, viewHeight, worldMin, worldMax, projection } = opts
  const padding = opts.padding ?? DEFAULT_FIT_PADDING
  const zRange = opts.zRange ?? [0, 0]

  if (!Number.isFinite(viewWidth) || viewWidth <= 0 || !Number.isFinite(viewHeight) || viewHeight <= 0) {
    throw new Error(`fitCamera needs a positive view size, got ${viewWidth}×${viewHeight}`)
  }

  // Step 1: project all eight corners (4 ground corners × 2 z extremes) and
  // collect their view-plane bounding box.
  const groundCorners = [
    { x: worldMin.x, y: worldMin.y },
    { x: worldMax.x, y: worldMin.y },
    { x: worldMin.x, y: worldMax.y },
    { x: worldMax.x, y: worldMax.y },
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const z of zRange) {
    for (const corner of groundCorners) {
      const v = projection.project({ x: corner.x, y: corner.y, z })
      if (v.x < minX) minX = v.x
      if (v.x > maxX) maxX = v.x
      if (v.y < minY) minY = v.y
      if (v.y > maxY) maxY = v.y
    }
  }

  // Step 2: one uniform scale. Each dimension with actual size votes for
  // "how much can I magnify before overflowing?"; the smallest vote wins.
  // Padding shrinks the usable view on all four sides (floored at 1 px so a
  // pathological padding cannot flip the scale negative).
  const availableW = Math.max(viewWidth - 2 * padding, 1)
  const availableH = Math.max(viewHeight - 2 * padding, 1)
  const boundsW = maxX - minX
  const boundsH = maxY - minY
  let scale = Infinity
  if (boundsW > 0) scale = Math.min(scale, availableW / boundsW)
  if (boundsH > 0) scale = Math.min(scale, availableH / boundsH)
  if (!Number.isFinite(scale)) scale = 1 // a single point: nothing to fit, any scale shows it

  // Step 3: send the bounds center to the view center. After scaling, the
  // center sits at scale·(cx, cy); the translation makes up the difference.
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return Mat3.compose(
    Mat3.translation(viewWidth / 2 - scale * cx, viewHeight / 2 - scale * cy),
    Mat3.scaling(scale, scale),
  )
}
