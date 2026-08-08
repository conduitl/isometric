/**
 * Scalar helpers — the one-number tools everything else is built from.
 *
 * Two ideas live in this file:
 *
 * 1. Small utilities (lerp, clamp, approxEquals) that come up constantly in
 *    games, explained once so nobody has to re-derive them.
 * 2. Wrappers around JavaScript's trig functions (sin, cos, tan, atan2).
 *    These look pointless — they just call Math — but they are a promise:
 *    the ECMAScript spec does not pin down the exact last-bit result of
 *    Math.sin, so two different browsers or CPUs may disagree by a hair.
 *    For replays and cross-machine determinism that hair matters. By routing
 *    every trig call in the engine through this file (ESLint enforces it),
 *    we keep an upgrade path: if we ever need bit-identical trig everywhere,
 *    we swap these bodies for our own polynomial approximations and every
 *    caller is fixed at once. See docs/DECISIONS.md D6.
 */

/**
 * TAU is the number of radians in one full turn: 2π ≈ 6.283185…
 *
 * Radians measure angles by arc length: walk around a circle of radius 1 and
 * the distance you cover IS your angle. A full lap covers the circumference,
 * 2π·r = 2π·1 = TAU. Writing angles as fractions of TAU makes them readable:
 * TAU/4 is a quarter turn, TAU/2 is a half turn, 3·TAU/4 is three quarters.
 * With π you'd have to remember that a quarter turn is π/2 — one mental
 * division more than necessary.
 */
export const TAU: number = Math.PI * 2

/**
 * Linear interpolation: the point a fraction `t` of the way from `a` to `b`.
 *
 * Derivation: the gap between the two values is (b − a). Walking a fraction
 * t of that gap from the start gives a + (b − a)·t. So t = 0 lands on a,
 * t = 1 lands on b, t = 0.5 is the midpoint — and t outside [0, 1] keeps
 * walking in a straight line past either end (extrapolation), which is
 * sometimes exactly what you want.
 *
 * This little formula is the engine's workhorse: it blends animation frames,
 * fades colors, and smooths rendering between physics ticks (that "alpha"
 * value in the Clock is precisely a lerp t).
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Pin `x` into the closed range [min, max].
 *
 * If x is below the floor you get the floor; above the ceiling, the ceiling;
 * otherwise x passes through untouched. Games clamp constantly — health can't
 * go below 0, the camera can't scroll past the edge of the map, a lerp t is
 * often clamped to [0, 1] so an animation stops at its final frame instead of
 * overshooting.
 */
export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x
}

/**
 * "Equal enough" for floating-point numbers: |a − b| ≤ epsilon.
 *
 * Computers store numbers in binary with a fixed number of bits, so most
 * decimals are rounded: famously 0.1 + 0.2 gives 0.30000000000000004, and
 * `0.1 + 0.2 === 0.3` is false. Every arithmetic step can add a rounding
 * error of about one part in 10^16, and errors accumulate. So instead of
 * asking "are these identical?" we ask "are these within a tolerance?" —
 * epsilon (default 10⁻⁹) is that tolerance. Pick it looser than your
 * accumulated rounding error but tighter than any difference you care about.
 */
export function approxEquals(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) <= epsilon
}

/**
 * The sine of `x` radians — the y-coordinate of the point you reach after
 * walking `x` radians counterclockwise around the unit circle from (1, 0).
 *
 * Pass-through wrapper around Math.sin; see the file header for why the
 * engine calls this instead of Math.sin directly (deterministic-approximation
 * upgrade path, docs/DECISIONS.md D6).
 */
export function sin(x: number): number {
  return Math.sin(x)
}

/**
 * The cosine of `x` radians — the x-coordinate of that same point on the
 * unit circle. Together (cos x, sin x) trace the circle, which is why
 * cos²x + sin²x = 1: it's just Pythagoras on a radius-1 triangle.
 *
 * Pass-through wrapper around Math.cos (see file header / DECISIONS.md D6).
 */
export function cos(x: number): number {
  return Math.cos(x)
}

/**
 * The tangent of `x` radians: sin x / cos x — the slope of the line that
 * makes angle x with the positive x-axis. Blows up toward ±∞ near quarter
 * turns, where cos hits 0 (a vertical line has no finite slope).
 *
 * Pass-through wrapper around Math.tan (see file header / DECISIONS.md D6).
 */
export function tan(x: number): number {
  return Math.tan(x)
}

/**
 * The angle of the point (x, y) measured counterclockwise from the positive
 * x-axis, in radians in (−π, π].
 *
 * Why two arguments instead of atan(y/x)? Because y/x throws away which
 * quadrant you are in: (1, 1) and (−1, −1) have the same ratio but point in
 * opposite directions. atan2 keeps the signs of y and x separately, so it can
 * tell all four quadrants apart — and it handles x = 0 without dividing by
 * zero. It is the standard "what direction is this vector facing?" tool.
 *
 * Pass-through wrapper around Math.atan2 (see file header / DECISIONS.md D6).
 */
export function atan2(y: number, x: number): number {
  return Math.atan2(y, x)
}
