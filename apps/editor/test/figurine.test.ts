/**
 * The figurine pipeline, proven against its own production path: converting
 * the bear portrait/figure fixtures must reproduce exactly the cells those
 * fixtures decoded, exclude must actually exclude, colors must resolve (with
 * and without an explicit left/right in the source tileset), and an
 * oversized or non-square world must be refused rather than reshaped.
 */

import type { TileDef, World } from '@engine/core'
import { createWorld } from '@engine/core'
import { createTileLayer, getCell } from '@engine/tilemap'
import { describe, expect, it } from 'vitest'
import { createBearFigure, createBearPortrait } from '../src/editor/fixtures'
import {
  figurineCellAt,
  figurineFromWorld,
  MAX_FIGURINE_SIZE,
  PIP_FIGURINE,
  readFigurine,
} from '../src/editor/figurine'
import type { Figurine } from '../src/editor/figurine'

/** Every (tx, ty) of a size×size grid, engine order — the same walk every
 * comparison below repeats. */
function everyCell(size: number): Array<{ tx: number; ty: number }> {
  const cells: Array<{ tx: number; ty: number }> = []
  for (let ty = 0; ty < size; ty += 1) {
    for (let tx = 0; tx < size; tx += 1) cells.push({ tx, ty })
  }
  return cells
}

describe('figurineFromWorld', () => {
  it('returns null for a world with no tile layers', () => {
    expect(figurineFromWorld(createWorld())).toBeNull()
  })

  it('the flat bear portrait converts to one slice whose cells match the source layer exactly', () => {
    const world = createBearPortrait()
    const portrait = world.layers.find((layer) => layer.id === 'portrait')
    if (portrait === undefined) throw new Error('bear portrait lost its portrait layer')

    const figurine = figurineFromWorld(world, { exclude: ['floor'] })
    expect(figurine).not.toBeNull()
    if (figurine === null) return

    expect(figurine.size).toBe(16)
    expect(figurine.slices).toHaveLength(1)
    const slice = figurine.slices[0]
    expect(slice).toBeDefined()
    if (slice === undefined) return
    expect(slice.top).toBe(portrait.elevation) // 1
    expect(slice.base).toBe(0) // no `base` on a flat layer — plateau reading

    // Only one tileset is in play here, so the figurine's palette index and
    // the tileset's own cell value are the SAME number — a direct comparison.
    for (const { tx, ty } of everyCell(16)) {
      expect(figurineCellAt(slice, 16, tx, ty)).toBe(getCell(portrait, tx, ty))
    }
  })

  it('the bear figure converts to eighteen slices, each with the right top/base and matching cells', () => {
    const world = createBearFigure()
    const figurine = figurineFromWorld(world, { exclude: ['floor'] })
    expect(figurine).not.toBeNull()
    if (figurine === null) return

    expect(figurine.size).toBe(24)
    expect(figurine.slices).toHaveLength(18)

    for (let z = 1; z <= 18; z += 1) {
      const layer = world.layers.find((candidate) => candidate.id === `z${z}`)
      if (layer === undefined) throw new Error(`bear figure lost layer z${z}`)
      const slice = figurine.slices[z - 1]
      expect(slice).toBeDefined()
      if (slice === undefined) continue
      expect(slice.top).toBe(z)
      expect(slice.base).toBe(z - 1)
      for (const { tx, ty } of everyCell(24)) {
        expect(figurineCellAt(slice, 24, tx, ty)).toBe(getCell(layer, tx, ty))
      }
    }
  })

  it('exclude is the door a ground floor must leave through: kept in, its slab overlaps the figure and is refused loudly', () => {
    const world = createBearPortrait()
    // The portrait layer converts as the slab [0, 1] and the floor as
    // [0, 0] — two slabs claiming the same ground. A figurine is a STACK
    // (the renderer's above-slice culling depends on it), so the overlap is
    // a loud refusal, never a silent reshuffle.
    expect(() => figurineFromWorld(world)).toThrow(/stack, not a pile/)
    const withoutFloor = figurineFromWorld(world, { exclude: ['floor'] })
    expect(withoutFloor?.slices).toHaveLength(1)
    expect(withoutFloor?.slices[0]?.top).toBe(1) // the portrait layer's own elevation
  })

  it('palette hexes are resolved from the source tileset, in tile order', () => {
    const world = createBearPortrait()
    const tileset = world.tilesets.find((candidate) => candidate.id === 'portrait')
    if (tileset === undefined) throw new Error('bear portrait lost its tileset')

    const figurine = figurineFromWorld(world, { exclude: ['floor'] })
    expect(figurine).not.toBeNull()
    if (figurine === null) return

    // The portrait tileset's own tiles (facedTile) already carry explicit
    // left/right, so the resolved palette must equal them VERBATIM — no
    // shading fallback should have fired.
    expect(figurine.palette).toEqual(
      tileset.tiles.map((tile) => ({
        top: tile.colors.top,
        left: tile.colors.left,
        right: tile.colors.right,
      })),
    )
  })

  it('a tile with no explicit left/right falls back to the tilemap shading convention', () => {
    const bare: TileDef = { name: 'bare', colors: { top: '#4caf50' } }
    const world: World = createWorld({ settings: { tileSize: 1 } })
    world.tilesets.push({ id: 'bare', name: 'bare', tiles: [bare] })
    world.layers.push(
      createTileLayer({ id: 'a', width: 2, height: 2, tilesetId: 'bare', cells: [1, 1, 1, 1] }),
    )

    const figurine = figurineFromWorld(world)
    expect(figurine).not.toBeNull()
    if (figurine === null) return
    const swatch = figurine.palette[0]
    expect(swatch).toBeDefined()
    expect(swatch?.top).toBe('#4caf50')
    // The SOUTH/EAST wall shade factors @engine/tilemap's paintIso uses
    // (0.55 / 0.75), applied to the same top color.
    expect(swatch?.left).toBe('#29602c')
    expect(swatch?.right).toBe('#39833c')
  })

  it('refuses a footprint bigger than the cap, rather than cropping it', () => {
    const big = MAX_FIGURINE_SIZE + 1
    const world: World = createWorld({ settings: { tileSize: 1 } })
    world.tilesets.push({ id: 't', name: 't', tiles: [{ name: 'x', colors: { top: '#fff' } }] })
    world.layers.push(createTileLayer({ id: 'a', width: big, height: big, tilesetId: 't' }))
    expect(() => figurineFromWorld(world)).toThrow(/exceeds the/)
  })

  it('refuses a non-square layer, rather than stretching it', () => {
    const world: World = createWorld({ settings: { tileSize: 1 } })
    world.tilesets.push({ id: 't', name: 't', tiles: [{ name: 'x', colors: { top: '#fff' } }] })
    world.layers.push(createTileLayer({ id: 'a', width: 4, height: 3, tilesetId: 't' }))
    expect(() => figurineFromWorld(world)).toThrow(/square/)
  })
})

describe('readFigurine', () => {
  it('accepts a well-shaped figurine component and rejects malformed ones', () => {
    const good: Figurine = { size: 2, slices: [{ top: 1, base: 0, rows: ['..', '..'] }], palette: [] }
    expect(readFigurine({ id: 'e1', name: 'p', components: { figurine: good } })).toEqual(good)
    expect(readFigurine({ id: 'e1', name: 'p', components: {} })).toBeNull()
    expect(readFigurine({ id: 'e1', name: 'p', components: { figurine: 'not an object' } })).toBeNull()
    expect(
      readFigurine({ id: 'e1', name: 'p', components: { figurine: { size: 0, slices: [], palette: [] } } }),
    ).toBeNull()
    expect(
      readFigurine({
        id: 'e1',
        name: 'p',
        components: { figurine: { size: 2, slices: [{ top: 1, base: 'nope', rows: [] }], palette: [] } },
      }),
    ).toBeNull()
  })

  it('rejects the hand-edited shapes that would crash or hang the RENDERER, not just look wrong', () => {
    const at = (figurine: unknown) => readFigurine({ id: 'e1', name: 'p', components: { figurine } })
    // A character outside the figurine alphabet would make the draw path's
    // decode throw mid-frame — the exact opposite of the dot-fallback
    // contract — so it must die here, at the file boundary.
    expect(at({ size: 2, slices: [{ top: 1, base: 0, rows: ['!.', '..'] }], palette: [] })).toBeNull()
    // A row longer than the footprint smuggles the same crash in sideways.
    expect(at({ size: 2, slices: [{ top: 1, base: 0, rows: ['111', '..'] }], palette: [] })).toBeNull()
    // The size cap guards the size²-per-slice draw walk, not authoring
    // taste: an uncapped size would hang the tab on the first frame.
    expect(at({ size: 100000, slices: [{ top: 1, base: 0, rows: [] }], palette: [] })).toBeNull()
    // Slices must stack bottom-to-top without overlap — the invariant the
    // renderer's "next slice is the slab above" culling stands on.
    expect(
      at({
        size: 2,
        slices: [
          { top: 2, base: 1, rows: [] },
          { top: 1, base: 0, rows: [] },
        ],
        palette: [],
      }),
    ).toBeNull()
    // And a slab must have height: top strictly above base.
    expect(at({ size: 2, slices: [{ top: 1, base: 1, rows: [] }], palette: [] })).toBeNull()
    // Non-adjacent but ordered slabs (an air gap) remain perfectly legal.
    expect(
      at({
        size: 2,
        slices: [
          { top: 1, base: 0, rows: [] },
          { top: 5, base: 4, rows: [] },
        ],
        palette: [],
      }),
    ).not.toBeNull()
  })
})

describe('PIP_FIGURINE', () => {
  it('is the bear figure, converted — same footprint, eighteen slices, the floor left out', () => {
    expect(PIP_FIGURINE.size).toBe(24)
    expect(PIP_FIGURINE.slices).toHaveLength(18)
    expect(PIP_FIGURINE.slices[0]?.top).toBe(1)
    expect(PIP_FIGURINE.slices[17]?.top).toBe(18)
  })

  it('is deterministic: converting the fixture again produces the same figurine', () => {
    const again = figurineFromWorld(createBearFigure(), { exclude: ['floor'] })
    expect(again).toEqual(PIP_FIGURINE)
  })
})
