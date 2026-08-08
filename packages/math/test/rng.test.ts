import { describe, expect, it } from 'vitest'
import { createRng } from '../src/index'

const CASES = 200

describe('createRng determinism', () => {
  it('same seed -> same first 100 draws, on every run, forever', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    for (let k = 0; k < 100; k++) {
      expect(a.next()).toBe(b.next())
    }
  })

  it('remembers its seed so a run can be recreated later', () => {
    expect(createRng(42).seed).toBe(42)
    expect(createRng(0).seed).toBe(0)
  })

  it('different seeds -> different streams (even adjacent seeds, thanks to avalanche)', () => {
    const a = createRng(1)
    const b = createRng(2)
    let anyDifferent = false
    for (let k = 0; k < 10; k++) {
      if (a.next() !== b.next()) anyDifferent = true
    }
    expect(anyDifferent).toBe(true)
  })

  it('two streams with the same seed advance independently', () => {
    const a = createRng(777)
    const b = createRng(777)
    a.next()
    a.next() // a is now two draws ahead...
    const third = a.next()
    b.next()
    b.next()
    expect(b.next()).toBe(third) // ...and b's third draw matches a's third draw.
  })

  it('all methods draw from the SAME stream — mixing calls stays reproducible', () => {
    const a = createRng(99)
    const b = createRng(99)
    // Interleave differently-typed draws; matching call sequences must match.
    expect(a.next()).toBe(b.next())
    expect(a.range(-5, 5)).toBe(b.range(-5, 5))
    expect(a.int(0, 100)).toBe(b.int(0, 100))
    expect(a.next()).toBe(b.next())
  })
})

describe('createRng bounds', () => {
  it('property: next() is always in [0, 1)', () => {
    const rng = createRng(401)
    for (let k = 0; k < 1000; k++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('property: range(min, max) stays in [min, max)', () => {
    const meta = createRng(402)
    const rng = createRng(403)
    for (let k = 0; k < CASES; k++) {
      const min = meta.range(-100, 0)
      const max = meta.range(0, 100)
      const v = rng.range(min, max)
      expect(v).toBeGreaterThanOrEqual(min)
      expect(v).toBeLessThan(max)
    }
  })

  it('property: int(min, max) returns integers in [min, max)', () => {
    const rng = createRng(404)
    for (let k = 0; k < CASES; k++) {
      const v = rng.int(-3, 4)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(-3)
      expect(v).toBeLessThan(4)
    }
  })

  it('int eventually hits every value in a small range (a die rolls all faces)', () => {
    const rng = createRng(405)
    const seen = new Set<number>()
    for (let k = 0; k < 200; k++) seen.add(rng.int(1, 7))
    expect([...seen].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('output is roughly uniform: the mean of many draws approaches 0.5', () => {
    const rng = createRng(406)
    let sum = 0
    const n = 10000
    for (let k = 0; k < n; k++) sum += rng.next()
    // Statistics, not exactness: standard error is ~0.003, so 0.02 slack is generous
    // — but the check is still deterministic because the seed is fixed.
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.02)
  })
})

describe('createRng seed handling', () => {
  it('folds seeds into 32 bits: seed and seed + 2^32 produce the same stream', () => {
    const a = createRng(5)
    const b = createRng(5 + 2 ** 32)
    for (let k = 0; k < 10; k++) expect(a.next()).toBe(b.next())
  })

  it('seed 0 is a valid, working stream', () => {
    const rng = createRng(0)
    const first = rng.next()
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(1)
    // And it is not stuck: draws vary.
    expect(rng.next()).not.toBe(first)
  })
})

describe('review regressions: int() honors its contract for non-integer bounds', () => {
  it('int(0.5, 2.5) only ever returns the integers actually inside [0.5, 2.5)', () => {
    const rng = createRng(7)
    for (let i = 0; i < 1000; i++) {
      const n = rng.int(0.5, 2.5)
      expect(n === 1 || n === 2).toBe(true)
    }
  })

  it('integer bounds produce the exact same seeded stream as before the fix', () => {
    // ceil() is the identity on integers, so this pins bit-compatibility.
    const a = createRng(12345)
    const b = createRng(12345)
    for (let i = 0; i < 200; i++) {
      expect(a.int(1, 7)).toBe(Math.floor(1 + b.next() * 6))
    }
  })
})
