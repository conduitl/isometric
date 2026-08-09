/**
 * The starter-document contract, pinned.
 *
 * The starter world's shape is a CONTRACT (types.ts, "Starter document
 * contract"): the e2e flow, the lessons, and the boot path all rely on it,
 * so its pinned facts are asserted one by one rather than snapshot-blobbed —
 * a failure should name the exact promise that broke. Both worlds must also
 * round-trip the file format byte-identically: a starter world the format
 * refuses (or quietly rewrites) would corrupt the very first save a student
 * ever makes.
 */

import { getCell } from '@engine/tilemap'
import { parseWorld, serializeWorld } from '@engine/world-format'
import { describe, expect, it } from 'vitest'
import { markerKind } from '../src/editor/picking'
import { createPerfWorld, createStarterWorld } from '../src/editor/starter'

/** serialize ∘ parse ∘ serialize must be the identity on bytes. */
function roundTrip(text: string): string {
  const result = parseWorld(text)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  expect(result.warnings).toEqual([])
  return serializeWorld(result.world)
}

describe('createStarterWorld', () => {
  it('round-trips the file format byte-identically', () => {
    const text = serializeWorld(createStarterWorld())
    expect(roundTrip(text)).toBe(text)
  })

  it('is deterministic: two calls serialize to the same bytes', () => {
    expect(serializeWorld(createStarterWorld())).toBe(serializeWorld(createStarterWorld()))
  })

  it('carries the pinned identity: name, projection, tileSize, seed', () => {
    const world = createStarterWorld()
    expect(world.meta.name).toBe('my first world')
    expect(world.settings.primaryProjection).toBe('topdown')
    expect(world.settings.tileSize).toBe(1)
    expect(world.settings.seed).toBe(7)
  })

  it('carries the terrain tileset with the five pinned tiles, grass first', () => {
    const world = createStarterWorld()
    expect(world.tilesets).toHaveLength(1)
    const tileset = world.tilesets[0]
    expect(tileset?.id).toBe('terrain')
    expect(tileset?.name).toBe('terrain')
    expect(tileset?.tiles.map((tile) => tile.name)).toEqual(['grass', 'water', 'sand', 'stone', 'path'])
    expect(tileset?.tiles.map((tile) => tile.colors.top)).toEqual([
      '#4a7c3a',
      '#2b6cb0',
      '#d9b26b',
      '#8a8f98',
      '#b58e5a',
    ])
    // Every tile carries authored face shades so iso/profile look intentional.
    for (const tile of tileset?.tiles ?? []) {
      expect(tile.colors.left).toBeDefined()
      expect(tile.colors.right).toBeDefined()
      expect(tile.colors.side).toBeDefined()
    }
  })

  it('carries one 32×24 ground layer: grass, a pond, and a sand rim', () => {
    const world = createStarterWorld()
    expect(world.layers).toHaveLength(1)
    const layer = world.layers[0]
    if (layer === undefined) throw new Error('no ground layer')
    expect(layer.id).toBe('ground')
    expect(layer.name).toBe('ground')
    expect(layer.width).toBe(32)
    expect(layer.height).toBe(24)
    expect(layer.elevation).toBe(0)
    expect(layer.layerBand).toBe(0)
    expect(layer.tilesetId).toBe('terrain')

    // Pond interior is water (value 2), its one-cell rim is sand (3), and
    // the far corner is untouched grass (1).
    expect(getCell(layer, 6, 5)).toBe(2)
    expect(getCell(layer, 5, 4)).toBe(2)
    expect(getCell(layer, 8, 6)).toBe(2)
    expect(getCell(layer, 4, 3)).toBe(3)
    expect(getCell(layer, 9, 7)).toBe(3)
    expect(getCell(layer, 4, 6)).toBe(3)
    expect(getCell(layer, 0, 0)).toBe(1)
    expect(getCell(layer, 31, 23)).toBe(1)
  })

  it('carries one player marker entity standing on the CENTER of cell (16, 12)', () => {
    const world = createStarterWorld()
    expect(Object.keys(world.entities)).toEqual(['e1'])
    const player = world.entities['e1']
    if (player === undefined) throw new Error('no player entity')
    expect(player.name).toBe('player')
    expect(markerKind(player)).toBe('player')
    // Half-coordinates, deliberately: cell-dwellers stand on cell CENTERS,
    // not on the corner where four tiles meet (tileToWorld's +0.5 lesson —
    // the contract in types.ts pins these exact numbers).
    expect(player.components['position']).toEqual({ x: 16.5, y: 12.5 })
    expect(player.components['elevation']).toEqual({ z: 0 })
    expect(world.nextEntityId).toBe(2)
  })
})

describe('createPerfWorld', () => {
  // 64 keeps the suite quick; the shape claims scale with the parameter, so
  // what holds at 64 holds at the gate's full 256 by construction.
  const SIZE = 64

  it('is size×size and fills every cell with one of the five tiles', () => {
    const world = createPerfWorld(SIZE)
    const layer = world.layers[0]
    if (layer === undefined) throw new Error('no ground layer')
    expect(layer.width).toBe(SIZE)
    expect(layer.height).toBe(SIZE)
    expect(layer.cells).toHaveLength(SIZE * SIZE)

    const seen = new Set<number>()
    for (const value of layer.cells) seen.add(value)
    // A deterministic MIX of all five tiles — no empties, nothing else.
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('scatters a handful of marker entities', () => {
    const world = createPerfWorld(SIZE)
    const ids = Object.keys(world.entities)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      const entity = world.entities[id]
      expect(entity && markerKind(entity)).not.toBeNull()
    }
  })

  it('is deterministic: two builds serialize to identical bytes', () => {
    expect(serializeWorld(createPerfWorld(SIZE))).toBe(serializeWorld(createPerfWorld(SIZE)))
  })

  it('round-trips the file format byte-identically', () => {
    const text = serializeWorld(createPerfWorld(SIZE))
    expect(roundTrip(text)).toBe(text)
  })
})
