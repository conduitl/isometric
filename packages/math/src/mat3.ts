/**
 * Mat3 — 2D affine transforms: rotate, scale, and translate, all in one object.
 *
 * A transform is a machine that moves points: "rotate 30°, then stretch ×2,
 * then shift right 5". The magic of matrices is that ANY chain of those
 * steps collapses into six numbers, and applying the whole chain to a point
 * costs four multiplies and four adds — no matter how long the chain was.
 *
 * We store the six numbers of the 3×3 matrix
 *
 *        [ a  c  tx ]        x' = a·x + c·y + tx
 *        [ b  d  ty ]   so   y' = b·x + d·y + ty
 *        [ 0  0  1  ]
 *
 * The bottom row is always 0 0 1, so we never store it. Why 3×3 for 2D at
 * all? Translation isn't a linear operation (it moves the origin, and linear
 * maps must keep the origin fixed), but the classic trick of giving every
 * point a third coordinate of 1 smuggles it in: the tx/ty column gets
 * multiplied by that 1 and lands as a plain addition.
 *
 * How to READ the six numbers: the columns say where the basis vectors land.
 * (a, b) is where the x-axis unit vector (1, 0) ends up, (c, d) is where the
 * y-axis unit vector (0, 1) ends up, and (tx, ty) is where the origin ends
 * up. Know those three landing spots and you know the whole transform —
 * every other point just follows along linearly.
 *
 * These are the SAME six numbers, in the SAME order, that the browser's
 * canvas takes in ctx.setTransform(a, b, c, d, tx, ty). When the renderer
 * calls setTransform it is literally handing the browser one of these
 * matrices, and the browser's native code multiplies every point drawn
 * afterwards by it (on the CPU or the GPU — that varies by browser and
 * content). Nothing about canvas transforms is magic — it's the same math
 * as this file, implemented in C++.
 */

import { cos, sin } from './scalar'
import { Vec2 } from './vec2'

/**
 * A 2D affine transform stored as the six meaningful entries of a 3×3
 * matrix (see the file header for the layout). Immutable, like all engine
 * math data — every operation returns a new matrix.
 */
export interface Mat3 {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly tx: number
  readonly ty: number
}

export const Mat3 = {
  /** Build a matrix from its six entries, in ctx.setTransform(a, b, c, d, tx, ty) order. */
  make(a: number, b: number, c: number, d: number, tx: number, ty: number): Mat3 {
    return { a, b, c, d, tx, ty }
  },

  /**
   * The do-nothing transform: x-axis stays (1, 0), y-axis stays (0, 1),
   * origin stays put. Applying it returns every point unchanged, and
   * composing with it changes nothing — it is the "1" of matrix
   * multiplication, and the natural starting point for building up chains.
   */
  identity: Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }) as Mat3,

  /**
   * A pure shift: every point moves by (tx, ty), nothing rotates or
   * stretches. The linear part is the identity (axes stay put); only the
   * origin column moves. This is the transform that can't be written as a
   * 2×2 matrix — the whole reason Mat3 exists (see file header).
   */
  translation(tx: number, ty: number): Mat3 {
    return { a: 1, b: 0, c: 0, d: 1, tx, ty }
  },

  /**
   * Stretch by sx along x and sy along y, keeping the origin fixed:
   * (1, 0) lands on (sx, 0) and (0, 1) lands on (0, sy).
   *
   * Negative factors mirror: scaling(1, −1) is the y-flip that converts
   * between y-up world space and y-down screen space — the famous "find the
   * −1 that flips the graph". A factor of 0 flattens that axis entirely,
   * which is why such a matrix can't be inverted (see invert).
   */
  scaling(sx: number, sy: number): Mat3 {
    return { a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 }
  },

  /**
   * Rotate counterclockwise (in y-up space) by `radians` around the origin.
   *
   * Derivation: rotating the x-axis unit vector (1, 0) by θ lands it on
   * (cos θ, sin θ) — that's the unit-circle definition. The y-axis unit
   * vector (0, 1) starts a quarter turn ahead, so it lands a quarter turn
   * ahead: (−sin θ, cos θ). Put those two landing spots in the columns:
   *
   *        [ cos θ  −sin θ ]
   *        [ sin θ   cos θ ]
   *
   * and every other point follows, because a rotation is linear: x' =
   * x·cos θ − y·sin θ, y' = x·sin θ + y·cos θ.
   */
  rotation(radians: number): Mat3 {
    const c = cos(radians)
    const s = sin(radians)
    return { a: c, b: s, c: -s, d: c, tx: 0, ty: 0 }
  },

  /**
   * Chain two transforms into one: `compose(outer, inner)` applies `inner`
   * FIRST, then `outer` — exactly like function composition f(g(x)), where
   * you read right-to-left. The guarantee that makes everything work:
   *
   *     apply(compose(outer, inner), v) === apply(outer, apply(inner, v))
   *
   * The formula below isn't memorized — it's DERIVED by feeding inner's
   * output into outer's formula and collecting terms. Take x'' = o.a·x' +
   * o.c·y' + o.tx, substitute x' = i.a·x + i.c·y + i.tx and y' = i.b·x +
   * i.d·y + i.ty, expand, and group by x, y, and constant:
   *
   *     x'' = (o.a·i.a + o.c·i.b)·x + (o.a·i.c + o.c·i.d)·y + (o.a·i.tx + o.c·i.ty + o.tx)
   *
   * The coefficient of x is the new `a`, of y the new `c`, the constant the
   * new `tx` — and the y'' row gives b, d, ty the same way. Matrix
   * multiplication IS this substitution, written compactly. This is why a
   * scene graph can multiply a dozen parent transforms into one matrix and
   * still move each point with a single apply.
   */
  compose(outer: Mat3, inner: Mat3): Mat3 {
    return {
      a: outer.a * inner.a + outer.c * inner.b,
      b: outer.b * inner.a + outer.d * inner.b,
      c: outer.a * inner.c + outer.c * inner.d,
      d: outer.b * inner.c + outer.d * inner.d,
      tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
      ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
    }
  },

  /**
   * Run a POINT through the transform:
   *
   *     x' = a·x + c·y + tx
   *     y' = b·x + d·y + ty
   *
   * Read it as "x of where the x-axis landed, plus y of where the y-axis
   * landed, plus where the origin landed" — the point rebuilt from the
   * transformed basis vectors. Points feel translation because they are
   * locations, and locations move when the origin moves.
   */
  apply(m: Mat3, v: Vec2): Vec2 {
    return Vec2.make(m.a * v.x + m.c * v.y + m.tx, m.b * v.x + m.d * v.y + m.ty)
  },

  /**
   * Run a DIRECTION through the transform: same as apply but WITHOUT the
   * + tx / + ty.
   *
   * The lesson: directions don't translate. "North" is still north no matter
   * where you're standing; a velocity of 3 m/s rightward doesn't change
   * because the camera panned. Only the rotate/scale part of the transform
   * touches directions. Using apply on a velocity vector is one of the
   * classic transform bugs — the arrow suddenly contains the camera's
   * position — and this function is how you avoid it.
   */
  applyVector(m: Mat3, v: Vec2): Vec2 {
    return Vec2.make(m.a * v.x + m.c * v.y, m.b * v.x + m.d * v.y)
  },

  /**
   * The determinant a·d − b·c: the AREA SCALE FACTOR of the transform.
   *
   * Why: the unit square (corners at the origin, (1,0), (0,1), (1,1)) maps
   * to the parallelogram with sides (a, b) and (c, d) — the two columns.
   * That parallelogram's signed area is the 2D cross product of the sides,
   * a·d − b·c (see Vec2.cross). Since linear maps treat all regions alike,
   * EVERY shape's area gets multiplied by this same number.
   *
   * The sign carries meaning too: negative means the transform flips
   * orientation (a mirror — one flip, like our y-up→y-down screen matrix),
   * and zero means the plane got squashed to a line or point. Rotations and
   * translations have determinant exactly 1: they move things without
   * changing any area.
   */
  determinant(m: Mat3): number {
    return m.a * m.d - m.b * m.c
  },

  /**
   * The undo transform: `compose(invert(m), m)` is the identity — apply m,
   * then its inverse, and every point is back where it started.
   *
   * Derivation for the linear part: we need the matrix that solves
   * x' = a·x + c·y, y' = b·x + d·y for x and y. Eliminate variables
   * (multiply the first by d, the second by c, subtract) and out pops
   * x = (d·x' − c·y') / det — the familiar swap-a-and-d, negate-b-and-c,
   * divide-everything-by-the-determinant recipe. The translation part then
   * asks "what shift undoes (tx, ty) AFTER un-rotating?" — push (−tx, −ty)
   * through the inverted linear part, giving (c·ty − d·tx)/det and
   * (b·tx − a·ty)/det.
   *
   * Returns null when the transform (nearly) collapsed the plane onto a
   * line. The test is scale-aware, and the quantity it measures is worth
   * knowing: det = |col₁|·|col₂|·sin(angle between the columns), so dividing
   * |det| by the column lengths leaves exactly that sine. Near zero means the
   * two basis vectors landed pointing (almost) the same way — a genuine
   * flattening — regardless of how big or small the matrix is. (A tiny
   * uniform zoom has a tiny determinant but is perfectly undoable, which is
   * why comparing |det| against a fixed cutoff would be wrong.) When the
   * plane collapses, many points share each output, there is no way to know
   * which one you came from, and null says so honestly instead of returning
   * a matrix full of division-by-almost-zero garbage.
   */
  invert(m: Mat3): Mat3 | null {
    const det = m.a * m.d - m.b * m.c
    const colScale = Math.hypot(m.a, m.b) * Math.hypot(m.c, m.d)
    if (Math.abs(det) <= 1e-12 * colScale) return null
    return {
      a: m.d / det,
      b: -m.b / det,
      c: -m.c / det,
      d: m.a / det,
      tx: (m.c * m.ty - m.d * m.tx) / det,
      ty: (m.b * m.tx - m.a * m.ty) / det,
    }
  },

  /**
   * "Equal enough" entry-by-entry: all six entries within epsilon (default
   * 10⁻⁹). Matrices built through different chains of multiplications pick
   * up different rounding errors, so exact comparison is a trap — see
   * Scalar.approxEquals.
   */
  equals(m1: Mat3, m2: Mat3, epsilon = 1e-9): boolean {
    return (
      Math.abs(m1.a - m2.a) <= epsilon &&
      Math.abs(m1.b - m2.b) <= epsilon &&
      Math.abs(m1.c - m2.c) <= epsilon &&
      Math.abs(m1.d - m2.d) <= epsilon &&
      Math.abs(m1.tx - m2.tx) <= epsilon &&
      Math.abs(m1.ty - m2.ty) <= epsilon
    )
  },
}
