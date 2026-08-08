/**
 * The three built-in lenses. One world model — ground plane plus elevation —
 * three ways of flattening it onto a view plane, each an instance of the
 * same formula `view = A·(x, y) + e·z` with different numbers in A and e:
 *
 * | Lens     | A (columns = where east/north land)  | e (one step up) |
 * |----------|--------------------------------------|-----------------|
 * | profile  | (s, 0) and (0, 0) — north VANISHES   | (0, −s)         |
 * | topdown  | (s, 0) and (0, −s) — the y-flip      | (0, 0) — up VANISHES |
 * | iso      | (w/2, h/2) and (w/2, −h/2) — diamonds| (0, −k)         |
 *
 * Every lens throws one world axis away (a 2D picture has no room for
 * three); WHICH axis it sacrifices is what gives each view its character,
 * and recovering the lost number is the whole story of inverse() —
 * see {@link Projection.inverse} in types.ts.
 */

import { Mat3, Vec2 } from '@engine/math'
import type { InverseConstraint, Projection, WorldPoint } from './types'
import { DEPTH_BAND_STRIDE } from './types'

/**
 * Fold a layer band and a within-band value into one composite painter's
 * key: `band · DEPTH_BAND_STRIDE + clampedWithin`.
 *
 * "Bands always dominate" is a theorem with a PRECONDITION: the within-band
 * term must stay strictly inside half a stride in either direction, or a
 * runaway coordinate in band k could leak past the boundary and outdraw
 * band k + 1. Well-formed worlds satisfy that by a mile — the world format's
 * schema caps coordinates far below DEPTH_BAND_STRIDE/2 = 2¹⁹ — but this
 * function cannot see the schema, so it enforces the precondition itself:
 * the within-band term is clamped to ±(DEPTH_BAND_STRIDE/2 − 1) before
 * combining. Defense in depth: a wild coordinate degrades to "pinned at its
 * band's near or far edge" instead of corrupting the band order. The ± half
 * stride convention matches the demo's LAYER_OPENS_BAND = −STRIDE/2: each
 * band owns the open interval (band·STRIDE − STRIDE/2, band·STRIDE +
 * STRIDE/2), and the clamp keeps every key strictly inside its band's
 * interval.
 */
const WITHIN_BAND_LIMIT = DEPTH_BAND_STRIDE / 2 - 1

const bandedDepth = (layerBand: number, within: number): number => {
  const clamped =
    within > WITHIN_BAND_LIMIT
      ? WITHIN_BAND_LIMIT
      : within < -WITHIN_BAND_LIMIT
        ? -WITHIN_BAND_LIMIT
        : within
  return layerBand * DEPTH_BAND_STRIDE + clamped
}

/** Friendly guard: projection dimensions must be positive, finite numbers. */
const assertPositive = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got ${value}`)
  }
}

/**
 * The PROFILE lens — the side-scroller view. x runs across the screen,
 * elevation z runs up it, and the view is edge-on to the ground plane:
 *
 *     project(x, y, z) = (s·x, −s·z)
 *
 * (the −s is the y-flip: world "up" must become screen "less y").
 *
 * Look at what happened to y: the ground matrix's second column is (0, 0),
 * so one step north lands exactly nowhere. A is RANK-DEFICIENT — its
 * determinant is s·0 − 0·0 = 0, the matrix squashes the whole ground plane
 * onto a line, and no inverse matrix exists. That is not a bug to hide; it
 * is THE honest lesson of this view: a side-on camera cannot see depth into
 * the screen. Every side-scroller you have ever played quietly lives with
 * this.
 *
 * inverse(), constraint by constraint:
 * - 'lane' {y}: the constraint hands back the exact number the projection
 *   destroyed. The two view equations solve by simple division —
 *   u = s·x ⟹ x = u/s, and v = −s·z ⟹ z = −v/s — and y is the lane.
 * - 'ground': the same thing with lane y = 0 (the "front" slice).
 * - 'elevation': null. The profile screen already TELLS you z (it is the
 *   vertical axis!), so pinning z again adds no information — the missing
 *   number here is y, and an elevation constraint does not carry one.
 *
 * depth within a band is −y: the camera looks from the south, so SMALLER y
 * (further south, toward the camera) must draw LATER — negating y turns
 * "smaller y" into "bigger key", which is exactly what an ascending
 * painter's sort needs.
 */
export function createProfile(params: { scale?: number } = {}): Projection {
  const s = params.scale ?? 1
  assertPositive('scale', s)

  return {
    name: 'profile',
    params: Object.freeze({ scale: s }),
    // Columns: east → (s, 0); north → (0, 0). det = 0, on purpose — see above.
    ground: Object.freeze(Mat3.make(s, 0, 0, 0, 0, 0)),
    elevation: Object.freeze(Vec2.make(0, -s)),

    project(p: WorldPoint): Vec2 {
      return Vec2.make(s * p.x, -s * p.z)
    },

    inverse(viewPoint: Vec2, constraint: InverseConstraint): WorldPoint | null {
      if (constraint.kind === 'elevation') return null
      const y = constraint.kind === 'lane' ? constraint.y : 0
      return { x: viewPoint.x / s, y, z: -viewPoint.y / s }
    },

    depth(p: WorldPoint, layerBand: number): number {
      return bandedDepth(layerBand, -p.y)
    },
  }
}

/**
 * The TOP-DOWN lens — the bird's-eye view. The ground plane maps straight
 * onto the screen:
 *
 *     project(x, y, z) = (s·x, −s·y)
 *
 * The −s on y is the famous y-flip, taught rather than hidden: world y
 * grows northward (up on a math graph), screen y grows downward, and one
 * −1 in the matrix converts between them. Find the −1 that flips the graph.
 *
 * This time the sacrificed axis is z: the elevation vector is (0, 0), so a
 * bird straight overhead literally cannot see height. (A drop shadow or a
 * scale-with-height effect would be a nonzero e — a knob for later.)
 *
 * inverse(), constraint by constraint:
 * - 'ground': undo the two divisions and the flip — x = u/s, y = −v/s,
 *   z = 0. This is the 2×2 inverse of A done by hand; A is diagonal, so
 *   each equation solves alone.
 * - 'elevation' {z}: same x and y — the view point never depended on z, so
 *   any pinned height gives the same ground spot with that z attached.
 * - 'lane': null. A lane pins y, but the top-down screen already determines
 *   y perfectly well; the number this view is missing is z, and a lane
 *   constraint does not carry one.
 *
 * depth within a band is z: the camera is above, so higher things draw
 * later and sit on top. (Ground detail at equal z resolves by layer bands.)
 */
export function createTopDown(params: { scale?: number } = {}): Projection {
  const s = params.scale ?? 1
  assertPositive('scale', s)

  return {
    name: 'topdown',
    params: Object.freeze({ scale: s }),
    // Columns: east → (s, 0); north → (0, −s). The −s is the y-flip.
    ground: Object.freeze(Mat3.make(s, 0, 0, -s, 0, 0)),
    elevation: Vec2.zero,

    project(p: WorldPoint): Vec2 {
      return Vec2.make(s * p.x, -s * p.y)
    },

    inverse(viewPoint: Vec2, constraint: InverseConstraint): WorldPoint | null {
      if (constraint.kind === 'lane') return null
      const z = constraint.kind === 'elevation' ? constraint.z : 0
      return { x: viewPoint.x / s, y: -viewPoint.y / s, z }
    },

    depth(p: WorldPoint, layerBand: number): number {
      return bandedDepth(layerBand, p.z)
    },
  }
}

/**
 * The ISO lens — 2:1 dimetric, the linear-algebra classroom. A tile is
 * drawn as a diamond twice as wide (w) as it is tall (h), and the ground
 * matrix is nothing more than two basis-vector landing spots:
 *
 *     one step east  → (w/2,  h/2)   (right and DOWN the screen)
 *     one step north → (w/2, −h/2)   (right and UP)
 *
 * Put those columns into A, add elevation sliding points straight up the
 * screen (e = (0, −k)), and the whole familiar iso look falls out:
 *
 *     project(x, y, z) = ( (x + y)·w/2 , (x − y)·h/2 − z·k )
 *
 * WHY this orientation and not its mirror image? Because the world must not
 * flip between windows. Look at A's determinant: (w/2)(−h/2) − (h/2)(w/2) =
 * −w·h/2 — negative, exactly like top-down's −s². A negative determinant
 * means the map reverses winding once — the single honest flip that turns
 * the y-up world into a y-down screen — so a square walked east-then-north
 * keeps the SAME winding on both screens, and a kid's map reads identically
 * in the product's two main windows instead of mirror-reversed. (The
 * mirrored iso, north to the left and det +w·h/2, silently flips every map
 * relative to top-down.) Geometrically this is the camera hovering to the
 * SOUTH-EAST: east runs down-right toward the viewer, north runs up-right
 * away — the natural companion to profile's camera looking in from the
 * south. |det| = w·h/2 is the diamond's area per tile.
 *
 * Why exact halves instead of a "true" 30° isometric? Because w/2 and h/2
 * are exact in floating point and land tiles on whole pixels; true 30°
 * trades that for irrational cos/sin values and shimmering edges. The 2:1
 * diamond is the pragmatic classic.
 *
 * inverse() — derived exactly as a student would, by solving the two view
 * equations for x and y once z is known ('ground' pins z = 0, 'elevation'
 * pins z = constraint.z):
 *
 *     u = (x + y)·w/2                    (view x)
 *     v = (x − y)·h/2 − z·k              (view y)
 *
 * Step 1: z is known, so add its contribution back to v and call the
 * result v′ — the view y the ground pattern alone would have produced:
 *
 *     v′ = v + z·k = (x − y)·h/2
 *
 * Step 2: divide each equation by its half-tile to isolate the sum and
 * difference of the unknowns:
 *
 *     x + y = u / (w/2)      (call it sum)
 *     x − y = v′ / (h/2)     (call it diff)
 *
 * Step 3: add the equations (the y's cancel) and halve; subtract them (the
 * x's cancel) and halve:
 *
 *     x = (sum + diff) / 2
 *     y = (sum − diff) / 2
 *
 * That is a 2×2 matrix inversion done with elimination — |det A| = w·h/2 is
 * never zero for real tile sizes, which is WHY iso picking always succeeds
 * where profile picking cannot.
 *
 * - 'lane': null. Honesty note: with y pinned the algebra WOULD reach x and
 *   then z — but a lane is the profile view's picking story, and every iso
 *   tool knows a height instead (the ground, or the dragged entity's
 *   elevation). v1 keeps each projection's constraint menu matched to its
 *   taught tools rather than shipping an untaught third path.
 *
 * depth within a band is x − y + z — the ordering-relation lesson, read
 * straight off the south-east camera: a step east (+x) or up (+z) moves you
 * TOWARD the viewer, a step north (+y) moves you away, so "how late must
 * this be painted" is x − y + z. Two points with equal keys sit on the same
 * screen row of diamonds and never overlap on a 1-tile footprint (v1's
 * honest restriction; the multi-tile anomaly is a Phase 5 lesson). The
 * depth story leans on k > 0 — climbing must move a point up the SCREEN and
 * nearer in DEPTH together — which is why zScale is required positive like
 * every other dimension.
 */
export function createIso(
  params: { tileWidth?: number; tileHeight?: number; zScale?: number } = {},
): Projection {
  const w = params.tileWidth ?? 2
  const h = params.tileHeight ?? 1
  const k = params.zScale ?? 1
  assertPositive('tileWidth', w)
  assertPositive('tileHeight', h)
  assertPositive('zScale', k)

  const halfW = w / 2
  const halfH = h / 2

  return {
    name: 'iso',
    params: Object.freeze({ tileWidth: w, tileHeight: h, zScale: k }),
    // Columns: east → (w/2, h/2); north → (w/2, −h/2). det = −w·h/2 —
    // negative like top-down's, so the two views agree on winding.
    ground: Object.freeze(Mat3.make(halfW, halfH, halfW, -halfH, 0, 0)),
    elevation: Object.freeze(Vec2.make(0, -k)),

    project(p: WorldPoint): Vec2 {
      return Vec2.make((p.x + p.y) * halfW, (p.x - p.y) * halfH - p.z * k)
    },

    inverse(viewPoint: Vec2, constraint: InverseConstraint): WorldPoint | null {
      if (constraint.kind === 'lane') return null
      const z = constraint.kind === 'elevation' ? constraint.z : 0
      // The derivation from the doc comment, line for line.
      const vPrime = viewPoint.y + z * k
      const sum = viewPoint.x / halfW
      const diff = vPrime / halfH
      return { x: (sum + diff) / 2, y: (sum - diff) / 2, z }
    },

    depth(p: WorldPoint, layerBand: number): number {
      return bandedDepth(layerBand, p.x - p.y + p.z)
    },
  }
}
