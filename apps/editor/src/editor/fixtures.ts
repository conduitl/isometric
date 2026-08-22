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
 *
 * ## The bear portrait
 *
 * The 'paint-by-numbers' lesson's stage (content/lessons/src/lesson-00-*):
 * a small pixel-art character, authored as a WORLD rather than an image.
 * Nothing about the format changes — it is still a tileset, a tile layer, a
 * grid of 1-based cell values — the only difference from every terrain
 * fixture above is that the tileset's colors read as a character's fur and
 * feathers instead of grass and water. That is deliberately the point: the
 * editor a student paints terrain with is, unmodified, a pixel-art tool,
 * and a portrait built this way could later be IMPORTED into a bigger world
 * as a sprite layer — the asset-pipeline idea this fixture foreshadows
 * without yet building.
 *
 * Two fixtures share one authoring source (`bearPortraitCells`, below): the
 * FINISHED portrait (`bear-portrait`) and a START world (`bear-portrait-
 * start`) that is the same cells with a handful blanked back to empty. Those
 * blanked cells are not incidental — they ARE the lesson: each one is the
 * exact target of one lesson step (an `atCell` completion the student
 * satisfies by painting that one cell). One shared cell source means the
 * finished picture and the "what's missing" picture can never drift apart.
 *
 * ## The bear figure (voxel)
 *
 * The voxel sibling of the flat portrait above — same character, now with
 * the THIRD coordinate. Where the portrait is one 16×16 picture, the figure
 * (`bear-figure` / `bear-figure-start`) is eighteen 24×24 picture SLICES,
 * one per z from 1 to 18, each its own tile layer stacked straight up:
 * layer `z11` carries exactly the cells that would be at height 11. (The
 * wider footprint is a lesson of its own: a voxel needs more room than a
 * pixel — at 16 the ears were single blocks and the face a smear.) Every
 * slice is a `base: z − 1` SLAB (@engine/core's TileLayer.base) — one unit
 * tall, rooted one below its own elevation — which is what keeps eighteen
 * stacked layers honest: without `base`, each slice's iso walls would drop
 * all the way to the ground and paint straight through the slices beneath
 * it, and in profile the stack would read as venetian blinds instead of a
 * solid column.
 * Same authoring discipline as the portrait pair, one dimension up: the
 * finished figure and its gapped start world decode from the same slice art
 * (below), so they cannot drift apart either.
 */

import type { TileLayer, Tileset, World } from '@engine/core'
import { createWorld, spawn } from '@engine/core'
import { createTileLayer } from '@engine/tilemap'
import { createStarterWorld, facedTile } from './starter'

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

/** The distance-picture stage, in cells: an 8×8 grass field is all the
 * 3-4-5 triangle needs — small enough that every cell is countable. */
const PICTURE_SIZE = 8

/**
 * Build the 3-4-5 portrait stage for lesson figures: an 8×8 grass field
 * with a player at the center of cell (1, 1) and a crate at the center of
 * cell (4, 5) — legs 3 east and 4 north, so the right-triangle overlay a
 * figure draws over it MEASURES 3, 4, and 5 from the marker positions
 * themselves. The numbers in the picture are computed, never typed, which
 * is the whole point of a `scene` figure. Deterministic like every fixture:
 * plain arithmetic, no randomness, same bytes every call.
 */
export function createDistancePicture(): World {
  const world = createWorld({
    name: 'distance picture',
    settings: { tileSize: 1, primaryProjection: 'topdown', seed: 12 },
  })

  // Same one authoring source as the island: the starter's terrain tileset.
  const starterTileset = createStarterWorld().tilesets[0]
  if (starterTileset === undefined) {
    throw new Error('distance picture: the starter world lost its terrain tileset')
  }
  world.tilesets.push(starterTileset)

  world.layers.push(
    createTileLayer({
      id: 'ground',
      name: 'ground',
      width: PICTURE_SIZE,
      height: PICTURE_SIZE,
      elevation: 0,
      layerBand: 0,
      tilesetId: 'terrain',
      cells: new Array<number>(PICTURE_SIZE * PICTURE_SIZE).fill(GRASS),
    }),
  )

  // Cell centers (the +0.5 lesson): (1,1) → (1.5, 1.5), (4,5) → (4.5, 5.5).
  // Deltas 3 and 4 — the legs the figure's triangle measures.
  spawn(world, {
    name: 'player',
    components: { position: { x: 1.5, y: 1.5 }, elevation: { z: 0 }, marker: { kind: 'player' } },
  })
  spawn(world, {
    name: 'crate',
    components: { position: { x: 4.5, y: 5.5 }, elevation: { z: 0 }, marker: { kind: 'crate' } },
  })

  return world
}

// --- the bear portrait ------------------------------------------------------

// Cell values, 1-based into the portrait's OWN tileset (portraitTileset,
// below pins the order; 0 = empty) — a separate palette from starter.ts's
// terrain tileset, because this world paints a character, not ground.
const BEAR_BROWN = 1
const CHICK_YELLOW = 2
const BEAK_ORANGE = 3
const CREAM_WHITE = 4
const INK_BLACK = 5
const FLOOR_LIGHT = 6
const FLOOR_DARK = 7

/** The 'portrait' tileset: the five character colors the art below paints
 * with, plus a light/dark pair for the checkered floor beneath it. */
function portraitTileset(): Tileset {
  return {
    id: 'portrait',
    name: 'portrait',
    tiles: [
      facedTile('bear brown', '#a97a50'),
      facedTile('chick yellow', '#ffd94d'),
      facedTile('beak orange', '#f49b33'),
      facedTile('cream white', '#fff6e8'),
      facedTile('ink black', '#2b2117'),
      facedTile('floor light', '#e9e4d8'),
      facedTile('floor dark', '#ddd7c6'),
    ],
  }
}

/** The portrait's pinned footprint, in cells — square, small enough that a
 * kid can find any one cell by eye. Both bear fixtures share this size. */
const BEAR_SIZE = 16

/**
 * The portrait, as SCREEN rows — row 0 is the TOP of the picture, exactly as
 * it reads on the page. `.` empty, `B` bear brown, `Y` chick yellow, `O` beak
 * orange, `W` cream white, `K` ink black. Kept here as ASCII (not just as
 * numbers) so the art stays VISIBLE in the source — the literate move this
 * whole fixture is built around.
 */
const BEAR_ROWS: readonly string[] = [
  '.......K........',
  '..BB.YYYYYY.BB..',
  '..BBYYYOOYYYBB..',
  '...YYKYOOYKYY...',
  '...YYYYYYYYYY...',
  '..YYBBBBBBBBYY..',
  '..YBBBBBBBBBBY..',
  '..YBBKBBBBKBBY..',
  '..YBBBWWWWBBBY..',
  '...BBBWKKWBBB...',
  '....BBWWWWBB....',
  '...YYYYYYYYYY...',
  '..BBYYYYYYYYBB..',
  '..BBYYWWWWYYBB..',
  '...BBWWWWWWBB...',
  '..BYYBWWWWBYYB..',
]

/** ASCII character → cell value, for decoding {@link BEAR_ROWS}. */
const BEAR_CHARS: Readonly<Record<string, number>> = {
  '.': 0,
  B: BEAR_BROWN,
  Y: CHICK_YELLOW,
  O: BEAK_ORANGE,
  W: CREAM_WHITE,
  K: INK_BLACK,
}

/**
 * Decode SCREEN-orientation ASCII rows (row 0 = the TOP of the picture,
 * exactly as it reads on the page) into a flat row-major cell array. The one
 * thing worth pausing on is the FLIP: engine cells are row-major with ty = 0
 * the SOUTH edge of the map, which a top-down render draws at the BOTTOM of
 * the screen (@engine/tilemap's y-down screen convention meets the engine's
 * y-up-is-north cell convention right here). So screen row `r` (0 = top) is
 * engine row `ty = size − 1 − r`, NOT `ty = r`. Getting this backwards paints
 * the picture upside down while every individual pixel still "looks right"
 * read in isolation — which is exactly why the flip is worth a named
 * function and a comment instead of a clever one-liner: it IS a coordinates
 * lesson, not a formatting detail. `label` names the caller in error
 * messages. Shared by the bear portrait (one picture) and the bear figure
 * (ten stacked picture slices) below — same convention, different art.
 */
function decodeCharRows(
  rows: readonly string[],
  size: number,
  chars: Readonly<Record<string, number>>,
  label: string,
): number[] {
  const cells = new Array<number>(size * size).fill(0)
  for (let r = 0; r < size; r += 1) {
    const row = rows[r]
    if (row === undefined || row.length !== size) {
      throw new Error(`${label}: row ${r} must be exactly ${size} characters`)
    }
    const ty = size - 1 - r // the flip — see the doc comment above
    for (let tx = 0; tx < size; tx += 1) {
      const value = chars[row[tx] ?? '']
      if (value === undefined) {
        throw new Error(`${label}: unknown character '${row[tx]}' at row ${r}, column ${tx}`)
      }
      cells[ty * size + tx] = value
    }
  }
  return cells
}

/** Decode {@link BEAR_ROWS} — see {@link decodeCharRows} for the flip. */
function decodeBearPortraitRows(rows: readonly string[]): number[] {
  return decodeCharRows(rows, BEAR_SIZE, BEAR_CHARS, 'bear portrait')
}

/** The floor beneath the portrait: a plain light/dark checker, arithmetic
 * like every other fixture's ground — no hand-placed pixels. */
function checkerFloorCells(size: number): number[] {
  const cells = new Array<number>(size * size)
  for (let ty = 0; ty < size; ty += 1) {
    for (let tx = 0; tx < size; tx += 1) {
      cells[ty * size + tx] = (tx + ty) % 2 === 0 ? FLOOR_LIGHT : FLOOR_DARK
    }
  }
  return cells
}

/**
 * The lesson's gaps: engine-space (tx, ty) cells the START world blanks back
 * to empty, and the exact tile each one is missing. These four cells ARE the
 * 'paint-by-numbers' lesson — each is one step's `atCell` completion target,
 * satisfied only by painting THAT cell with THAT tile (a bare tile-match
 * would complete on any cell; see @engine/tutorial's `atCell` predicate).
 * One list, read by both bear builders below, so the finished portrait, the
 * start world's holes, and the lesson's targets can never drift apart.
 */
const BEAR_GAPS: readonly { readonly tx: number; readonly ty: number; readonly tile: number }[] = [
  { tx: 5, ty: 8, tile: INK_BLACK },
  { tx: 10, ty: 8, tile: INK_BLACK },
  { tx: 7, ty: 15, tile: INK_BLACK },
  { tx: 3, ty: 0, tile: CHICK_YELLOW },
]

/** Build the two portrait-layer stacks (portrait + floor, in that order) that
 * both bear worlds share, so the world-shell code below reads as just the
 * parts that differ between them. */
function bearLayers(portraitCells: number[]) {
  return [
    // FIRST: session.loadWorld activates layers[0], so this is the
    // paintable, grid-bearing layer the moment the fixture loads.
    createTileLayer({
      id: 'portrait',
      name: 'portrait',
      width: BEAR_SIZE,
      height: BEAR_SIZE,
      elevation: 1,
      layerBand: 1,
      tilesetId: 'portrait',
      cells: portraitCells,
    }),
    // Render order is by layerBand, not array order, so this still paints
    // beneath the portrait despite sitting second in the array.
    createTileLayer({
      id: 'floor',
      name: 'floor',
      width: BEAR_SIZE,
      height: BEAR_SIZE,
      elevation: 0,
      layerBand: 0,
      tilesetId: 'portrait',
      cells: checkerFloorCells(BEAR_SIZE),
    }),
  ]
}

/**
 * Build the FINISHED bear portrait: 16×16, top-down, the 'portrait' tileset
 * (a character palette, not terrain), a 'portrait' character layer over a
 * checkered 'floor' layer, no entities. Deterministic like every fixture:
 * the art decodes from the same literal ASCII on every call, so two calls
 * produce byte-identical documents (pinned in tutorial-host.test.ts).
 */
export function createBearPortrait(): World {
  const world = createWorld({
    name: 'bear portrait',
    settings: { tileSize: 1, primaryProjection: 'topdown', seed: 21 },
  })
  world.tilesets.push(portraitTileset())
  world.layers.push(...bearLayers(decodeBearPortraitRows(BEAR_ROWS)))
  return world
}

/**
 * Build the START world for the 'paint-by-numbers' lesson: the SAME portrait
 * as {@link createBearPortrait}, minus the {@link BEAR_GAPS} cells, blanked
 * back to empty. Built from the one shared cell source (decode, then blank)
 * so the finished picture and "what's missing" can never drift apart — the
 * gaps this leaves ARE the lesson, one per step.
 */
export function createBearPortraitStart(): World {
  const world = createWorld({
    name: 'bear portrait — start',
    settings: { tileSize: 1, primaryProjection: 'topdown', seed: 21 },
  })
  world.tilesets.push(portraitTileset())

  const cells = decodeBearPortraitRows(BEAR_ROWS)
  for (const gap of BEAR_GAPS) {
    // The gap's declared tile is a CONTRACT with the finished art (and,
    // through the drift guard, with the lesson's atCell gates) — check it
    // against the decode before blanking, so an edit to BEAR_ROWS that
    // recolors a gap cell fails loudly here instead of shipping a lesson
    // that asks for a color the finished portrait no longer holds.
    const held = cells[gap.ty * BEAR_SIZE + gap.tx]
    if (held !== gap.tile) {
      throw new Error(
        `bear portrait: gap (${gap.tx}, ${gap.ty}) declares tile ${gap.tile} but the art holds ${held}`,
      )
    }
    cells[gap.ty * BEAR_SIZE + gap.tx] = 0
  }

  world.layers.push(...bearLayers(cells))
  return world
}

// --- the bear figure (voxel) -------------------------------------------------

/** The figure's footprint, in cells — wider than the flat portrait's 16,
 * because a voxel needs more room than a pixel: at 16 an ear was one block
 * and the face a smear; at 24 every feature is big enough to survive the
 * iso camera. */
const FIGURE_SIZE = 24

/** How many z-slices the figure stacks — layers `z1`..`z{FIGURE_SLICE_COUNT}`. */
const FIGURE_SLICE_COUNT = 18

/**
 * The figure, as eighteen SCREEN-row slices — `FIGURE_SLABS[z - 1]` is slice
 * z's art, same top-row-first convention and same five-color alphabet as
 * {@link BEAR_ROWS} (`decodeCharRows` reads both the same way). Read bottom
 * to top: z1-2 feet and haunches, z3-7 body (flat chest plane — round bodies
 * staircase in voxels), z8 the neck pinch, z9-16 the hooded head with its
 * flat face wall (brown face, white muzzle, the nose ON the muzzle, 2×2
 * eyes, the proud orange beak, the hood's own eyes), z17 the dome cap,
 * z18 ear tips and the feather sprig. Stack all eighteen in your head and
 * the bear reappears, one slab per layer.
 */
const FIGURE_SLABS: readonly (readonly string[])[] = [
  // z = 1
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '...........BB...........',
    '........BBBBBBBB........',
    '......BBBBBBBBBBBB......',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '......BBBBBBBBBBBB......',
    '........BBBBBBBB........',
    '...........BB...........',
    '........................',
    '....BBBBB......BBBBB....',
    '....BBBBB......BBBBB....',
    '....YYYYY......YYYYY....',
    '........................',
    '........................',
  ],
  // z = 2
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '...........BB...........',
    '........BBBBBBBB........',
    '......BBBBBBBBBBBB......',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '......BBBBBBBBBBBB......',
    '........BWWBBWWB........',
    '...........WW...........',
    '........................',
    '....BBBBB......BBBBB....',
    '....BBBBB......BBBBB....',
    '....YYYYW......WYYYY....',
    '........................',
    '........................',
  ],
  // z = 3
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........BBBBBBBB........',
    '.......BBBBBBBBBB.......',
    '......BBBBBBBBBBBB......',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '..BBBBBBBBBBBBBBBBBBBB..',
    '..BBBBBBBBBBBBBBBBBBBB..',
    '..BBB.BBBBBBBBBBBB.BBB..',
    '..BBB..BBBBBBBBBB..BBB..',
    '..BBB...WWWWWWWW...BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '........................',
    '........................',
    '........................',
  ],
  // z = 4
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........BBBBBBBB........',
    '.......BBBBBBBBBB.......',
    '......BBBBBBBBBBBB......',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '..BBBBBBBBBBBBBBBBBBBB..',
    '..BBBBBBBBBBBBBBBBBBBB..',
    '..BBB.BBBBBBBBBBBB.BBB..',
    '..BBB..BBBBBBBBBB..BBB..',
    '..BBB...WWWWWWWW...BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '........................',
    '........................',
    '........................',
  ],
  // z = 5
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '.........BBBBBB.........',
    '.......BBBBBBBBBB.......',
    '......BBBBBBBBBBBB......',
    '......BBBBBBBBBBBB......',
    '.....BBBBBBBBBBBBBB.....',
    '..BBBBBBBBBBBBBBBBBBBB..',
    '..BBB.BBBBBBBBBBBB.BBB..',
    '..BBB.BBBBBBBBBBBB.BBB..',
    '..BBB..BWBBBBBBWB..BBB..',
    '..BBB....WWWWWW....BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '........................',
    '........................',
    '........................',
  ],
  // z = 6
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '..........BBBB..........',
    '........BBBBBBBB........',
    '.......BBBBBBBBBB.......',
    '......BBBBBBBBBBBB......',
    '......BBBBBBBBBBBB......',
    '..BBB.BBBBBBBBBBBB.BBB..',
    '..BBB.BBBBBBBBBBBB.BBB..',
    '..BBB..YBBBBBBBBY..BBB..',
    '..BBB...YYBBBBYY...BBB..',
    '..BBB.....YYYY.....BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '........................',
    '........................',
    '........................',
  ],
  // z = 7
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........BBBBBBBB........',
    '.......BBBBBBBBBB.......',
    '......BBBBBBBBBBBB......',
    '......BBBBBBBBBBBB......',
    '..BBB.BBBBBBBBBBBB.BBB..',
    '..BBB.BBBBBBBBBBBB.BBB..',
    '..BBB..YBBBBBBBBY..BBB..',
    '..BBB...YYYYYYYY...BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '..BBB..............BBB..',
    '........................',
    '........................',
    '........................',
  ],
  // z = 8
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '...........YY...........',
    '.........YYYYYY.........',
    '........YYYYYYYY........',
    '.......YYYYYYYYYY.......',
    '.......YYYYYYYYYY.......',
    '........YYYYYYYY........',
    '.........YYYYYY.........',
    '...........YY...........',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  // z = 9
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '.........YYYYYY.........',
    '.......YYYYYYYYYY.......',
    '......YYYYYYYYYYYY......',
    '.....YYYYYYYYYYYYYY.....',
    '.....YYYYYYYYYYYYYY.....',
    '.....YYYYYYYYYYYYYY.....',
    '.....YYYYYYYYYYYYYY.....',
    '.....YYYYYYYYYYYYYY.....',
    '......YYYYYYYYYYYY......',
    '.......BWWWWWWWWB.......',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  // z = 10
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '...........YY...........',
    '........YYYYYYYY........',
    '......YYYYYYYYYYYY......',
    '.....YYYYYYYYYYYYYY.....',
    '.....YYYYYYYYYYYYYY.....',
    '.....YYYYYYYYYYYYYY.....',
    '....YYYYYYYYYYYYYYYY....',
    '.....YYYYYYYYYYYYYY.....',
    '.....YYYYYYYYYYYYYY.....',
    '.....YYYYYYYYYYYYYY.....',
    '......YBWWWWWWWWBY......',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  // z = 11
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '.........YYYYYY.........',
    '.......YYYYYYYYYY.......',
    '......YYYYYYYYYYYY......',
    '.....YYYYYYYYYYYYYY.....',
    '....YYYYYYYYYYYYYYYY....',
    '....YYYYYYYYYYYYYYYY....',
    '....YYYYYYYYYYYYYYYY....',
    '....YYYYYYYYYYYYYYYY....',
    '....YYYYYYYYYYYYYYYY....',
    '.....YYYYYYYYYYYYYY.....',
    '......YBWWWKKWWWBY......',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  // z = 12
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '.........YYYYYY.........',
    '.......YYYYYYYYYY.......',
    '......YYYYYYYYYYYY......',
    '.....YYYYYYYYYYYYYY.....',
    '....YYYYYYYYYYYYYYYY....',
    '....YYYYYYYYYYYYYYYY....',
    '....YYYYYYYYYYYYYYYY....',
    '....YYYYYYYYYYYYYYYY....',
    '....YYYYYYYYYYYYYYYY....',
    '.....YYYYYYYYYYYYYY.....',
    '......YBKKBBBBKKBY......',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  // z = 13
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '..........YYYY..........',
    '.......YYYYYYYYYY.......',
    '......YYYYYYYYYYYY......',
    '.....YYYYYYYYYYYYYY.....',
    '.....YYYYYYYYYYYYYY.....',
    '....YYYYYYYYYYYYYYYY....',
    '....YYYYYYYYYYYYYYYY....',
    '....YYYYYYYYYYYYYYYY....',
    '.....YYYYYYYYYYYYYY.....',
    '.....YYYYYYYYYYYYYY.....',
    '......YBKKBBBBKKBY......',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  // z = 14
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '...........YY...........',
    '........YYYYYYYY........',
    '......YYYYYYYYYYYY......',
    '.....YYYYYYYYYYYYYY.....',
    '.....YYYYYYYYYYYYYY.....',
    '....BYYYYYYYYYYYYYYB....',
    '...BBBYYYYYYYYYYYYBBB...',
    '...BBBYYYYYYYYYYYYBBB...',
    '....BYYYYYYYYYYYYYYB....',
    '.....YYYYYYYYYYYYYY.....',
    '......YYYYYYYYYYYY......',
    '..........OOOO..........',
    '..........OOOO..........',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  // z = 15
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '.........YYYYYY.........',
    '.......YYYYYYYYYY.......',
    '......YYYYYYYYYYYY......',
    '.....YYYYYYYYYYYYYY.....',
    '...BBBYYYYYYYYYYYYBBB...',
    '..BBBBYYYYYYYYYYYYBBBB..',
    '..BBBBYYYYYYYYYYYYBBBB..',
    '...BBBYYYYYYYYYYYYBBB...',
    '......YYYYYYYYYYYY......',
    '.......KYYYYYYYYK.......',
    '..........OOOO..........',
    '..........OOOO..........',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  // z = 16
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........YYYYYYYY........',
    '.......YYYYYYYYYY.......',
    '......YYYYYYYYYYYY......',
    '..BBBBYYYYYYYYYYYYBBBB..',
    '..BBBBBYYYYYYYYYYBBBBB..',
    '..BBBBBYYYYYYYYYYBBBBB..',
    '..BBBBYYYYYYYYYYYYBBBB..',
    '.......YYYYYYYYYY.......',
    '........YYYYYYYY........',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  // z = 17
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '.........YYYYYY.........',
    '........YYYYYYYY........',
    '..BBBB.YYYYYYYYYY.BBBB..',
    '..BBBBBYYYYYYYYYYBBBBB..',
    '..BBBBBYYYYYYYYYYBBBBB..',
    '..BBBB..YYYYYYYY..BBBB..',
    '.........YYYYYY.........',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  // z = 18
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '...BB..............BB...',
    '..BBBB.....KK.....BBBB..',
    '..BBBB............BBBB..',
    '...BB..............BB...',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
]

/**
 * Decode every {@link FIGURE_SLABS} entry into its cell array — index i holds
 * slice z = i + 1's cells. Computed once per call site (not module-level) so
 * `createBearFigureStart` can blank its gaps into its OWN copy without
 * disturbing `createBearFigure`'s.
 */
function decodeFigureSlices(): number[][] {
  return FIGURE_SLABS.map((rows, i) => decodeCharRows(rows, FIGURE_SIZE, BEAR_CHARS, `bear figure z=${i + 1}`))
}

/**
 * The figure's gaps — the voxel sibling of {@link BEAR_GAPS}: four blocks
 * named by SLICE (z, not layer id) plus (tx, ty) and the tile each one is
 * missing in the START world. Same contract: {@link createBearFigureStart}
 * checks each cell against the finished art before blanking it, so an edit
 * to {@link FIGURE_SLABS} that recolors a gap cell fails loudly instead of
 * shipping a mismatched target.
 */
const FIGURE_GAPS: readonly { readonly z: number; readonly tx: number; readonly ty: number; readonly tile: number }[] = [
  { z: 1, tx: 6, ty: 2, tile: CHICK_YELLOW }, // foot-pad front block
  { z: 11, tx: 12, ty: 9, tile: INK_BLACK }, // half of the nose (roofed by z12)
  { z: 14, tx: 13, ty: 7, tile: BEAK_ORANGE }, // beak corner (seven empty slices below)
  { z: 18, tx: 12, ty: 13, tile: INK_BLACK }, // half of the feather sprig
]
/**
 * Build the figure's full layer stack from its eighteen decoded slices: layers
 * `z1`..`z{FIGURE_SLICE_COUNT}` (elevation z, `base: z − 1` — one-unit-tall
 * slabs, see TileLayer.base's doc comment for why the stack needs them),
 * THEN `floor` (the same checker {@link bearLayers} draws beneath the flat
 * portrait). `layers[0]` is `z1`, so — exactly like `bearLayers` making the
 * portrait layer active on load — the first slice is the paintable, grid-
 * bearing layer the moment the fixture loads.
 */
function figureLayers(sliceCells: readonly number[][]): TileLayer[] {
  const layers: TileLayer[] = []
  for (let z = 1; z <= FIGURE_SLICE_COUNT; z += 1) {
    const cells = sliceCells[z - 1]
    if (cells === undefined) {
      throw new Error(`bear figure: missing slice z=${z}`)
    }
    layers.push(
      createTileLayer({
        id: `z${z}`,
        name: `z = ${z}`,
        width: FIGURE_SIZE,
        height: FIGURE_SIZE,
        elevation: z,
        base: z - 1,
        layerBand: z,
        tilesetId: 'portrait',
        cells,
      }),
    )
  }
  layers.push(
    createTileLayer({
      id: 'floor',
      name: 'floor',
      width: FIGURE_SIZE,
      height: FIGURE_SIZE,
      elevation: 0,
      layerBand: 0,
      tilesetId: 'portrait',
      cells: checkerFloorCells(FIGURE_SIZE),
    }),
  )
  return layers
}

/**
 * Build the FINISHED bear figure: 24×24×18, ISO primary (this world IS the
 * 3D one — no reason to open it top-down), the SAME 'portrait' tileset the
 * flat portrait uses (one palette across both Pips), eighteen voxel-slice layers
 * over a checkered floor, no entities. Deterministic like every fixture: the
 * art decodes from the same literal ASCII on every call, so two calls
 * produce byte-identical documents (pinned in tutorial-host.test.ts).
 */
export function createBearFigure(): World {
  const world = createWorld({
    name: 'bear figure',
    settings: { tileSize: 1, primaryProjection: 'iso', seed: 33 },
  })
  world.tilesets.push(portraitTileset())
  world.layers.push(...figureLayers(decodeFigureSlices()))
  return world
}

/**
 * Build the START world for the voxel sibling of the paint-by-numbers
 * lesson: the SAME figure as {@link createBearFigure}, minus the
 * {@link FIGURE_GAPS} cells, blanked back to empty — four gaps at four heights,
 * mirroring {@link createBearPortraitStart}'s "assert the art, then blank"
 * shape, one dimension up.
 */
export function createBearFigureStart(): World {
  const world = createWorld({
    name: 'bear figure — start',
    settings: { tileSize: 1, primaryProjection: 'iso', seed: 33 },
  })
  world.tilesets.push(portraitTileset())

  const sliceCells = decodeFigureSlices()
  for (const gap of FIGURE_GAPS) {
    const cells = sliceCells[gap.z - 1]
    if (cells === undefined) {
      throw new Error(`bear figure: gap names slice z=${gap.z}, which does not exist`)
    }
    const held = cells[gap.ty * FIGURE_SIZE + gap.tx]
    if (held !== gap.tile) {
      throw new Error(
        `bear figure: gap z=${gap.z} (${gap.tx}, ${gap.ty}) declares tile ${gap.tile} but the art holds ${held}`,
      )
    }
    cells[gap.ty * FIGURE_SIZE + gap.tx] = 0
  }

  world.layers.push(...figureLayers(sliceCells))
  return world
}

/**
 * The fixture catalogue the tutorial host resolves lesson `fixture` ids
 * against — and, since figures shipped, the registry `scene` lesson figures
 * resolve their `fixture` ids through too (ui/panels/LessonFigure.tsx).
 * Values are BUILDERS, not worlds: every load gets a fresh document, so a
 * lesson restarted after edits meets a clean stage.
 * Additive like every other lesson-facing registry: shipped lesson data
 * names these ids forever, so add — never rename, never remove.
 */
export const FIXTURES: Readonly<Record<string, () => World>> = {
  'distance-picture': createDistancePicture,
  'showcase-island': createShowcaseIsland,
  'bear-portrait': createBearPortrait,
  'bear-portrait-start': createBearPortraitStart,
  'bear-figure': createBearFigure,
  'bear-figure-start': createBearFigureStart,
}
