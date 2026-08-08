import { describe, it, expect } from 'vitest'
import { stableStringify, hashString, hashValue } from '../src/index'

describe('stableStringify', () => {
  it('sorts object keys so insertion order never matters', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe('{"a":1,"b":2}')
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })

  it('sorts keys at every depth, through arrays and nested objects', () => {
    const x = { name: 's', list: [1, { z: 3, y: [true, null] }] }
    const y = { list: [1, { y: [true, null], z: 3 }], name: 's' }
    expect(stableStringify(x)).toBe(stableStringify(y))
    expect(stableStringify(x)).toBe('{"list":[1,{"y":[true,null],"z":3}],"name":"s"}')
  })

  it('matches JSON.stringify exactly when keys are already sorted', () => {
    // Insertion order below is alphabetical, so plain JSON.stringify agrees —
    // the canonical form IS valid JSON, not a private dialect.
    const sample = { arr: [1, 2.5, -0, 'x'], flag: false, msg: 'he"llo\n\t', nul: null }
    expect(stableStringify(sample)).toBe(JSON.stringify(sample))
  })

  it('prints NaN and ±Infinity as null, like JSON', () => {
    expect(stableStringify(NaN)).toBe('null')
    expect(stableStringify({ x: NaN, y: Infinity, z: -Infinity })).toBe('{"x":null,"y":null,"z":null}')
    expect(stableStringify([NaN, Infinity])).toBe('[null,null]')
  })

  it('drops undefined in objects and nulls it in arrays, like JSON', () => {
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}')
    expect(stableStringify([undefined, 1])).toBe('[null,1]')
  })

  it('throws on circular structures', () => {
    const obj: Record<string, unknown> = { name: 'loop' }
    obj.self = obj
    expect(() => stableStringify(obj)).toThrow(/circular/)

    const arr: unknown[] = [1, 2]
    arr.push(arr)
    expect(() => stableStringify(arr)).toThrow(/circular/)
  })

  it('allows the same object to appear twice as siblings (a diamond is not a cycle)', () => {
    const shared = { k: 1 }
    expect(stableStringify({ a: shared, b: shared })).toBe('{"a":{"k":1},"b":{"k":1}}')
  })
})

describe('hashString (FNV-1a 32-bit)', () => {
  it('matches the published FNV-1a test vectors', () => {
    // The empty string hashes to the offset basis itself — nothing was folded in.
    expect(hashString('')).toBe('811c9dc5')
    expect(hashString('a')).toBe('e40c292c')
    expect(hashString('foobar')).toBe('bf9cf968')
  })

  it('is 8 lowercase hex chars even when the high bits are zero', () => {
    expect(hashString('')).toHaveLength(8)
    expect(hashString('determinism')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('changes completely on a one-character change', () => {
    expect(hashString('tick 599')).not.toBe(hashString('tick 600'))
  })
})

describe('hashValue', () => {
  it('gives equal fingerprints for equal data regardless of key order', () => {
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }))
    expect(hashValue({ a: 1, b: 2 })).toBe(hashString('{"a":1,"b":2}'))
  })

  it('distinguishes different data, including deep differences', () => {
    const base = { ball: { pos: { x: 1, y: 2 }, vel: { x: 0, y: -9.8 } }, tick: 600 }
    const deepChange = { ball: { pos: { x: 1, y: 2.0000001 }, vel: { x: 0, y: -9.8 } }, tick: 600 }
    expect(hashValue(base)).not.toBe(hashValue(deepChange))
  })
})
