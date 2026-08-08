/**
 * The entity-banding contract — pinning a documented v1 tradeoff.
 *
 * bandAbove (views.ts) places every entity one depth band ABOVE the highest
 * layer at or below its feet. That single-band choice cannot reproduce the
 * taught x − y + z ordering in every configuration (the honesty box on
 * bandAbove names the two known artifacts), so the CHOICE itself is the
 * contract: a ground entity standing IN FRONT of a raised layer — at the
 * base of the wall the south-east camera can see — must paint ON TOP of that
 * layer's terrain, never sink behind its wall. This test locks the visible,
 * correct-looking configuration; the mis-sorted one (a ground entity hidden
 * BEHIND raised terrain showing through) is the accepted artifact until the
 * editor phase brings per-diagonal-strip queue items (docs/DECISIONS.md,
 * deferred table: "Per-cell iso paint-queue granularity").
 */

import { createWorld, spawn } from '@engine/core'
import type { Tileset } from '@engine/core'
import { createIso } from '@engine/projection'
import { createNullBackend } from '@engine/renderer'
import { createTileLayer } from '@engine/tilemap'
import type { RasterFactory } from '@engine/tilemap'
import { describe, expect, it } from 'vitest'
import { createView } from '../src/views'

/** Pixel-less rasters flip the layer renderer into per-tile polyline
 * commands, so the painting order is visible in the frame log. */
const nullRaster: RasterFactory = (width, height) => ({
  width,
  height,
  source: null,
  clear(): void {},
  fillRect(): void {},
  fillPoly(): void {},
})

const tileset: Tileset = {
  id: 'ts',
  name: 'banding tiles',
  tiles: [{ name: 'stone', colors: { top: '#9aa5b1' } }],
}

describe('entity banding (the v1 bandAbove contract)', () => {
  it('a ground entity in front of a raised layer draws on top of its terrain', () => {
    // The smallest world that shows the tradeoff: a 2×1 ground layer
    // (band 0, so the entity has a support and bands above it start at 1), a
    // raised 1×1 layer at elevation 1 (band 1) whose south and east walls
    // face the camera, and one ground entity at the base of the east wall —
    // world (1, 0.5, 0), touching the wall plane x = 1 from the front.
    const world = createWorld({ name: 'banding fixture' })
    world.tilesets.push(tileset)
    world.layers.push(
      createTileLayer({ id: 'ground', width: 2, height: 1, elevation: 0, layerBand: 0, tilesetId: 'ts', cells: [1, 1] }),
      createTileLayer({ id: 'plinth', width: 1, height: 1, elevation: 1, layerBand: 1, tilesetId: 'ts', cells: [1] }),
    )
    spawn(world, {
      name: 'crate',
      components: {
        position: { x: 1, y: 0.5 },
        elevation: { z: 0 },
        marker: { kind: 'crate' },
      },
    })

    const backend = createNullBackend()
    const view = createView({ projection: createIso(), world, raster: nullRaster })
    view.render(backend, { width: 640, height: 420, dpr: 1 }, { selection: null, hoverTile: null })

    const frame = backend.frames[0] ?? []
    const kinds = frame.filter((c) => c.kind !== 'begin' && c.kind !== 'end').map((c) => c.kind)

    // The ground layer emits two top faces; the raised layer emits three
    // faces (south wall, east wall, top); the entity emits its marker
    // (circle + label). bandAbove keys the ground entity into band 1 —
    // AFTER the band-1 layer's whole-layer queue item — so every terrain
    // polyline precedes the marker. If banding ever switched to support-band
    // keying, the circle would land between the two layers (the crate would
    // sink behind the wall base) and this pin breaks.
    expect(kinds).toEqual(['polyline', 'polyline', 'polyline', 'polyline', 'polyline', 'circle', 'text'])
  })
})
