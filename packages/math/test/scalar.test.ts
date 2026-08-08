import { describe, expect, it } from 'vitest'
import { createRng } from '../src/index'
import * as Scalar from '../src/scalar'

const CASES = 200

describe('Scalar.TAU', () => {
  it('is one full turn: 2π', () => {
    expect(Scalar.TAU).toBe(Math.PI * 2)
  })
})

describe('Scalar.lerp', () => {
  it('returns a at t=0 and b at t=1', () => {
    expect(Scalar.lerp(3, 7, 0)).toBe(3)
    expect(Scalar.lerp(3, 7, 1)).toBeCloseTo(7, 12)
  })

  it('returns the midpoint at t=0.5', () => {
    expect(Scalar.lerp(-2, 6, 0.5)).toBe(2)
  })

  it('extrapolates outside [0, 1]', () => {
    expect(Scalar.lerp(0, 10, 2)).toBe(20)
    expect(Scalar.lerp(0, 10, -1)).toBe(-10)
  })

  it('property: lerp(a, b, t) sits between a and b for t in [0, 1]', () => {
    const rng = createRng(101)
    for (let k = 0; k < CASES; k++) {
      const a = rng.range(-100, 100)
      const b = rng.range(-100, 100)
      const t = rng.next()
      const v = Scalar.lerp(a, b, t)
      expect(v).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-9)
      expect(v).toBeLessThanOrEqual(Math.max(a, b) + 1e-9)
    }
  })
})

describe('Scalar.clamp', () => {
  it('pins values below, inside, and above the range', () => {
    expect(Scalar.clamp(-5, 0, 10)).toBe(0)
    expect(Scalar.clamp(5, 0, 10)).toBe(5)
    expect(Scalar.clamp(15, 0, 10)).toBe(10)
  })

  it('returns the boundary when x equals it', () => {
    expect(Scalar.clamp(0, 0, 10)).toBe(0)
    expect(Scalar.clamp(10, 0, 10)).toBe(10)
  })

  it('property: result is always inside [min, max]', () => {
    const rng = createRng(102)
    for (let k = 0; k < CASES; k++) {
      const min = rng.range(-50, 0)
      const max = rng.range(0, 50)
      const x = rng.range(-100, 100)
      const c = Scalar.clamp(x, min, max)
      expect(c).toBeGreaterThanOrEqual(min)
      expect(c).toBeLessThanOrEqual(max)
    }
  })
})

describe('Scalar.approxEquals', () => {
  it('tolerates classic floating-point rounding', () => {
    // The motivating example: binary can't store 0.1 or 0.2 exactly.
    expect(0.1 + 0.2 === 0.3).toBe(false)
    expect(Scalar.approxEquals(0.1 + 0.2, 0.3)).toBe(true)
  })

  it('rejects differences bigger than epsilon', () => {
    expect(Scalar.approxEquals(1, 1.001)).toBe(false)
    expect(Scalar.approxEquals(1, 1.001, 0.01)).toBe(true)
  })

  it('is inclusive at exactly epsilon apart', () => {
    expect(Scalar.approxEquals(0, 1e-9)).toBe(true)
  })
})

describe('Scalar trig wrappers', () => {
  it('sin and cos hit the four cardinal points of the unit circle', () => {
    expect(Scalar.sin(0)).toBe(0)
    expect(Scalar.cos(0)).toBe(1)
    expect(Scalar.sin(Scalar.TAU / 4)).toBeCloseTo(1, 12)
    expect(Scalar.cos(Scalar.TAU / 4)).toBeCloseTo(0, 12)
    expect(Scalar.sin(Scalar.TAU / 2)).toBeCloseTo(0, 12)
    expect(Scalar.cos(Scalar.TAU / 2)).toBeCloseTo(-1, 12)
  })

  it('tan is sin/cos: slope 1 at an eighth of a turn', () => {
    expect(Scalar.tan(Scalar.TAU / 8)).toBeCloseTo(1, 12)
  })

  it('atan2 recovers angles in all four quadrants', () => {
    expect(Scalar.atan2(0, 1)).toBe(0)
    expect(Scalar.atan2(1, 0)).toBeCloseTo(Scalar.TAU / 4, 12)
    expect(Scalar.atan2(0, -1)).toBeCloseTo(Scalar.TAU / 2, 12)
    expect(Scalar.atan2(-1, 0)).toBeCloseTo(-Scalar.TAU / 4, 12)
    // atan(y/x) could never tell these two apart; atan2 can.
    expect(Scalar.atan2(1, 1)).not.toBeCloseTo(Scalar.atan2(-1, -1), 6)
  })

  it('property: sin² + cos² = 1 (Pythagoras on the unit circle)', () => {
    const rng = createRng(103)
    for (let k = 0; k < CASES; k++) {
      const x = rng.range(-4 * Scalar.TAU, 4 * Scalar.TAU)
      const s = Scalar.sin(x)
      const c = Scalar.cos(x)
      expect(s * s + c * c).toBeCloseTo(1, 12)
    }
  })

  it('property: atan2(sin θ, cos θ) recovers θ for θ in (−π, π)', () => {
    const rng = createRng(104)
    for (let k = 0; k < CASES; k++) {
      const theta = rng.range(-Math.PI + 1e-6, Math.PI - 1e-6)
      expect(Scalar.atan2(Scalar.sin(theta), Scalar.cos(theta))).toBeCloseTo(theta, 9)
    }
  })
})
