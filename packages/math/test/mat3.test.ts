import { describe, expect, it } from 'vitest'
import type { Rng } from '../src/index'
import { createRng, Mat3, Scalar, Vec2 } from '../src/index'

const CASES = 200

/** A random affine transform: linear entries in [-4, 4), translation in [-10, 10). */
const randomMat = (rng: Rng): Mat3 =>
  Mat3.make(
    rng.range(-4, 4),
    rng.range(-4, 4),
    rng.range(-4, 4),
    rng.range(-4, 4),
    rng.range(-10, 10),
    rng.range(-10, 10),
  )

/** A random point with components in [-50, 50). */
const randomVec = (rng: Rng): Vec2 => Vec2.make(rng.range(-50, 50), rng.range(-50, 50))

describe('Mat3 constructors', () => {
  it('identity leaves every point untouched', () => {
    const rng = createRng(301)
    for (let k = 0; k < 20; k++) {
      const v = randomVec(rng)
      expect(Vec2.equals(Mat3.apply(Mat3.identity, v), v)).toBe(true)
    }
  })

  it("apply follows the documented formula: x' = a·x + c·y + tx", () => {
    const m = Mat3.make(2, 3, 5, 7, 11, 13)
    const v = Vec2.make(1, 10)
    // x' = 2·1 + 5·10 + 11 = 63 ; y' = 3·1 + 7·10 + 13 = 86
    expect(Mat3.apply(m, v)).toEqual({ x: 63, y: 86 })
  })

  it('translation shifts points by exactly (tx, ty)', () => {
    const m = Mat3.translation(5, -3)
    expect(Mat3.apply(m, Vec2.make(1, 2))).toEqual({ x: 6, y: -1 })
  })

  it('scaling stretches each axis independently; scaling(1, -1) is the y-flip', () => {
    expect(Mat3.apply(Mat3.scaling(2, 3), Vec2.make(4, 5))).toEqual({ x: 8, y: 15 })
    expect(Mat3.apply(Mat3.scaling(1, -1), Vec2.make(4, 5))).toEqual({ x: 4, y: -5 })
  })

  it('rotation by a quarter turn sends (1,0) to (0,1) — counterclockwise in y-up', () => {
    const quarter = Mat3.rotation(Scalar.TAU / 4)
    const landed = Mat3.apply(quarter, Vec2.make(1, 0))
    expect(Vec2.equals(landed, Vec2.make(0, 1), 1e-12)).toBe(true)
  })
})

describe('Mat3.compose', () => {
  it('property: apply(compose(o, i), v) === apply(o, apply(i, v))', () => {
    const rng = createRng(302)
    for (let k = 0; k < CASES; k++) {
      const outer = randomMat(rng)
      const inner = randomMat(rng)
      const v = randomVec(rng)
      const once = Mat3.apply(Mat3.compose(outer, inner), v)
      const twice = Mat3.apply(outer, Mat3.apply(inner, v))
      expect(Vec2.equals(once, twice, 1e-8)).toBe(true)
    }
  })

  it('inner runs first: translate-then-scale differs from scale-then-translate', () => {
    const scale = Mat3.scaling(2, 2)
    const shift = Mat3.translation(10, 0)
    const p = Vec2.zero
    // compose(scale, shift): shift to (10,0) first, THEN double it -> (20,0).
    expect(Mat3.apply(Mat3.compose(scale, shift), p)).toEqual({ x: 20, y: 0 })
    // compose(shift, scale): doubling 0 does nothing, then shift -> (10,0).
    expect(Mat3.apply(Mat3.compose(shift, scale), p)).toEqual({ x: 10, y: 0 })
  })

  it('composing with identity changes nothing', () => {
    const rng = createRng(303)
    for (let k = 0; k < 20; k++) {
      const m = randomMat(rng)
      expect(Mat3.equals(Mat3.compose(m, Mat3.identity), m)).toBe(true)
      expect(Mat3.equals(Mat3.compose(Mat3.identity, m), m)).toBe(true)
    }
  })
})

describe('Mat3.applyVector — directions do not translate', () => {
  it('property: translation moves points but applyVector ignores it', () => {
    const rng = createRng(304)
    for (let k = 0; k < CASES; k++) {
      const shift = Mat3.translation(rng.range(-100, 100), rng.range(-100, 100))
      const v = randomVec(rng)
      const asPoint = Mat3.apply(shift, v)
      const asDirection = Mat3.applyVector(shift, v)
      // The point moved by exactly the translation...
      expect(Vec2.equals(asPoint, Vec2.make(v.x + shift.tx, v.y + shift.ty))).toBe(true)
      // ...the direction did not move at all.
      expect(Vec2.equals(asDirection, v)).toBe(true)
    }
  })

  it('applyVector still feels rotation and scale', () => {
    const m = Mat3.compose(Mat3.translation(100, 200), Mat3.scaling(2, 2))
    expect(Mat3.applyVector(m, Vec2.make(3, 4))).toEqual({ x: 6, y: 8 })
  })
})

describe('Mat3.rotation preserves length', () => {
  it('property: |rotation(θ)·v| = |v| — rotations are rigid', () => {
    const rng = createRng(305)
    for (let k = 0; k < CASES; k++) {
      const theta = rng.range(-Scalar.TAU, Scalar.TAU)
      const v = randomVec(rng)
      const rotated = Mat3.apply(Mat3.rotation(theta), v)
      expect(Vec2.length(rotated)).toBeCloseTo(Vec2.length(v), 9)
    }
  })

  it('property: rotation has determinant 1 — it changes no areas', () => {
    const rng = createRng(306)
    for (let k = 0; k < CASES; k++) {
      const theta = rng.range(-Scalar.TAU, Scalar.TAU)
      expect(Mat3.determinant(Mat3.rotation(theta))).toBeCloseTo(1, 12)
    }
  })
})

describe('Mat3.determinant', () => {
  it('scaling(sx, sy) scales areas by sx·sy', () => {
    expect(Mat3.determinant(Mat3.scaling(2, 3))).toBe(6)
    // A single mirror flips orientation: negative determinant.
    expect(Mat3.determinant(Mat3.scaling(1, -1))).toBe(-1)
  })

  it('translations have determinant 1 — shifting changes no areas', () => {
    expect(Mat3.determinant(Mat3.translation(123, -456))).toBe(1)
  })

  it('property: det(compose(o, i)) = det(o)·det(i) — area factors multiply', () => {
    const rng = createRng(307)
    for (let k = 0; k < CASES; k++) {
      const o = randomMat(rng)
      const i = randomMat(rng)
      expect(Mat3.determinant(Mat3.compose(o, i))).toBeCloseTo(
        Mat3.determinant(o) * Mat3.determinant(i),
        6,
      )
    }
  })
})

describe('Mat3.invert', () => {
  it('property: compose(invert(m), m) round-trips to identity', () => {
    const rng = createRng(308)
    let tested = 0
    for (let k = 0; k < CASES; k++) {
      const m = randomMat(rng)
      if (Math.abs(Mat3.determinant(m)) < 1e-6) continue // nearly-collapsed: skip
      const inv = Mat3.invert(m)
      expect(inv).not.toBeNull()
      if (inv === null) continue
      expect(Mat3.equals(Mat3.compose(inv, m), Mat3.identity, 1e-6)).toBe(true)
      expect(Mat3.equals(Mat3.compose(m, inv), Mat3.identity, 1e-6)).toBe(true)
      tested++
    }
    // Random 4-wide entries almost never land near det 0 — make sure we really tested.
    expect(tested).toBeGreaterThan(CASES * 0.9)
  })

  it('property: inverting undoes apply — points come home', () => {
    const rng = createRng(309)
    for (let k = 0; k < CASES; k++) {
      const m = randomMat(rng)
      if (Math.abs(Mat3.determinant(m)) < 1e-6) continue
      const inv = Mat3.invert(m)
      if (inv === null) continue
      const v = randomVec(rng)
      const home = Mat3.apply(inv, Mat3.apply(m, v))
      expect(Vec2.equals(home, v, 1e-6)).toBe(true)
    }
  })

  it('returns null for a rank-deficient matrix: scaling(1, 0) collapses y', () => {
    expect(Mat3.invert(Mat3.scaling(1, 0))).toBeNull()
    expect(Mat3.invert(Mat3.scaling(0, 0))).toBeNull()
    // A shear-like matrix whose columns are parallel is just as unrecoverable.
    expect(Mat3.invert(Mat3.make(2, 4, 1, 2, 5, 5))).toBeNull()
  })

  it('inverts the known simple transforms to their obvious opposites', () => {
    const inv = Mat3.invert(Mat3.translation(5, -3))
    expect(inv).not.toBeNull()
    if (inv !== null) expect(Mat3.equals(inv, Mat3.translation(-5, 3))).toBe(true)

    const invScale = Mat3.invert(Mat3.scaling(2, 4))
    expect(invScale).not.toBeNull()
    if (invScale !== null) expect(Mat3.equals(invScale, Mat3.scaling(0.5, 0.25))).toBe(true)
  })
})

describe('Mat3.equals', () => {
  it('tolerates epsilon-sized differences and rejects larger ones', () => {
    const m = Mat3.make(1, 2, 3, 4, 5, 6)
    const nearly = Mat3.make(1 + 1e-12, 2, 3, 4, 5, 6)
    const off = Mat3.make(1.01, 2, 3, 4, 5, 6)
    expect(Mat3.equals(m, nearly)).toBe(true)
    expect(Mat3.equals(m, off)).toBe(false)
    expect(Mat3.equals(m, off, 0.1)).toBe(true)
  })
})

describe('the worldToScreen pattern (the y-flip lesson, end to end)', () => {
  it('maps a y-up world onto a y-down screen with one composed matrix', () => {
    // A 16m-wide world drawn into an 800px-wide view: 50px per meter,
    // origin at the bottom-left of a 450px-tall canvas.
    const worldToScreen = Mat3.compose(Mat3.translation(0, 450), Mat3.scaling(50, -50))
    // The world origin lands at the bottom-left corner...
    expect(Mat3.apply(worldToScreen, Vec2.zero)).toEqual({ x: 0, y: 450 })
    // ...and going UP one meter in the world goes UP the screen (smaller y).
    expect(Mat3.apply(worldToScreen, Vec2.make(0, 1))).toEqual({ x: 0, y: 400 })
    // Round-trip: screen back to world.
    const screenToWorld = Mat3.invert(worldToScreen)
    expect(screenToWorld).not.toBeNull()
    if (screenToWorld !== null) {
      const back = Mat3.apply(screenToWorld, Vec2.make(400, 225))
      expect(Vec2.equals(back, Vec2.make(8, 4.5), 1e-9)).toBe(true)
    }
  })
})
