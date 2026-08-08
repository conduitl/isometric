/**
 * The three-windows exit proofs, headless.
 *
 * Three properties, each guarding one leg of the demo's thesis:
 *
 * 1. **Render determinism** — assemble each view over the committed fixture
 *    with a pixel-less raster factory (which flips the layer renderer into
 *    per-tile draw commands — every polygon visible to hashing) and a
 *    recording backend, render twice, demand identical frame fingerprints.
 *    Same world, same matrix, same bytes, every time.
 * 2. **Picking round-trips** — for EVERY occupied cell, in ALL THREE
 *    projections: project the cell's center out to the screen, walk the
 *    inverse back with the appropriate one-number-back constraint, and land
 *    in the same cell. This is "two numbers in, three numbers out needs one
 *    number back" checked exhaustively, not anecdotally.
 * 3. **Opaque blobs survive** — the fixture deliberately carries a component
 *    no engine version knows ("secret"); it must ride through parse and
 *    serialize untouched, and the canonical writer must reproduce the
 *    committed file byte for byte (which is exactly what the Save button
 *    downloads).
 */

import { readFileSync } from 'node:fs'
import type { World } from '@engine/core'
import { Vec2 } from '@engine/math'
import { createIso, createProfile, createTopDown } from '@engine/projection'
import type { InverseConstraint, Projection } from '@engine/projection'
import { createNullBackend } from '@engine/renderer'
import { hashValue } from '@engine/testkit'
import { getCell, tileToWorld, worldToTile } from '@engine/tilemap'
import type { RasterFactory } from '@engine/tilemap'
import { parseWorld, serializeWorld } from '@engine/world-format'
import { describe, expect, it } from 'vitest'
import { createView } from '../src/views'

/** The committed fixture, read straight off disk — the node-side twin of the
 * app's ?raw import, asserting about the actual bytes in git. */
const fixtureText = readFileSync(new URL('../fixtures/island.world.json', import.meta.url), 'utf8')

/** Every test renders and picks at the same pinned viewport: view size feeds
 * fitCamera, so the proofs pin it (CSS pixels, dpr 1 — no device in the loop). */
const VIEW = { width: 640, height: 420, dpr: 1 } as const

/** The three lenses under test, freshly built per use (projections are pure
 * data + closures; a fresh one removes any doubt about shared state). */
const PROJECTIONS: ReadonlyArray<[string, () => Projection]> = [
  ['topdown', createTopDown],
  ['iso', createIso],
  ['profile', createProfile],
]

/** A raster factory with no pixel store: `source: null` is the layer
 * renderer's documented signal to emit plain per-tile commands. */
const nullRaster: RasterFactory = (width, height) => ({
  width,
  height,
  source: null,
  clear(): void {},
  fillRect(): void {},
  fillPoly(): void {},
})

function parseFixture(): { world: World; warnings: string[] } {
  const result = parseWorld(fixtureText)
  if (!result.ok) throw new Error(`fixture failed to parse: ${result.error.message}`)
  return { world: result.world, warnings: result.warnings }
}

describe('the committed island fixture', () => {
  it('parses cleanly through the strict ladder', () => {
    const { world, warnings } = parseFixture()
    expect(world.meta.name).toBe('island')
    expect(world.layers).toHaveLength(2)
    expect(Object.keys(world.entities)).toHaveLength(5)
    // The only heads-up should be the deliberate unknown component.
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"secret"')
  })
})

describe('render determinism (frame-hash, per projection)', () => {
  /** One full assembly-and-render from scratch; returns the frame fingerprint. */
  function renderHash(makeProjection: () => Projection): string {
    const { world } = parseFixture()
    const view = createView({ projection: makeProjection(), world, raster: nullRaster })
    const backend = createNullBackend()
    view.render(backend, VIEW, { selection: null, hoverTile: null })
    return hashValue(backend.frames)
  }

  for (const [name, makeProjection] of PROJECTIONS) {
    it(`${name}: two renders of the same world produce identical frames`, () => {
      expect(renderHash(makeProjection)).toBe(renderHash(makeProjection))
    })
  }
})

describe('picking round-trip (every occupied cell, every projection)', () => {
  for (const [name, makeProjection] of PROJECTIONS) {
    it(`${name}: worldToScreen ∘ screenToWorld returns every cell to itself`, () => {
      const { world } = parseFixture()
      const view = createView({ projection: makeProjection(), world, raster: nullRaster })
      // One render aims the camera exactly as the app would (fitCamera runs
      // inside render); the stack then holds the same matrices picking uses.
      view.render(createNullBackend(), VIEW, { selection: null, hoverTile: null })

      for (const layer of world.layers) {
        for (let ty = 0; ty < layer.height; ty += 1) {
          for (let tx = 0; tx < layer.width; tx += 1) {
            if (getCell(layer, tx, ty) === 0) continue

            const center = tileToWorld(world.settings, tx, ty)
            const screen = view.stack.worldToScreen({ x: center.x, y: center.y, z: layer.elevation })

            // The one-number-back constraint, chosen the way a tool would:
            // profile pins the lane it cannot see; the others pin the height
            // ('ground' when the cell sits at z = 0, its elevation otherwise).
            const constraint: InverseConstraint =
              name === 'profile'
                ? { kind: 'lane', y: center.y }
                : layer.elevation === 0
                  ? { kind: 'ground' }
                  : { kind: 'elevation', z: layer.elevation }

            const recovered = view.stack.screenToWorld(screen, constraint)
            expect(recovered).not.toBeNull()
            if (recovered === null) continue
            const cell = worldToTile(world.settings, Vec2.make(recovered.x, recovered.y))
            expect(cell).toEqual({ tx, ty })
            // The pinned/recovered height must be the cell's own storey.
            expect(recovered.z).toBeCloseTo(layer.elevation, 9)
          }
        }
      }
    })
  }
})

describe('forward compatibility and canonical bytes', () => {
  it('an unknown component survives parse → serialize untouched', () => {
    const { world } = parseFixture()
    const crate = world.entities['e4']
    expect(crate).toBeDefined()
    expect(crate?.components['secret']).toEqual({ note: 'opaque blobs survive' })

    // Round the whole world through the writer and reader again: the blob
    // must come back byte-equal in meaning — kept, not normalized away.
    const reparsed = parseWorld(serializeWorld(world))
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.world.entities['e4']?.components['secret']).toEqual({ note: 'opaque blobs survive' })
  })

  it('serializeWorld reproduces the committed fixture byte for byte', () => {
    // The canonical-writer promise, pinned to this exact file: what the Save
    // button downloads for the untouched fixture IS the committed fixture.
    const { world } = parseFixture()
    expect(serializeWorld(world)).toBe(fixtureText)
  })
})
