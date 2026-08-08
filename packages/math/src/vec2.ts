/**
 * Vec2 — 2D vectors, the language the whole engine speaks.
 *
 * A vector is just a pair of numbers (x, y), but it plays two roles at once:
 * a POSITION ("the ball is at (3, 2)") and a DISPLACEMENT ("move 3 right and
 * 2 up"). The same arithmetic serves both, which is why one type covers both.
 *
 * Design notes:
 * - Vectors are plain frozen-shape readonly objects, never mutated. Every
 *   operation returns a NEW vector. That makes code easier to reason about
 *   (nobody can change your vector behind your back) and is essential for
 *   deterministic replays.
 * - `Vec2` is both a TypeScript interface (the shape) and a const object (the
 *   toolbox of functions). TypeScript merges the two declarations, so you can
 *   write `const v: Vec2 = Vec2.make(1, 2)` — one name, two facets.
 * - This engine's world space is y-UP, like a math graph: positive y means
 *   "toward the sky". Screens are y-down; a single matrix flips between the
 *   two (see Mat3), so everything in here stays in comfortable math-class
 *   orientation.
 */

import { atan2, cos, sin } from './scalar'

/** A 2D vector: an immutable pair of numbers used for positions and directions. */
export interface Vec2 {
  readonly x: number
  readonly y: number
}

export const Vec2 = {
  /** Build a vector from its two components. The only way vectors are born. */
  make(x: number, y: number): Vec2 {
    return { x, y }
  },

  /**
   * The zero vector (0, 0): the origin as a position, "don't move" as a
   * displacement. It is the identity for addition — adding it changes nothing.
   */
  zero: { x: 0, y: 0 } as Vec2,

  /**
   * Add component-wise: (a.x + b.x, a.y + b.y).
   *
   * Geometrically this chains displacements tip-to-tail: walk along a, then
   * along b, and `add(a, b)` is the single straight walk that lands in the
   * same place. Position + displacement = new position uses the same formula.
   */
  add(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x + b.x, y: a.y + b.y }
  },

  /**
   * Subtract component-wise: (a.x − b.x, a.y − b.y).
   *
   * The most useful reading: `sub(target, source)` is the arrow FROM source
   * TO target — "what displacement takes me from b to a?". Enemy aiming code
   * is one `sub` away from a direction to the player.
   */
  sub(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y }
  },

  /**
   * Multiply both components by a scalar: (v.x·s, v.y·s).
   *
   * Stretches (|s| > 1) or shrinks (|s| < 1) the vector without turning it;
   * a negative s also flips it to point the opposite way. `scale(velocity, dt)`
   * — "how far do we move in dt seconds?" — is the most-run line of physics
   * in any game.
   */
  scale(v: Vec2, s: number): Vec2 {
    return { x: v.x * s, y: v.y * s }
  },

  /** Flip a vector to point the opposite way: (−x, −y). Same as scaling by −1. */
  neg(v: Vec2): Vec2 {
    return { x: -v.x, y: -v.y }
  },

  /**
   * The dot product measures how much two vectors point the same way.
   * Multiply matching parts and add: a·b = a.x·b.x + a.y·b.y.
   * When it is 0 the vectors are perpendicular; when negative they point apart.
   * It is also |a|·|b|·cos(angle) — same number, two stories. We use it for
   * "is this in front of me?" checks and for projecting one vector onto another.
   */
  dot(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y
  },

  /**
   * The 2D cross product: a.x·b.y − a.y·b.x. A single number, not a vector.
   *
   * It is the SIGNED AREA of the parallelogram with sides a and b: positive
   * when b sits counterclockwise of a, negative when clockwise, zero when
   * they are parallel (a squashed-flat parallelogram has no area). That sign
   * is gold: "is point P left or right of my heading?" is one cross product.
   * It is also |a|·|b|·sin(angle) — the partner of the dot product's cosine.
   */
  cross(a: Vec2, b: Vec2): number {
    return a.x * b.y - a.y * b.x
  },

  /**
   * The length (magnitude) of a vector: √(x² + y²).
   *
   * Pure Pythagoras — x and y are the two legs of a right triangle and the
   * vector is its hypotenuse. Costs a square root, which is why lengthSq
   * exists for comparisons.
   */
  length(v: Vec2): number {
    return Math.sqrt(v.x * v.x + v.y * v.y)
  },

  /**
   * The squared length: x² + y², skipping the square root.
   *
   * Why bother? Square roots are (a) slower and (b) unnecessary for
   * comparisons: because squaring preserves order for non-negative numbers,
   * `lengthSq(a) < r·r` answers "is a shorter than r?" exactly as well as
   * `length(a) < r`. Distance checks in hot loops use this trick constantly.
   */
  lengthSq(v: Vec2): number {
    return v.x * v.x + v.y * v.y
  },

  /**
   * Distance between two points: the length of the arrow from b to a.
   *
   * This is Pythagoras again — √((a.x−b.x)² + (a.y−b.y)²) — the straight-line
   * distance across the right triangle whose legs are the horizontal and
   * vertical gaps between the points.
   */
  distance(a: Vec2, b: Vec2): number {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return Math.sqrt(dx * dx + dy * dy)
  },

  /**
   * Shrink or stretch a vector to length 1 while keeping its direction:
   * divide both components by the length. That works because scaling by
   * 1/|v| turns a length-|v| vector into a length-1 one — direction is
   * preserved, magnitude is normalized away. The result is a pure direction,
   * ready to be re-scaled to any speed you like.
   *
   * The zero vector has no direction and dividing 0/0 would give NaN, which
   * silently poisons every calculation it touches. Our documented choice:
   * normalize(zero) = zero. Callers who need to detect the degenerate case
   * can check for a zero result; nobody gets NaN by surprise.
   */
  normalize(v: Vec2): Vec2 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y)
    if (len === 0) return Vec2.zero
    return { x: v.x / len, y: v.y / len }
  },

  /**
   * Rotate a vector 90° counterclockwise (in this engine's y-up world):
   * (x, y) → (−y, x).
   *
   * Derivation: plug a quarter turn into the rotation formula
   * (x·cosθ − y·sinθ, x·sinθ + y·cosθ) with cos 90° = 0, sin 90° = 1 and the
   * trig melts away, leaving (−y, x). No trig calls at runtime — just a swap
   * and a sign flip. Perpendiculars give you wall normals from wall
   * directions, sideways strafe from forward, and the "left of me" axis.
   */
  perp(v: Vec2): Vec2 {
    return { x: -v.y, y: v.x }
  },

  /**
   * The angle a vector points in, measured counterclockwise from the positive
   * x-axis, in radians in (−π, π]. This is atan2(y, x) — see Scalar.atan2 for
   * why atan2 beats atan(y/x): it keeps quadrant information and never
   * divides by zero. Inverse of fromAngle (up to full turns).
   */
  angleOf(v: Vec2): number {
    return atan2(v.y, v.x)
  },

  /**
   * Build a vector pointing `radians` counterclockwise from the positive
   * x-axis, with the given length (default 1).
   *
   * (cos θ, sin θ) is the unit-circle point at angle θ — that is practically
   * the definition of cosine and sine — so scaling it by `length` gives the
   * polar-coordinates vector (r, θ) in x/y form. The inverse pair of
   * angleOf + length.
   */
  fromAngle(radians: number, length = 1): Vec2 {
    return { x: cos(radians) * length, y: sin(radians) * length }
  },

  /**
   * Interpolate each component: the point a fraction t of the way from a to b.
   *
   * Because both components use the same t, the result slides along the
   * straight segment between the two points — this is how we draw the ball
   * BETWEEN physics ticks (t = the clock's alpha) so motion looks smooth even
   * though the simulation moves in discrete steps.
   */
  lerp(a: Vec2, b: Vec2, t: number): Vec2 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  },

  /**
   * "Equal enough" component-wise: both |a.x − b.x| and |a.y − b.y| within
   * epsilon (default 10⁻⁹). Floating-point arithmetic rounds at every step,
   * so exact === comparisons on computed vectors are a trap — see
   * Scalar.approxEquals for the whole story.
   */
  equals(a: Vec2, b: Vec2, epsilon = 1e-9): boolean {
    return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
  },
}
