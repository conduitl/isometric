/**
 * Lesson fixture worlds — the stages a lesson can ask the host to set.
 *
 * A lesson's optional `fixture` field names an entry in {@link FIXTURES};
 * the tutorial host resolves the name here and swaps the document in through
 * the same public loadWorld door any Open/Import uses (tutorial-host.ts).
 * Fixtures are BUILT, not stored: ordinary engine calls, no randomness, so
 * two calls produce byte-identical documents — the same discipline as the
 * starter world (starter.ts), pinned by the round-trip test in
 * apps/editor/test/tutorial-host.test.ts.
 *
 * ## The showcase island
 *
 * The perspective-reveal backdrop (docs/ARCHITECTURE.md §4: the flagship
 * lesson runs on a fixture world worthy of all three lenses). Its shape is
 * the layered-island pattern of the Phase 1 demo's committed fixture
 * (apps/three-windows/fixtures/island.world.json, loaded by
 * apps/three-windows/src/world-fixture.ts) — water ringing sand ringing
 * grass, with a raised stone plateau as a SECOND tile layer at elevation 1
 * in depth band 1, and a few marker entities standing on and around it.
 * Credit where due: that fixture proved the two-storey composition renders
 * honestly in every projection; this one rebuilds the idea in code so the
 * editor never carries a second committed JSON to drift.
 *
 * Why every ring is arithmetic: the island is `d`, the cell's distance to
 * the nearest map edge — water where d < 2, sand exactly at d = 2, grass
 * inside. One formula, no hand-placed pixels, and the fixture stays
 * deterministic by construction.
 *
 * Why the plateau matters to the LESSON: top-down flattens it to a stone
 * patch (only color says "up"), iso raises real walls, and profile shows the
 * second storey edge-on — the same twelve numbers, three different pictures,
 * which IS the perspective reveal. The crates at the plateau's east wall
 * base give iso something to occlude and profile something to stack.
 */

import type { World } from '@engine/core'
import { createWorld, spawn } from '@engine/core'
import { createTileLayer } from '@engine/tilemap'
import { createStarterWorld } from './starter'

// Cell values, 1-based into the starter's terrain tileset (grass, water,
// sand, stone, path — starter.ts pins the order; 0 = empty).
const GRASS = 1
const WATER = 2
const SAND = 3
const STONE = 4

/** The island's pinned footprint, in cells. */
const ISLAND_WIDTH = 24
const ISLAND_HEIGHT = 18

/** Ring widths, from the map edge inward: water for d < 2, sand at d = 2. */
const WATER_RING = 2
const SAND_RING = WATER_RING + 1

/** The plateau's cell box on the second storey, inclusive. Chosen well
 * inside the grass interior, east of center, so its east wall faces open
 * ground where the crates stand. */
const PLATEAU = { txMin: 14, txMax: 18, tyMin: 7, tyMax: 11 } as const

/**
 * Build the perspective-reveal island: 24×18, top-down primary, the
 * starter's terrain tileset, a ground layer of water/sand/grass rings, a
 * raised stone plateau layer (elevation 1, band 1), and four markers —
 * player and tree on the grass, two crates at the base of the plateau's
 * east wall. Deterministic: same bytes on every call (the host test pins
 * serialize-twice equality and the parse round-trip).
 */
export function createShowcaseIsland(): World {
  const world = createWorld({
    name: 'showcase island',
    settings: { tileSize: 1, primaryProjection: 'topdown', seed: 12 },
  })

  // The tileset is TAKEN from the starter world rather than re-authored:
  // one authoring source (starter.ts's terrainTileset), zero drift — the
  // palette a student learned in lesson one is the palette this island
  // paints with.
  const starterTileset = createStarterWorld().tilesets[0]
  if (starterTileset === undefined) {
    throw new Error('showcase island: the starter world lost its terrain tileset')
  }
  world.tilesets.push(starterTileset)

  // The ground: every cell classified by d, its distance to the nearest map
  // edge — min of the four edge distances, the L∞ "how far inland am I".
  const ground: number[] = new Array<number>(ISLAND_WIDTH * ISLAND_HEIGHT)
  for (let ty = 0; ty < ISLAND_HEIGHT; ty += 1) {
    for (let tx = 0; tx < ISLAND_WIDTH; tx += 1) {
      const d = Math.min(tx, ty, ISLAND_WIDTH - 1 - tx, ISLAND_HEIGHT - 1 - ty)
      // index = y·width + x — THE taught flat-array formula.
      ground[ty * ISLAND_WIDTH + tx] = d < WATER_RING ? WATER : d < SAND_RING ? SAND : GRASS
    }
  }

  // The plateau storey: empty except the stone box. Full map footprint so
  // the box can sit east of center (layers are anchored at the world
  // origin — a smaller layer could only hug the north-west corner).
  const plateau: number[] = new Array<number>(ISLAND_WIDTH * ISLAND_HEIGHT).fill(0)
  for (let ty = PLATEAU.tyMin; ty <= PLATEAU.tyMax; ty += 1) {
    for (let tx = PLATEAU.txMin; tx <= PLATEAU.txMax; tx += 1) {
      plateau[ty * ISLAND_WIDTH + tx] = STONE
    }
  }

  world.layers.push(
    createTileLayer({
      id: 'ground',
      name: 'ground',
      width: ISLAND_WIDTH,
      height: ISLAND_HEIGHT,
      elevation: 0,
      layerBand: 0,
      tilesetId: 'terrain',
      cells: ground,
    }),
    createTileLayer({
      id: 'plateau',
      name: 'plateau',
      width: ISLAND_WIDTH,
      height: ISLAND_HEIGHT,
      elevation: 1,
      layerBand: 1,
      tilesetId: 'terrain',
      cells: plateau,
    }),
  )

  // Markers stand on cell CENTERS (tileToWorld's +0.5 lesson), all on the
  // ground storey: the player mid-island with the plateau to their east,
  // the two crates against the plateau's east wall base (tx one past
  // PLATEAU.txMax), the tree on the south-west grass.
  spawn(world, {
    name: 'player',
    components: { position: { x: 8.5, y: 9.5 }, elevation: { z: 0 }, marker: { kind: 'player' } },
  })
  spawn(world, {
    name: 'crate a',
    components: { position: { x: 19.5, y: 8.5 }, elevation: { z: 0 }, marker: { kind: 'crate' } },
  })
  spawn(world, {
    name: 'crate b',
    components: { position: { x: 19.5, y: 10.5 }, elevation: { z: 0 }, marker: { kind: 'crate' } },
  })
  spawn(world, {
    name: 'tree',
    components: { position: { x: 6.5, y: 13.5 }, elevation: { z: 0 }, marker: { kind: 'tree' } },
  })

  return world
}

/**
 * The fixture catalogue the tutorial host resolves lesson `fixture` ids
 * against. Values are BUILDERS, not worlds: every load gets a fresh
 * document, so a lesson restarted after edits meets a clean stage.
 * Additive like every other lesson-facing registry: shipped lesson data
 * names these ids forever, so add — never rename, never remove.
 */
export const FIXTURES: Readonly<Record<string, () => World>> = {
  'showcase-island': createShowcaseIsland,
}
