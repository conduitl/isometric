/**
 * Projection as DATA — the idea this whole package exists to teach.
 *
 * Every game that draws a 3-ish-D world on a flat screen answers one
 * question: "where does the world point (x, y, z) land?" Most engines bury
 * the answer inside a render function. Here the answer IS an object you can
 * open: a Projection carries its ground matrix `A` and its elevation vector
 * `e` as plain inspectable fields, and projecting is the one-line formula
 *
 *     view = A·(x, y) + e·z
 *
 * `A` is a 2×2 linear map (stored as a Mat3 with zero translation, the same
 * six-number format the whole engine speaks). Read it the way Mat3 teaches:
 * columns are landing spots. The first column of A is where one step EAST
 * shows up, the second column is where one step NORTH shows up, and `e` is
 * where one step UP shows up. Know those three landing spots and you know
 * the entire projection — every other point follows linearly.
 *
 * ## The three named spaces
 *
 * - WORLD: x = east, y = north, z = up (elevation), in world units — the
 *   y-up math-class space of docs/ARCHITECTURE.md §3.
 * - VIEW PLANE: the flat 2D space a projection lands points in. It is
 *   already y-down like a screen, but no camera has touched it yet. There
 *   is no single magic −1 that does the flipping — each lens negates
 *   whichever world direction must read "up" on ITS screen, and the sign
 *   lives wherever that direction lives. Top-down flips north inside its
 *   ground matrix (the −s in the second column); profile flips elevation
 *   inside its e vector, (0, −s); iso does both — the −h/2 in its ground
 *   matrix sends north up-screen, and its e = (0, −k) sends elevation
 *   up-screen. Each factory in projections.ts points out its own flip.
 * - SCREEN: the view plane pushed through the camera matrix; CSS pixels.
 *
 * That split is itself the lesson: `screen = camera ∘ projection`, and each
 * half stays a separate, inspectable, invertible object (see stack.ts).
 */

import type { Mat3, Vec2 } from '@engine/math'

/**
 * A point in WORLD space: x east, y north, z up, in world units. Three
 * numbers, not two, because the world genuinely has elevation even though
 * every projection must eventually flatten it onto a 2D view — that tension
 * is what {@link Projection.inverse} is about.
 */
export interface WorldPoint {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** The three built-in lenses. More projections are possible later — a projection is only data. */
export type ProjectionName = 'profile' | 'topdown' | 'iso'

/**
 * The "one number back" that makes picking solvable (see
 * {@link Projection.inverse} for the full story). Each kind pins one world
 * quantity so the other two can be recovered from a 2D view point:
 *
 * - `ground`: pin the one world number this view cannot see to 0. For
 *   top-down and iso that means z = 0 — the click landed on the ground
 *   plane. Profile is the honest exception: its screen already SHOWS z, and
 *   what it cannot see is y, so `ground` there pins y = 0 (the front lane)
 *   and the returned point carries whatever z the click height says — which
 *   may well be nonzero. The default for every placement tool either way.
 * - `elevation`: assume a known height — typically the elevation of the
 *   entity being dragged, so it slides along its own storey.
 * - `lane`: assume a known y (a north–south slice of the world). This is the
 *   profile view's constraint, where the screen shows x and z but the lane
 *   you are standing in is invisible.
 */
export type InverseConstraint =
  | { readonly kind: 'ground' }
  | { readonly kind: 'elevation'; readonly z: number }
  | { readonly kind: 'lane'; readonly y: number }

/**
 * A projection, reified. The `ground` matrix and `elevation` vector are not
 * documentation of what `project` does — they ARE what it does, and the
 * inspector shows them raw. `project` computes A·(x, y) + e·z; `inverse`
 * walks it backwards; `depth` turns a world point into a painter's sort key.
 */
export interface Projection {
  readonly name: ProjectionName

  /**
   * The named knobs this projection was built from (scale, tileWidth, …) —
   * kept as data so an inspector can show them and a file can store them.
   */
  readonly params: Readonly<Record<string, number>>

  /**
   * `A` — the ground-plane linear map, as a Mat3 with tx = ty = 0. Its
   * columns are where the east and north axes land on the view plane.
   */
  readonly ground: Mat3

  /** `e` — where one unit of elevation moves the view-plane point. */
  readonly elevation: Vec2

  /** World to view plane: A·(x, y) + e·z. The camera is applied later, elsewhere. */
  project(p: WorldPoint): Vec2

  /**
   * Picking is the inverse walk — with an honest twist.
   *
   * `project` eats three numbers (x, y, z) and returns two. Information is
   * destroyed on the way, so no formula can climb back up alone: **two
   * numbers in, three numbers out needs one number back.** The constraint
   * is that number — "assume the ground" (z = 0 in top-down/iso; y = 0 in
   * profile, whose screen already shows z), "assume this height" (a dragged
   * entity's elevation), or "assume this lane" (profile's y).
   * With one world quantity pinned, the remaining two fall out of plain
   * linear algebra that each factory derives in its doc comment. The same
   * idea, one dimension up, is why 3D engines pick with rays: a 2D click
   * into a 3D world is short a number there too.
   *
   * Returns null when THIS projection cannot use the given constraint kind —
   * not an error, a fact about the geometry. Each factory in projections.ts
   * documents exactly which constraints it accepts and why the others are
   * meaningless for it.
   */
  inverse(viewPoint: Vec2, constraint: InverseConstraint): WorldPoint | null

  /**
   * The painter's sort key: draw in ascending `depth` order and nearer
   * things correctly cover farther things (back-to-front, like paint on a
   * canvas). Each projection defines "nearer" differently — that per-view
   * ordering relation is a lesson, spelled out in each factory. The
   * `layerBand` folds in as `layerBand · DEPTH_BAND_STRIDE + withinBand`,
   * with the within-band term clamped to half a stride so bands always
   * dominate (see {@link DEPTH_BAND_STRIDE} for the precondition story).
   */
  depth(p: WorldPoint, layerBand: number): number
}

/**
 * How far apart layer bands sit in the composite depth key:
 *
 *     depth = layerBand · DEPTH_BAND_STRIDE + withinBand
 *
 * A band is a coarse, author-controlled storey — "the ground layer draws
 * before the object layer, ALWAYS." For that ALWAYS to hold inside a single
 * sortable number, the band term must dominate: the smallest key in band
 * k+1 must beat the largest key in band k no matter what the within-band
 * values are. That is a theorem with a stated PRECONDITION, not a free
 * lunch: |withinBand| < DEPTH_BAND_STRIDE/2, so each band owns its own
 * half-stride of room on either side of band · STRIDE and no band can
 * reach into its neighbor. Two guarantees uphold it. First, the depth
 * implementations clamp the within-band term to ±(DEPTH_BAND_STRIDE/2 − 1)
 * before combining — so even a wild coordinate pins to its band's edge
 * instead of leaking across. Second, band indexes themselves are bounded by
 * the world format's schema caps, which keeps the composite key an exact
 * integer-scale double (doubles are exact up to 2⁵³; band · 2²⁰ ± half a
 * stride is not even close). Within-band keys are world coordinates (−y, z,
 * or x − y + z), and real worlds sit in the low thousands — the clamp is
 * defense-in-depth, not the expected path.
 *
 * Why fold two values into one number at all, instead of comparing (band,
 * withinBand) pairs? Because a painter's key promises the inspector a single
 * comparable number you can print beside every entity and reason about.
 */
export const DEPTH_BAND_STRIDE: number = 2 ** 20
