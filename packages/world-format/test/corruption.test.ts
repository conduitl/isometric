/*
 * Corruption tests: every way a kid's file really breaks, and the promise
 * that each one produces (a) the RIGHT error code and (b) a message a
 * ten-year-old could act on — never a TypeError, never raw validator prose
 * (docs/RISKS.md names that as a bug class).
 *
 * The fixture corpus mirrors the field: truncated (disk full / sync died),
 * mangled (hand-edited with the wrong types — hand-editing is encouraged!),
 * mid-write (valid prefix, binary garbage tail), newer-version, and a file
 * with one rotten entity among good ones.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseWorld, salvageWorld } from '../src/index'
import type { LoadError } from '../src/index'

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value to be present')
  return value
}

/** Parses text that must FAIL, returning the error for inspection. */
function failed(text: string): LoadError {
  const result = parseWorld(text)
  if (result.ok) throw new Error('expected parsing to fail, but it succeeded')
  return result.error
}

// Words that mean an implementation detail leaked into a student's face.
const RAW_ERROR_NOISE =
  /TypeError|ZodError|invalid_type|invalid input|Unexpected token|JSON\.parse|at position|received (string|number|undefined)|\[object Object\]|undefined is not/i

function expectStudentLegible(message: string): void {
  expect(message).not.toMatch(RAW_ERROR_NOISE)
  expect(message.length).toBeGreaterThan(20)
}

describe('truncated.world.json — the first 60% of a healthy file', () => {
  it('fails parse as not-json with a kid-readable message and technical details', () => {
    const error = failed(fixture('truncated.world.json'))
    expect(error.code).toBe('not-json')
    expectStudentLegible(error.message)
    expect(error.technical).toBeDefined()
  })

  it('salvage rescues the intact tileset and layers, pads the cut-off cells, reports the losses', () => {
    const salvage = must(salvageWorld(fixture('truncated.world.json')))

    expect(salvage.world.tilesets).toHaveLength(1)
    // Ground survived whole; cliffs was cut mid-cells and gets padded blanks.
    expect(salvage.world.layers).toHaveLength(2)
    const ground = must(salvage.world.layers[0])
    expect(Array.from(ground.cells.slice(0, 6))).toEqual([3, 3, 3, 3, 3, 3])
    expect(ground.cells.length).toBe(30)
    const cliffs = must(salvage.world.layers[1])
    expect(cliffs.cells.length).toBe(30)

    // Entities lived at the end of the file — gone, and said so plainly.
    expect(Object.keys(salvage.world.entities)).toEqual([])
    expect(salvage.world.nextEntityId).toBe(5)
    expect(salvage.world.meta.name).toBe('Tiny Island')

    expect(salvage.report.length).toBeGreaterThanOrEqual(2)
    expect(salvage.report.join(' ')).toContain('damaged')
    expect(salvage.report.some((line) => line.includes('missing part of its tile data'))).toBe(true)
    for (const line of salvage.report) expectStudentLegible(line)
  })
})

describe('midwrite.world.json — valid prefix, binary garbage tail', () => {
  it('fails parse as not-json', () => {
    const error = failed(fixture('midwrite.world.json'))
    expect(error.code).toBe('not-json')
    expectStudentLegible(error.message)
  })

  it('salvage keeps everything before the garbage and counts what it dropped', () => {
    const salvage = must(salvageWorld(fixture('midwrite.world.json')))

    // e1 was complete; e2 was cut mid-component and is honestly lost.
    expect(Object.keys(salvage.world.entities)).toEqual(['e1'])
    expect(must(salvage.world.entities.e1).components).toEqual({ position: { x: 0, y: 1 } })
    expect(salvage.report).toContain("1 object couldn't be read and was left out.")

    expect(salvage.world.layers).toHaveLength(1)
    expect(Array.from(must(salvage.world.layers[0]).cells)).toEqual([1, 0, 0, 1])
    expect(salvage.world.nextEntityId).toBe(3)
    for (const line of salvage.report) expectStudentLegible(line)
  })
})

describe('mangled.world.json — hand-edited with the wrong types', () => {
  it('fails as invalid-structure, pointing at the exact spot in file order', () => {
    const error = failed(fixture('mangled.world.json'))
    expect(error.code).toBe('invalid-structure')
    expect(error.message).toContain('settings → tileSize')
    expect(error.message).toContain('"big"')
    expectStudentLegible(error.message)
    expect(error.technical).toBeDefined()
  })

  it('salvage resets only the broken setting and drops only the broken layer', () => {
    const salvage = must(salvageWorld(fixture('mangled.world.json')))

    expect(salvage.world.settings.tileSize).toBe(1) // reset to normal
    expect(salvage.world.settings.seed).toBe(3) // kept — it was fine
    expect(salvage.world.settings.primaryProjection).toBe('topdown')

    expect(salvage.world.layers).toHaveLength(1)
    expect(must(salvage.world.layers[0]).id).toBe('l2')
    expect(Object.keys(salvage.world.entities)).toEqual(['e8'])

    expect(salvage.report.some((line) => line.includes('tileSize'))).toBe(true)
    expect(salvage.report).toContain("1 tile layer couldn't be read and was left out.")
    for (const line of salvage.report) expectStudentLegible(line)
  })
})

describe('newer.world.json — saved by an app from the future', () => {
  it('refuses with newer-version and says the world itself is fine', () => {
    const error = failed(fixture('newer.world.json'))
    expect(error.code).toBe('newer-version')
    expect(error.message).toContain('99')
    expect(error.message.toLowerCase()).toContain('update')
    expectStudentLegible(error.message)
  })

  it('salvage still reads what this version understands', () => {
    const salvage = must(salvageWorld(fixture('newer.world.json')))
    expect(Object.keys(salvage.world.entities)).toEqual(['e1'])
    expect(salvage.report.some((line) => line.includes('newer'))).toBe(true)
  })
})

describe('salvageable.world.json — one rotten entity among good ones', () => {
  it('strict parse points at the rotten entity', () => {
    const error = failed(fixture('salvageable.world.json'))
    expect(error.code).toBe('invalid-structure')
    expect(error.message).toContain('entities → #2 → components')
    expectStudentLegible(error.message)
  })

  it('salvage keeps the good entities and reports the loss in student words', () => {
    const salvage = must(salvageWorld(fixture('salvageable.world.json')))
    expect(Object.keys(salvage.world.entities)).toEqual(['e1', 'e3'])
    expect(salvage.report).toEqual(["1 object couldn't be read and was left out."])
    expect(salvage.world.nextEntityId).toBe(4)
    expect(salvage.world.layers).toHaveLength(1)
  })
})

describe('v1 caps — pre-release limits, refused in student language', () => {
  interface RawDoc extends Record<string, unknown> {
    settings: Record<string, unknown>
    layers: Array<Record<string, unknown>>
  }
  const islandDoc = (): RawDoc => JSON.parse(fixture('v1-island.world.json')) as RawDoc

  it('rejects a layer wider than 256, naming the cap and the Chromebook frame budget', () => {
    const doc = islandDoc()
    const layer = must(doc.layers[0])
    layer.width = 300
    layer.cells = new Array<number>(300 * (layer.height as number)).fill(0)
    const error = failed(JSON.stringify(doc))
    expect(error.code).toBe('invalid-structure')
    expect(error.message).toContain('256')
    expect(error.message).toContain('Chromebook')
    expect(error.message).toContain('layers → #1 → width')
    expectStudentLegible(error.message)
  })

  it('rejects a layer taller than 256 the same way', () => {
    const doc = islandDoc()
    const layer = must(doc.layers[0])
    layer.height = 257
    layer.cells = new Array<number>((layer.width as number) * 257).fill(0)
    const error = failed(JSON.stringify(doc))
    expect(error.code).toBe('invalid-structure')
    expect(error.message).toContain('256')
    expect(error.message).toContain('Chromebook')
    expectStudentLegible(error.message)
  })

  it('rejects a tileSize past 64 as an almost-certain typo', () => {
    const doc = islandDoc()
    doc.settings.tileSize = 100
    const error = failed(JSON.stringify(doc))
    expect(error.code).toBe('invalid-structure')
    expect(error.message).toContain('settings → tileSize')
    expect(error.message).toContain('64')
    expectStudentLegible(error.message)
  })

  it('rejects a layerBand beyond ±1,048,576', () => {
    const doc = islandDoc()
    must(doc.layers[0]).layerBand = 2_000_000
    const error = failed(JSON.stringify(doc))
    expect(error.code).toBe('invalid-structure')
    expect(error.message).toContain('layerBand')
    expect(error.message).toContain('1,048,576')
    expectStudentLegible(error.message)

    const negative = islandDoc()
    must(negative.layers[0]).layerBand = -2_000_000
    expect(failed(JSON.stringify(negative)).message).toContain('1,048,576')
  })

  it('rejects a layer whose base is not less than its elevation, naming the slab rule', () => {
    const doc = islandDoc()
    const layer = must(doc.layers[0]) // elevation 0
    layer.base = 0 // base must be STRICTLY less than elevation — a slab needs positive height
    const error = failed(JSON.stringify(doc))
    expect(error.code).toBe('invalid-structure')
    expect(error.message).toContain('layers → #1 → base')
    expect(error.message).toContain('than its elevation')
    expectStudentLegible(error.message)

    // A properly rooted slab (base < elevation) is legal — raising the
    // layer's elevation makes base: 0 pass, proving this rejects the
    // RELATIONSHIP, not the mere presence of a base field.
    const raised = islandDoc()
    must(raised.layers[0]).elevation = 1
    must(raised.layers[0]).base = 0
    expect(parseWorld(JSON.stringify(raised)).ok).toBe(true)
  })

  it('the island fixture sits inside every cap, untouched, and still parses', () => {
    expect(parseWorld(fixture('v1-island.world.json')).ok).toBe(true)
  })
})

describe('assorted junk in, diagnosis out', () => {
  it('plain prose is not-json, and unsalvageable', () => {
    const error = failed('hello, is this where worlds go?')
    expect(error.code).toBe('not-json')
    expectStudentLegible(error.message)
    expect(salvageWorld('hello, is this where worlds go?')).toBeNull()
  })

  it('an empty file gets its own plain sentence', () => {
    const error = failed('')
    expect(error.code).toBe('not-json')
    expect(error.message.toLowerCase()).toContain('empty')
  })

  it('valid JSON that is not an object is not-an-object', () => {
    const error = failed('[1, 2, 3]')
    expect(error.code).toBe('not-an-object')
    expectStudentLegible(error.message)
    expect(salvageWorld('[1, 2, 3]')).toBeNull()
  })

  it('an object with no formatVersion is told exactly which line to add', () => {
    const error = failed('{}')
    expect(error.code).toBe('invalid-structure')
    expect(error.message).toContain('"formatVersion": 1')
    expect(salvageWorld('{}')).toBeNull()
  })

  it('a formatVersion that is not a whole number is named and shown', () => {
    const error = failed('{ "formatVersion": "one" }')
    expect(error.code).toBe('invalid-structure')
    expect(error.message).toContain('formatVersion')
    expect(error.message).toContain('"one"')
    expectStudentLegible(error.message)
  })

  it('one version ahead is enough to be newer-version', () => {
    expect(failed('{ "formatVersion": 2 }').code).toBe('newer-version')
  })

  it('duplicate entity ids are corruption, named by id', () => {
    const twins = `{
      "formatVersion": 1,
      "meta": { "worldId": "w-dup", "name": "Twins" },
      "settings": { "tileSize": 1, "primaryProjection": "topdown", "fixedDt": 0.016666666666666666, "seed": 1 },
      "nextEntityId": 6,
      "tilesets": [],
      "layers": [],
      "entities": [
        { "id": "e5", "name": "first", "components": {} },
        { "id": "e5", "name": "second", "components": {} }
      ]
    }`
    const error = failed(twins)
    expect(error.code).toBe('invalid-structure')
    expect(error.message).toContain('"e5"')
    expectStudentLegible(error.message)
  })

  it('a v0 file too broken to upgrade is migration-failed, kindly', () => {
    const error = failed('{ "formatVersion": 0, "entities": "nope" }')
    expect(error.code).toBe('migration-failed')
    expect(error.message).toContain('upgrading')
    expectStudentLegible(error.message)
  })

  it('every corrupt fixture in the corpus produces a student-legible message', () => {
    const corpus = [
      'truncated.world.json',
      'mangled.world.json',
      'midwrite.world.json',
      'newer.world.json',
      'salvageable.world.json',
    ]
    for (const name of corpus) {
      const error = failed(fixture(name))
      expectStudentLegible(error.message)
      expect(error.message.endsWith('.') || error.message.endsWith(')')).toBe(true)
    }
  })
})
