import { describe, expect, it } from 'vitest'
import type { Rng } from '../src/index'
import { createRng, Scalar, Vec2 } from '../src/index'

const CASES = 200

/** A random vector with components in [-100, 100). */
const randomVec = (rng: Rng): Vec2 => Vec2.make(rng.range(-100, 100), rng.range(-100, 100))

describe('Vec2 basics', () => {
  it('make stores components; zero is the origin', () => {
    const v = Vec2.make(3, -2)
    expect(v.x).toBe(3)
    expect(v.y).toBe(-2)
    expect(Vec2.zero).toEqual({ x: 0, y: 0 })
  })

  it('add / sub / scale / neg do component-wise arithmetic', () => {
    const a = Vec2.make(1, 2)
    const b = Vec2.make(10, -5)
    expect(Vec2.add(a, b)).toEqual({ x: 11, y: -3 })
    expect(Vec2.sub(a, b)).toEqual({ x: -9, y: 7 })
    expect(Vec2.scale(a, 3)).toEqual({ x: 3, y: 6 })
    expect(Vec2.neg(a)).toEqual({ x: -1, y: -2 })
  })

  it('operations return new vectors and never mutate inputs', () => {
    const a = Vec2.make(1, 2)
    Vec2.add(a, Vec2.make(5, 5))
    Vec2.scale(a, 10)
    expect(a).toEqual({ x: 1, y: 2 })
  })

  it('sub(target, source) points from source to target', () => {
    const player = Vec2.make(4, 3)
    const enemy = Vec2.make(1, 1)
    expect(Vec2.sub(player, enemy)).toEqual({ x: 3, y: 2 })
  })
})

describe('Vec2 dot and cross', () => {
  it('dot is 0 for perpendicular, positive for aligned, negative for opposed', () => {
    expect(Vec2.dot(Vec2.make(1, 0), Vec2.make(0, 1))).toBe(0)
    expect(Vec2.dot(Vec2.make(1, 0), Vec2.make(2, 1))).toBeGreaterThan(0)
    expect(Vec2.dot(Vec2.make(1, 0), Vec2.make(-2, 1))).toBeLessThan(0)
  })

  it('cross gives the signed area: + when b is counterclockwise of a', () => {
    // Unit square: sides (1,0) and (0,1), area 1, counterclockwise.
    expect(Vec2.cross(Vec2.make(1, 0), Vec2.make(0, 1))).toBe(1)
    // Swap the sides and the orientation flips.
    expect(Vec2.cross(Vec2.make(0, 1), Vec2.make(1, 0))).toBe(-1)
    // Parallel sides: a squashed parallelogram has zero area.
    expect(Vec2.cross(Vec2.make(2, 4), Vec2.make(1, 2))).toBe(0)
  })

  it('property: dot(v, perp(v)) = 0 — a vector is perpendicular to its perp', () => {
    const rng = createRng(201)
    for (let k = 0; k < CASES; k++) {
      const v = randomVec(rng)
      // Exact zero, not approximate: x·(−y) + y·x cancels perfectly even in floating point.
      expect(Vec2.dot(v, Vec2.perp(v))).toBe(0)
    }
  })

  it('property: dot matches |a||b|cos and cross matches |a||b|sin of the angle between', () => {
    const rng = createRng(202)
    for (let k = 0; k < CASES; k++) {
      const a = randomVec(rng)
      const b = randomVec(rng)
      const angle = Vec2.angleOf(b) - Vec2.angleOf(a)
      const scale = Vec2.length(a) * Vec2.length(b)
      expect(Vec2.dot(a, b)).toBeCloseTo(scale * Scalar.cos(angle), 6)
      expect(Vec2.cross(a, b)).toBeCloseTo(scale * Scalar.sin(angle), 6)
    }
  })
})

describe('Vec2 length and distance', () => {
  it('length is Pythagoras: the 3-4-5 triangle', () => {
    expect(Vec2.length(Vec2.make(3, 4))).toBe(5)
    expect(Vec2.lengthSq(Vec2.make(3, 4))).toBe(25)
  })

  it('distance is the length of the difference', () => {
    expect(Vec2.distance(Vec2.make(4, 6), Vec2.make(1, 2))).toBe(5)
    expect(Vec2.distance(Vec2.make(7, 7), Vec2.make(7, 7))).toBe(0)
  })

  it('property: lengthSq comparisons agree with length comparisons', () => {
    const rng = createRng(203)
    for (let k = 0; k < CASES; k++) {
      const a = randomVec(rng)
      const b = randomVec(rng)
      expect(Vec2.lengthSq(a) < Vec2.lengthSq(b)).toBe(Vec2.length(a) < Vec2.length(b))
    }
  })
})

describe('Vec2.normalize', () => {
  it('property: non-zero vectors normalize to length 1, direction preserved', () => {
    const rng = createRng(204)
    for (let k = 0; k < CASES; k++) {
      const v = randomVec(rng)
      if (Vec2.length(v) < 1e-6) continue
      const n = Vec2.normalize(v)
      expect(Vec2.length(n)).toBeCloseTo(1, 9)
      // Same direction: n scaled back up by |v| recovers v.
      expect(Vec2.equals(Vec2.scale(n, Vec2.length(v)), v, 1e-9)).toBe(true)
    }
  })

  it('normalize(zero) is zero — the documented no-NaN choice', () => {
    const n = Vec2.normalize(Vec2.zero)
    expect(n).toEqual({ x: 0, y: 0 })
    expect(Number.isNaN(n.x)).toBe(false)
  })
})

describe('Vec2.perp', () => {
  it('rotates 90° counterclockwise: (1,0) -> (0,1) -> (-1,0) -> (0,-1)', () => {
    // Vec2.equals, not toEqual: negating y=0 gives IEEE's -0, which is === 0
    // but not Object.is-equal to it. The math is right; the bit pattern differs.
    expect(Vec2.equals(Vec2.perp(Vec2.make(1, 0)), Vec2.make(0, 1))).toBe(true)
    expect(Vec2.equals(Vec2.perp(Vec2.make(0, 1)), Vec2.make(-1, 0))).toBe(true)
    expect(Vec2.equals(Vec2.perp(Vec2.make(-1, 0)), Vec2.make(0, -1))).toBe(true)
  })

  it('property: perp preserves length, and four perps return home', () => {
    const rng = createRng(205)
    for (let k = 0; k < CASES; k++) {
      const v = randomVec(rng)
      expect(Vec2.length(Vec2.perp(v))).toBeCloseTo(Vec2.length(v), 9)
      const around = Vec2.perp(Vec2.perp(Vec2.perp(Vec2.perp(v))))
      expect(Vec2.equals(around, v)).toBe(true)
    }
  })
})

describe('Vec2 angles', () => {
  it('angleOf reads direction from the positive x-axis, counterclockwise', () => {
    expect(Vec2.angleOf(Vec2.make(1, 0))).toBe(0)
    expect(Vec2.angleOf(Vec2.make(0, 1))).toBeCloseTo(Scalar.TAU / 4, 12)
    expect(Vec2.angleOf(Vec2.make(-1, 0))).toBeCloseTo(Scalar.TAU / 2, 12)
  })

  it('fromAngle defaults to length 1', () => {
    expect(Vec2.length(Vec2.fromAngle(1.234))).toBeCloseTo(1, 12)
    expect(Vec2.fromAngle(0)).toEqual({ x: 1, y: 0 })
  })

  it('property: fromAngle(angleOf(v), length(v)) rebuilds v', () => {
    const rng = createRng(206)
    for (let k = 0; k < CASES; k++) {
      const v = randomVec(rng)
      if (Vec2.length(v) < 1e-6) continue
      const rebuilt = Vec2.fromAngle(Vec2.angleOf(v), Vec2.length(v))
      expect(Vec2.equals(rebuilt, v, 1e-7)).toBe(true)
    }
  })
})

describe('Vec2.lerp', () => {
  it('hits a at t=0, b at t=1, the midpoint at t=0.5', () => {
    const a = Vec2.make(0, 10)
    const b = Vec2.make(4, -6)
    expect(Vec2.lerp(a, b, 0)).toEqual(a)
    expect(Vec2.equals(Vec2.lerp(a, b, 1), b, 1e-12)).toBe(true)
    expect(Vec2.lerp(a, b, 0.5)).toEqual({ x: 2, y: 2 })
  })

  it('property: the lerped point lies on the segment (collinear with a and b)', () => {
    const rng = createRng(207)
    for (let k = 0; k < CASES; k++) {
      const a = randomVec(rng)
      const b = randomVec(rng)
      const p = Vec2.lerp(a, b, rng.next())
      // Collinear: cross of (b−a) and (p−a) is the area of a degenerate triangle.
      const area = Vec2.cross(Vec2.sub(b, a), Vec2.sub(p, a))
      expect(Math.abs(area)).toBeLessThan(1e-6)
    }
  })
})

describe('Vec2.equals', () => {
  it('tolerates tiny floating-point differences, rejects real ones', () => {
    const a = Vec2.make(0.1 + 0.2, 1)
    expect(a.x === 0.3).toBe(false)
    expect(Vec2.equals(a, Vec2.make(0.3, 1))).toBe(true)
    expect(Vec2.equals(Vec2.make(1, 1), Vec2.make(1, 1.01))).toBe(false)
    expect(Vec2.equals(Vec2.make(1, 1), Vec2.make(1, 1.01), 0.1)).toBe(true)
  })
})
