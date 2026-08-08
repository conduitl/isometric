/*
 * Round-trip tests: the "no bytes left behind" contract.
 *
 * The standing CI property (docs/ARCHITECTURE.md §11) is
 * serialize ∘ parse ∘ serialize = byte-identical — the cheapest possible
 * detector for a loader that quietly drops or reorders something. These
 * tests check it against the committed island fixture, against hand-built
 * worlds, and against a herd of seeded-random worlds.
 */

import { readFileSync } from 'node:fs'
import type { Entity, TileLayer, Tileset, World } from '@engine/core'
import { createRng } from '@engine/math'
import type { Rng } from '@engine/math'
import { describe, expect, it } from 'vitest'
import { FORMAT_VERSION, migrations, parseWorld, serializeWorld } from '../src/index'

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/** Unwraps a value the test KNOWS exists — with a real message if it doesn't. */
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value to be present')
  return value
}

/** Parses text that must succeed, failing the test with the loader's message if not. */
function loaded(text: string): { world: World; warnings: string[] } {
  const result = parseWorld(text)
  if (!result.ok) throw new Error(`expected parse to succeed, got: ${result.error.message}`)
  return { world: result.world, warnings: result.warnings }
}

describe('the v1 island fixture — a real world, loaded for real', () => {
  it('parses with exactly one warning naming the unknown components, kept as blobs', () => {
    // "sprite" is unknown too: nothing registers it (KNOWN_COMPONENT_NAMES
    // tracks real registrations), so it rides along as an opaque blob.
    const { warnings } = loaded(fixture('v1-island.world.json'))
    expect(warnings).toHaveLength(1)
    expect(must(warnings[0])).toContain('"treasureGlow"')
    expect(must(warnings[0])).toContain('"sprite"')
  })

  it('preserves ids, nextEntityId, verbatim components, and exact cell data', () => {
    const { world } = loaded(fixture('v1-island.world.json'))

    expect(Object.keys(world.entities)).toEqual(['e1', 'e2', 'e4'])
    expect(world.nextEntityId).toBe(5)

    // The unknown component survives byte-for-byte alongside the known ones.
    expect(must(world.entities.e4).components).toEqual({
      elevation: { z: 0 },
      position: { x: 4, y: 3 },
      treasureGlow: { color: '#ffd700', pulse: 2 },
    })

    expect(world.layers).toHaveLength(3)
    const ground = must(world.layers[0])
    expect(ground.cells).toBeInstanceOf(Uint16Array)
    expect(Array.from(ground.cells.slice(0, 6))).toEqual([3, 3, 3, 3, 3, 3])
    expect(ground.cells.length).toBe(30)
    const canopy = must(world.layers[2])
    expect(canopy.cells[15]).toBe(1)

    expect(must(world.tilesets[0]).tiles).toHaveLength(4)
    expect(must(must(world.tilesets[0]).tiles[3]).colors.side).toBe('#546e7a')
    expect(world.settings.primaryProjection).toBe('iso')
  })

  it('round-trips byte-identically: serialize ∘ parse ∘ serialize', () => {
    const { world } = loaded(fixture('v1-island.world.json'))
    const once = serializeWorld(world)
    const again = loaded(once)
    expect(serializeWorld(again.world)).toBe(once)
    // The opaque blob is still aboard after the second trip.
    expect(must(again.world.entities.e4).components).toHaveProperty('treasureGlow')
  })
})

/** A small world built by hand, with entity ids inserted out of numeric order on purpose. */
function tinyWorld(): World {
  return {
    meta: { worldId: 'w9', name: 'tiny' },
    settings: { tileSize: 1, primaryProjection: 'topdown', fixedDt: 1 / 60, seed: 9 },
    nextEntityId: 11,
    entities: {
      e10: { id: 'e10', name: 'later', components: { zeta: { on: true }, alpha: { n: 1 } } },
      e2: { id: 'e2', name: 'earlier', components: { position: { x: 1, y: 2 } } },
    },
    tilesets: [{ id: 't', name: 'T', tiles: [{ name: 'a', colors: { top: '#111111' } }] }],
    layers: [
      {
        id: 'l',
        name: 'L',
        width: 2,
        height: 1,
        elevation: 0,
        layerBand: 0,
        tilesetId: 't',
        cells: Uint16Array.from([1, 0]),
      },
    ],
  }
}

describe('canonical serialization', () => {
  it('writes top-level fields in the fixed order, version first', () => {
    const text = serializeWorld(tinyWorld())
    expect(text.startsWith('{\n  "formatVersion": 1,\n  "meta": {')).toBe(true)
    const order = ['"formatVersion"', '"meta"', '"settings"', '"nextEntityId"', '"tilesets"', '"layers"', '"entities"']
    const positions = order.map((key) => text.indexOf(key))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(text.endsWith('\n')).toBe(true)
  })

  it('sorts the entities array by the NUMBER in the id — e2 before e10', () => {
    const text = serializeWorld(tinyWorld())
    expect(text.indexOf('"e2"')).toBeGreaterThan(-1)
    expect(text.indexOf('"e2"')).toBeLessThan(text.indexOf('"e10"'))
  })

  it('sorts component names within an entity, but never touches their contents', () => {
    const text = serializeWorld(tinyWorld())
    expect(text.indexOf('"alpha"')).toBeLessThan(text.indexOf('"zeta"'))
  })

  it('prints cell arrays on one line — a row of numbers reads like a map', () => {
    const text = serializeWorld(tinyWorld())
    expect(text).toContain('"cells": [1, 0]')
  })

  it('is deterministic: two serializations of the same world are the same bytes', () => {
    expect(serializeWorld(tinyWorld())).toBe(serializeWorld(tinyWorld()))
  })
})

describe('the v0 migration — the runner exercised by a real step', () => {
  it('renames numeric ids, computes nextEntityId, and adds layerBand 0', () => {
    const { world } = loaded(fixture('v0-basic.world.json'))
    expect(Object.keys(world.entities)).toEqual(['e1', 'e5'])
    expect(world.nextEntityId).toBe(6)
    expect(must(world.layers[0]).layerBand).toBe(0)
    expect(must(world.entities.e5).components).toEqual({ position: { x: 2, y: 1 } })
  })

  it('migrations[0] is pure: the input document is never mutated', () => {
    const doc = JSON.parse(fixture('v0-basic.world.json')) as Record<string, unknown>
    const before = JSON.stringify(doc)
    const out = must(migrations[0])(doc)
    expect(JSON.stringify(doc)).toBe(before)
    expect(out).not.toBe(doc)
    expect(out.formatVersion).toBe(1)
  })

  it('carries exactly one migration per released version bump', () => {
    expect(FORMAT_VERSION).toBe(1)
    expect(migrations).toHaveLength(FORMAT_VERSION)
  })

  it('a migrated world re-saves as a modern file that round-trips byte-identically', () => {
    const { world } = loaded(fixture('v0-basic.world.json'))
    const once = serializeWorld(world)
    expect(loaded(once).world.nextEntityId).toBe(6)
    expect(serializeWorld(loaded(once).world)).toBe(once)
  })
})

describe('negative zero normalizes to 0 on save — a stated contract, not an accident', () => {
  it('serializes −0 as "0" in both printing paths, round-trips byte-stably, parses back as +0', () => {
    const world = tinyWorld()
    must(world.entities.e2).components = {
      position: { x: -0, y: 0 },
      // An all-number array takes printArray's one-line fast path — the
      // second number-printing site, which must agree with the first.
      wave: { samples: [-0, 1, -0] },
    }

    const once = serializeWorld(world)
    expect(once).toContain('"x": 0')
    expect(once).toContain('"samples": [0, 1, 0]')
    expect(once).not.toContain('-0')

    const { world: reloaded } = loaded(once)
    const position = must(reloaded.entities.e2).components.position as { x: number }
    expect(Object.is(position.x, 0)).toBe(true)
    expect(Object.is(position.x, -0)).toBe(false)

    // Byte-stable from the very first save: the normalization happens on
    // the way OUT, so serialize ∘ parse ∘ serialize sees nothing move.
    expect(serializeWorld(reloaded)).toBe(once)
  })
})

describe('unknown keys outside components are dropped — loudly, never silently', () => {
  it('warns once per location, names each doomed field, and points at components', () => {
    interface RawDoc extends Record<string, unknown> {
      meta: Record<string, unknown>
      settings: Record<string, unknown>
      tilesets: Array<Record<string, unknown>>
      layers: Array<Record<string, unknown>>
      entities: Array<Record<string, unknown>>
    }
    const doc = JSON.parse(fixture('v1-island.world.json')) as RawDoc
    doc.author = 'me'
    doc.luckyNumber = 7
    doc.meta.motto = 'onward'
    doc.settings.difficulty = 'spicy'
    must(doc.tilesets[0]).license = 'CC0'
    must(doc.layers[1]).weather = 'rainy'
    must(doc.entities[0]).nickname = 'cap'

    const { world, warnings } = loaded(JSON.stringify(doc))
    const dropWarnings = warnings.filter((line) => line.includes('NOT survive'))

    // One warning per location: top level (both extras in one), meta,
    // settings, tilesets → #1, layers → #2, entities → #1.
    expect(dropWarnings).toHaveLength(6)
    const text = dropWarnings.join('\n')
    for (const name of ['"author"', '"luckyNumber"', '"motto"', '"difficulty"', '"license"', '"weather"', '"nickname"']) {
      expect(text).toContain(name)
    }
    expect(text).toContain('the top of the file')
    expect(text).toContain('layers → #2')
    // The warning points at the extension point that DOES round-trip.
    expect(text).toContain('component')

    // The policy in action: a save writes none of the doomed fields…
    const once = serializeWorld(world)
    for (const name of ['author', 'luckyNumber', 'motto', 'difficulty', 'license', 'weather', 'nickname']) {
      expect(once).not.toContain(name)
    }
    // …and the re-saved file is clean: no drop warnings, byte-stable trip.
    const again = loaded(once)
    expect(again.warnings.filter((line) => line.includes('NOT survive'))).toHaveLength(0)
    expect(serializeWorld(again.world)).toBe(once)
  })
})

describe('the entity-id policy is enforced at the door', () => {
  it('serializeWorld refuses a non-policy id, naming it — instead of writing unloadable bytes', () => {
    const world = tinyWorld()
    world.entities['hero'] = { id: 'hero', name: 'off-policy', components: {} }
    expect(() => serializeWorld(world)).toThrow(/"hero"/)
    expect(() => serializeWorld(world)).toThrow(/e12/) // the message shows the policy by example
  })
})

describe('nextEntityId is repaired, not trusted', () => {
  it('raises a too-small nextEntityId with a warning — ids are never recycled', () => {
    const broken: World = { ...tinyWorld(), nextEntityId: 3 }
    const { world, warnings } = loaded(serializeWorld(broken))
    expect(world.nextEntityId).toBe(11)
    expect(warnings.some((line) => line.includes('nextEntityId'))).toBe(true)
  })
})

const PROJECTIONS = ['profile', 'topdown', 'iso'] as const

/** Builds a random-but-reproducible world: same seed, same world, forever. */
function randomWorld(rng: Rng): World {
  const seed = rng.int(0, 1_000_000)
  const entities: Record<string, Entity> = {}
  let suffix = 0
  const count = rng.int(0, 7)
  for (let k = 0; k < count; k += 1) {
    suffix += rng.int(1, 5) // gaps prove ids need not be dense
    const id = `e${suffix}`
    const components: Record<string, unknown> = {}
    if (rng.next() < 0.9) components.position = { x: rng.range(-20, 20), y: rng.range(-20, 20) }
    if (rng.next() < 0.5) components.velocity = { x: rng.next(), y: rng.next() }
    if (rng.next() < 0.4) components.elevation = { z: rng.int(0, 4) }
    if (rng.next() < 0.35) {
      // An unknown component with awkward nested data — the opaque blob.
      components[`mystery${rng.int(0, 3)}`] = {
        level: rng.int(0, 99),
        tags: ['wild', 'card'].slice(0, rng.int(0, 3)),
        nested: { deep: rng.next(), flags: [true, false, null] },
      }
    }
    entities[id] = { id, name: `thing ${suffix}`, components }
  }

  const layers: TileLayer[] = []
  const layerCount = rng.int(1, 4)
  for (let k = 0; k < layerCount; k += 1) {
    const width = rng.int(1, 6)
    const height = rng.int(1, 6)
    const cells = new Uint16Array(width * height)
    for (let c = 0; c < cells.length; c += 1) cells[c] = rng.int(0, 3)
    layers.push({
      id: `l${k}`,
      name: `layer ${k}`,
      width,
      height,
      elevation: rng.int(0, 3),
      layerBand: rng.int(0, 2),
      tilesetId: 'main',
      cells,
    })
  }

  const tilesets: Tileset[] = [
    {
      id: 'main',
      name: 'Main',
      tiles: [
        { name: 'one', colors: { top: '#123456' } },
        { name: 'two', colors: { top: '#abcdef', left: '#001122', right: '#334455' } },
      ],
    },
  ]

  return {
    meta: { worldId: `w${seed}`, name: `world ${seed}` },
    settings: {
      tileSize: rng.int(1, 4),
      primaryProjection: PROJECTIONS[rng.int(0, 3)] ?? 'topdown',
      fixedDt: 1 / 60,
      seed,
    },
    nextEntityId: suffix + rng.int(1, 3),
    entities,
    tilesets,
    layers,
  }
}

describe('property: seeded random worlds survive the trip intact', () => {
  it('preserves ids, components, nextEntityId, and cells; second serialize is byte-identical (25 worlds)', () => {
    for (let k = 0; k < 25; k += 1) {
      const original = randomWorld(createRng(4000 + k))
      const once = serializeWorld(original)
      const { world: reloaded } = loaded(once)

      const sortedIds = Object.keys(original.entities).sort(
        (a, b) => Number(a.slice(1)) - Number(b.slice(1)),
      )
      expect(Object.keys(reloaded.entities)).toEqual(sortedIds)
      expect(reloaded.nextEntityId).toBe(original.nextEntityId)
      for (const id of sortedIds) {
        expect(must(reloaded.entities[id]).components).toEqual(must(original.entities[id]).components)
      }
      expect(reloaded.layers.map((layer) => Array.from(layer.cells))).toEqual(
        original.layers.map((layer) => Array.from(layer.cells)),
      )
      expect(serializeWorld(reloaded)).toBe(once)
    }
  })
})
