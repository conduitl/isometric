/**
 * The starter world — what a first-run editor opens — and its stress-test twin.
 *
 * The starter is a CONTRACT, pinned at the bottom of ./types: tests, the e2e
 * flow, and Phase 3's first lessons all rely on its exact shape, so nothing
 * here is decorative. It is also deliberately friendly: the first thing a kid
 * sees should already look like a world — grass, a pond with a sandy shore,
 * a player standing in the middle — not a blank grid daring them to begin.
 *
 * Both worlds are built with ordinary engine calls (createWorld, spawn,
 * createTileLayer) and NO randomness beyond createRng(seed): building a world
 * is itself deterministic, so two calls produce byte-identical files — a fact
 * the tests pin by serializing twice. Both must also round-trip
 * parseWorld(serializeWorld(w)) cleanly, because a starter world the file
 * format refuses would strand the very first save a student ever makes.
 *
 * The perf world is the drag-paint arena for the Phase 2 perf gate: a full
 * MAX_LAYER_SIZE grid of mixed terrain, big enough that any per-frame
 * sloppiness in the paint path shows up on a Chromebook budget graph.
 */

import type { TileDef, Tileset, World } from '@engine/core'
import { createWorld, spawn } from '@engine/core'
import { createRng } from '@engine/math'
import { createTileLayer } from '@engine/tilemap'

// Cell values are 1-based into the tileset (0 = empty) — the off-by-one
// convention of @engine/core's Tileset, named here so the fill code reads.
const GRASS = 1
const WATER = 2
const SAND = 3

/**
 * Darken a #rrggbb color by multiplying each channel — the same
 * cheapest-believable-shadow trick @engine/tilemap uses for iso walls,
 * applied at authoring time so the tileset CARRIES its shades instead of
 * relying on renderer fallbacks. All inputs here are our own literals, so no
 * defensive parsing: a bad literal is a build bug and shows up in tests.
 */
function shade(color: string, factor: number): string {
  let out = '#'
  for (let i = 1; i < 7; i += 2) {
    const channel = Math.floor(parseInt(color.slice(i, i + 2), 16) * factor)
    out += Math.max(0, Math.min(255, channel))
      .toString(16)
      .padStart(2, '0')
  }
  return out
}

/**
 * One terrain tile with all four faces authored: the top color is the tile's
 * identity; the iso walls take the renderer's own lighting convention (south
 * face dark, east face lighter — lit from the north-west) and the profile
 * slab sits between. Explicit shades make the iso and profile lenses look
 * intentional rather than like fallbacks — a kid flipping projections should
 * see a designed world in every one.
 */
function terrainTile(name: string, top: string): TileDef {
  return {
    name,
    colors: { top, left: shade(top, 0.55), right: shade(top, 0.75), side: shade(top, 0.7) },
  }
}

/**
 * The 'terrain' tileset, grass first — so palette slot 1 is the obvious
 * brush the moment the editor opens (the contract in ./types says so).
 * Order is load-bearing: cell values in every starter/perf layer index into
 * this exact sequence.
 */
function terrainTileset(): Tileset {
  return {
    id: 'terrain',
    name: 'terrain',
    tiles: [
      terrainTile('grass', '#4a7c3a'),
      terrainTile('water', '#2b6cb0'),
      terrainTile('sand', '#d9b26b'),
      terrainTile('stone', '#8a8f98'),
      terrainTile('path', '#b58e5a'),
    ],
  }
}

/** The starter layer's pinned footprint (cells, not pixels — tileSize is 1). */
const STARTER_WIDTH = 32
const STARTER_HEIGHT = 24

/** The pond's cell box, inclusive: tx 5..8, ty 4..6. Small, off-center,
 * obviously paintable-over — an invitation, not a monument. */
const POND = { txMin: 5, txMax: 8, tyMin: 4, tyMax: 6 } as const

const inPond = (tx: number, ty: number): boolean =>
  tx >= POND.txMin && tx <= POND.txMax && ty >= POND.tyMin && ty <= POND.tyMax

/**
 * Build the pinned starter world (contract: ./types, "Starter document
 * contract"): name "my first world", top-down, tileSize 1, seed 7; the
 * 'terrain' tileset; one 32×24 ground layer (elevation 0, band 0) of grass
 * with a small water pond and a computed sand rim; one 'player' marker
 * entity standing on the center of the middle cell (16, 12) — that is, at
 * (16.5, 12.5). The sand rim is pure arithmetic — every grass
 * cell in the pond's one-cell neighborhood becomes sand — so "a beach goes
 * around water" is a rule the file demonstrates, not hand-placed pixels.
 */
export function createStarterWorld(): World {
  const world = createWorld({
    name: 'my first world',
    settings: { tileSize: 1, primaryProjection: 'topdown', seed: 7 },
  })
  world.tilesets.push(terrainTileset())

  const cells: number[] = new Array<number>(STARTER_WIDTH * STARTER_HEIGHT).fill(GRASS)
  for (let ty = POND.tyMin - 1; ty <= POND.tyMax + 1; ty += 1) {
    for (let tx = POND.txMin - 1; tx <= POND.txMax + 1; tx += 1) {
      // index = y·width + x — THE taught flat-array formula (@engine/tilemap).
      cells[ty * STARTER_WIDTH + tx] = inPond(tx, ty) ? WATER : SAND
    }
  }

  world.layers.push(
    createTileLayer({
      id: 'ground',
      name: 'ground',
      width: STARTER_WIDTH,
      height: STARTER_HEIGHT,
      elevation: 0,
      layerBand: 0,
      tilesetId: 'terrain',
      cells,
    }),
  )

  spawn(world, {
    name: 'player',
    components: {
      // The CENTER of cell (16, 12) — cell-dwellers stand on centers, half a
      // tile in from the corner (tileToWorld's +0.5 lesson; pinned in ./types).
      position: { x: 16.5, y: 12.5 },
      elevation: { z: 0 },
      marker: { kind: 'player' },
    },
  })

  return world
}

/** The marker kinds the perf world scatters — same trio the placer offers. */
const PERF_MARKERS = ['player', 'crate', 'tree'] as const

/** How many marker entities the perf world carries: enough that the entity
 * pass is exercised, few enough that tiles stay the measured cost. */
const PERF_ENTITY_COUNT = 9

/**
 * Build the perf gate's drag-paint arena: a size×size (default 256 — the
 * engine's per-layer cap) top-down world over the same terrain tileset,
 * every cell filled with a seeded-random mix of all five tiles, plus a
 * handful of marker entities. All "randomness" flows from createRng(seed) —
 * mulberry32 arithmetic, never Math.random — so the arena is the SAME arena
 * on every machine and every run, which is what makes its frame timings
 * comparable at all.
 */
export function createPerfWorld(size = 256): World {
  const world = createWorld({
    name: 'perf world',
    settings: { tileSize: 1, primaryProjection: 'topdown', seed: 4242 },
  })
  world.tilesets.push(terrainTileset())

  const rng = createRng(world.settings.seed)
  const cells: number[] = new Array<number>(size * size)
  for (let i = 0; i < cells.length; i += 1) {
    cells[i] = rng.int(1, 6) // uniform over the five tile values 1..5
  }

  world.layers.push(
    createTileLayer({
      id: 'ground',
      name: 'ground',
      width: size,
      height: size,
      elevation: 0,
      layerBand: 0,
      tilesetId: 'terrain',
      cells,
    }),
  )

  for (let i = 0; i < PERF_ENTITY_COUNT; i += 1) {
    const kind = PERF_MARKERS[i % PERF_MARKERS.length] ?? 'crate'
    spawn(world, {
      name: `${kind} ${i + 1}`,
      components: {
        // +0.5 puts each marker on a tile CENTER (tileToWorld's lesson).
        position: { x: rng.int(0, size) + 0.5, y: rng.int(0, size) + 0.5 },
        elevation: { z: 0 },
        marker: { kind },
      },
    })
  }

  return world
}
