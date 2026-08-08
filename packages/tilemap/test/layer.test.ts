import { describe, expect, it } from 'vitest'
import { createRng } from '@engine/math'
import {
  MAX_LAYER_SIZE,
  cellIndex,
  createTileLayer,
  drainDirtyCells,
  getCell,
  layerRevision,
  setCell,
  tileToWorld,
  worldToTile,
} from '../src/layer'

describe('createTileLayer', () => {
  it('fills in the documented defaults', () => {
    const layer = createTileLayer({ id: 'l1', width: 4, height: 3, tilesetId: 'ts1' })
    expect(layer.name).toBe('l1')
    expect(layer.elevation).toBe(0)
    expect(layer.layerBand).toBe(0)
    expect(layer.cells).toBeInstanceOf(Uint16Array)
    expect(layer.cells.length).toBe(12)
    expect(Array.from(layer.cells).every((v) => v === 0)).toBe(true)
  })

  it('accepts initial cells and round-trips them', () => {
    const layer = createTileLayer({
      id: 'l1',
      width: 2,
      height: 2,
      tilesetId: 'ts1',
      cells: [1, 2, 3, 4],
    })
    expect(getCell(layer, 0, 0)).toBe(1)
    expect(getCell(layer, 1, 0)).toBe(2)
    expect(getCell(layer, 0, 1)).toBe(3)
    expect(getCell(layer, 1, 1)).toBe(4)
  })

  it('rejects a cells array whose length does not match width×height, naming both numbers', () => {
    expect(() =>
      createTileLayer({ id: 'l1', width: 2, height: 2, tilesetId: 'ts1', cells: [1, 2, 3] }),
    ).toThrow(/3 cell values.*2×2.*4/s)
  })

  it('enforces the 256-per-side cap with an error that names the cap', () => {
    expect(MAX_LAYER_SIZE).toBe(256)
    expect(() =>
      createTileLayer({ id: 'huge', width: 257, height: 4, tilesetId: 'ts1' }),
    ).toThrow(/256/)
    expect(() =>
      createTileLayer({ id: 'tall', width: 4, height: 300, tilesetId: 'ts1' }),
    ).toThrow(/256/)
    // 256 exactly is allowed — the cap is inclusive.
    const max = createTileLayer({ id: 'max', width: 256, height: 256, tilesetId: 'ts1' })
    expect(max.cells.length).toBe(256 * 256)
  })

  it('rejects zero, negative, and fractional dimensions', () => {
    expect(() => createTileLayer({ id: 'w0', width: 0, height: 4, tilesetId: 't' })).toThrow(
      /whole numbers/,
    )
    expect(() => createTileLayer({ id: 'neg', width: 4, height: -1, tilesetId: 't' })).toThrow(
      /whole numbers/,
    )
    expect(() => createTileLayer({ id: 'frac', width: 2.5, height: 4, tilesetId: 't' })).toThrow(
      /whole numbers/,
    )
  })
})

describe('cellIndex — the taught formula', () => {
  const layer = createTileLayer({ id: 'l1', width: 7, height: 5, tilesetId: 'ts1' })

  it('computes index = y·width + x', () => {
    expect(cellIndex(layer, 0, 0)).toBe(0)
    expect(cellIndex(layer, 3, 0)).toBe(3)
    expect(cellIndex(layer, 0, 1)).toBe(7)
    expect(cellIndex(layer, 3, 2)).toBe(2 * 7 + 3)
    expect(cellIndex(layer, 6, 4)).toBe(4 * 7 + 6)
  })

  it('answers −1 for anything outside the grid, including fractional coordinates', () => {
    expect(cellIndex(layer, -1, 0)).toBe(-1)
    expect(cellIndex(layer, 0, -1)).toBe(-1)
    expect(cellIndex(layer, 7, 0)).toBe(-1)
    expect(cellIndex(layer, 0, 5)).toBe(-1)
    expect(cellIndex(layer, 0.5, 1)).toBe(-1)
    expect(cellIndex(layer, 1, 2.0000001)).toBe(-1)
  })
})

describe('getCell / setCell', () => {
  it('reads out of bounds as 0 (the world beyond the edge is empty)', () => {
    const layer = createTileLayer({ id: 'l1', width: 2, height: 2, tilesetId: 'ts1' })
    setCell(layer, 0, 0, 9)
    expect(getCell(layer, -1, 0)).toBe(0)
    expect(getCell(layer, 0, 2)).toBe(0)
    expect(getCell(layer, 0, 0)).toBe(9)
  })

  it('refuses out-of-bounds writes without touching the revision', () => {
    const layer = createTileLayer({ id: 'l1', width: 2, height: 2, tilesetId: 'ts1' })
    expect(setCell(layer, 2, 0, 5)).toBe(false)
    expect(setCell(layer, 0, -1, 5)).toBe(false)
    expect(layerRevision(layer)).toBe(0)
  })

  it('bumps the revision on EVERY successful write — even a rewrite of the same value', () => {
    const layer = createTileLayer({ id: 'l1', width: 2, height: 2, tilesetId: 'ts1' })
    expect(layerRevision(layer)).toBe(0)
    expect(setCell(layer, 0, 0, 1)).toBe(true)
    expect(layerRevision(layer)).toBe(1)
    setCell(layer, 0, 0, 1)
    expect(layerRevision(layer)).toBe(2)
    setCell(layer, 1, 1, 3)
    expect(layerRevision(layer)).toBe(3)
  })

  it('keeps bookkeeping per layer — two layers never share a revision', () => {
    const a = createTileLayer({ id: 'a', width: 2, height: 2, tilesetId: 'ts1' })
    const b = createTileLayer({ id: 'b', width: 2, height: 2, tilesetId: 'ts1' })
    setCell(a, 0, 0, 1)
    setCell(a, 1, 0, 1)
    expect(layerRevision(a)).toBe(2)
    expect(layerRevision(b)).toBe(0)
  })

  it('records dirty cells deduplicated, and draining hands them over exactly once', () => {
    const layer = createTileLayer({ id: 'l1', width: 4, height: 4, tilesetId: 'ts1' })
    setCell(layer, 1, 1, 7)
    setCell(layer, 1, 1, 8) // same cell twice — one dirty entry
    setCell(layer, 2, 0, 3)
    const dirty = drainDirtyCells(layer)
    expect([...dirty].sort((x, y) => x - y)).toEqual([cellIndex(layer, 2, 0), cellIndex(layer, 1, 1)].sort((x, y) => x - y))
    // Drained means gone: the hand-off happens once.
    expect(drainDirtyCells(layer)).toEqual([])
    // The revision is untouched by draining.
    expect(layerRevision(layer)).toBe(3)
  })

  it('matches a plain 2D mirror under seeded-random paint strokes', () => {
    const rng = createRng(7)
    const width = 16
    const height = 16
    const layer = createTileLayer({ id: 'l1', width, height, tilesetId: 'ts1' })
    const mirror: number[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => 0))

    for (let stroke = 0; stroke < 200; stroke += 1) {
      const x = rng.int(0, width)
      const y = rng.int(0, height)
      const value = rng.int(0, 100)
      expect(setCell(layer, x, y, value)).toBe(true)
      const row = mirror[y]
      if (row !== undefined) row[x] = value
    }

    expect(layerRevision(layer)).toBe(200)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        expect(getCell(layer, x, y)).toBe(mirror[y]?.[x] ?? -1)
      }
    }
  })
})

describe('tileToWorld / worldToTile', () => {
  it('tileToWorld answers the CENTER of the cell', () => {
    expect(tileToWorld({ tileSize: 32 }, 0, 0)).toEqual({ x: 16, y: 16 })
    expect(tileToWorld({ tileSize: 32 }, -1, 2)).toEqual({ x: -16, y: 80 })
    expect(tileToWorld({ tileSize: 1 }, 3, 4)).toEqual({ x: 3.5, y: 4.5 })
  })

  it('worldToTile floors — negative coordinates land in the right tile', () => {
    // The documented trap: −0.5 lives in tile −1 (which spans −1..0), NOT
    // tile 0. Truncation would answer 0 and be wrong.
    expect(worldToTile({ tileSize: 1 }, { x: -0.5, y: -0.5 })).toEqual({ tx: -1, ty: -1 })
    expect(worldToTile({ tileSize: 1 }, { x: 0.99, y: 0 })).toEqual({ tx: 0, ty: 0 })
    expect(worldToTile({ tileSize: 32 }, { x: 31.9, y: 32 })).toEqual({ tx: 0, ty: 1 })
    expect(worldToTile({ tileSize: 32 }, { x: -0.5, y: -32.5 })).toEqual({ tx: -1, ty: -2 })
  })

  it('round-trips: the center of every tile maps back to that tile', () => {
    const settings = { tileSize: 24 }
    for (const [tx, ty] of [
      [0, 0],
      [3, 5],
      [-2, 7],
      [-4, -4],
    ] as const) {
      expect(worldToTile(settings, tileToWorld(settings, tx, ty))).toEqual({ tx, ty })
    }
  })
})
