import { describe, expect, it } from 'vitest'
import { Mat3, Vec2 } from '@engine/math'
import { createNullBackend } from '@engine/renderer'
import type { Tileset } from '@engine/core'
import type { Engine } from '@engine/core'
import { createIso } from '@engine/projection'
import type { Projection } from '@engine/projection'
import { createTileLayer, setCell } from '../src/layer'
import { createLayerRenderer } from '../src/render'
import type { LayerRenderer } from '../src/render'
import { createOffscreenRasterFactory } from '../src/raster'
import type { RasterFactory, RasterTarget } from '../src/raster'
import { tilemapPlugin } from '../src/plugin'

const view = { width: 800, height: 450, dpr: 1 }

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value here')
  return value
}

// ---- Hand-rolled stand-ins for the three projections (the locked seam ----
// shapes from @engine/projection), so these tests pin down tilemap geometry
// independently of that package's implementation.

const topdownProjection: Projection = {
  name: 'topdown',
  params: { scale: 1 },
  ground: Mat3.make(1, 0, 0, -1, 0, 0),
  elevation: Vec2.make(0, 0),
  project: (p) => Vec2.make(p.x, -p.y),
  inverse: () => null,
  depth: () => 0,
}

// 2:1 dimetric with tileWidth 2, tileHeight 1, zScale 1, in the SOUTH-EAST
// camera convention (docs/DECISIONS.md D7):
//
//     project(x, y, z) = ((x + y)·w/2, (x − y)·h/2 − z·k)
//                      = (x + y, (x − y)/2 − z)         at w = 2, h = 1, k = 1
//
// east → (1, 0.5) (down-right, toward the camera); north → (1, −0.5)
// (up-right, away). Within-band depth is x − y + z.
const isoProjection: Projection = {
  name: 'iso',
  params: { tileWidth: 2, tileHeight: 1, zScale: 1 },
  ground: Mat3.make(1, 0.5, 1, -0.5, 0, 0),
  elevation: Vec2.make(0, -1),
  project: (p) => Vec2.make(p.x + p.y, (p.x - p.y) / 2 - p.z),
  inverse: () => null,
  depth: () => 0,
}

const profileProjection: Projection = {
  name: 'profile',
  params: { scale: 1 },
  ground: Mat3.make(1, 0, 0, 0, 0, 0),
  elevation: Vec2.make(0, -1),
  project: (p) => Vec2.make(p.x, -p.z),
  inverse: () => null,
  depth: () => 0,
}

const tileset: Tileset = {
  id: 'ts1',
  name: 'test tiles',
  tiles: [
    { name: 'grass', colors: { top: '#40c040' } },
    {
      name: 'stone',
      colors: { top: '#808890', left: '#606870', right: '#404850', side: '#585858' },
    },
  ],
}

// A stand-in "image" for the blit path: the renderer only checks source for
// null and passes it through; the null backend never records it.
const fakeSource = { fake: 'pixels' } as unknown as CanvasImageSource

interface RecordedRaster {
  width: number
  height: number
  ops: Array<Record<string, unknown>>
}

/** A RasterFactory that records every paint call instead of painting. */
function recordingRasterFactory(source: CanvasImageSource | null): {
  factory: RasterFactory
  rasters: RecordedRaster[]
} {
  const rasters: RecordedRaster[] = []
  const factory: RasterFactory = (width, height) => {
    const recorded: RecordedRaster = { width, height, ops: [] }
    rasters.push(recorded)
    const target: RasterTarget = {
      width,
      height,
      source,
      clear(x, y, w, h) {
        recorded.ops.push({ op: 'clear', x, y, w, h })
      },
      fillRect(color, x, y, w, h) {
        recorded.ops.push({ op: 'fillRect', color, x, y, w, h })
      },
      fillPoly(color, points) {
        recorded.ops.push({ op: 'fillPoly', color, points: points.map((p) => ({ x: p.x, y: p.y })) })
      },
    }
    return target
  }
  return { factory, rasters }
}

/** Runs one draw inside a proper frame and returns just the draw commands. */
function drawOnce(renderer: LayerRenderer, camera: Mat3): Array<Record<string, unknown>> {
  const backend = createNullBackend()
  backend.beginFrame(view)
  renderer.draw(backend, camera)
  backend.endFrame()
  const frame = must(backend.frames[0])
  return frame.filter((c) => c.kind !== 'begin' && c.kind !== 'end')
}

describe('cached blit path (top-down)', () => {
  it('paints the layer into the cache once, then emits exactly ONE camera-mapped image command per draw', () => {
    const layer = createTileLayer({ id: 'l1', width: 4, height: 4, tilesetId: 'ts1' })
    setCell(layer, 0, 0, 1)
    setCell(layer, 3, 3, 2)
    const { factory, rasters } = recordingRasterFactory(fakeSource)
    const renderer = createLayerRenderer({ layer, tileset, projection: topdownProjection, raster: factory })

    // View bounds: world [0,4]×[0,4] → view x∈[0,4], y∈[−4,0]; at 16 px per
    // view unit the cache is 64×64.
    const raster = must(rasters[0])
    expect([raster.width, raster.height]).toEqual([64, 64])

    const camera = Mat3.make(2, 0, 0, 2, 10, 20)
    const cmds = drawOnce(renderer, camera)

    // dest rect: dx = 2·0+10, dy = 2·(−4)+20, dw = 2·4, dh = 2·4.
    expect(cmds).toEqual([
      { kind: 'image', label: 'tilemap:l1', dx: 10, dy: 12, dw: 8, dh: 8 },
    ])

    // Full first paint: one whole-raster clear, then one rect per occupied
    // cell in reading order. Cell (0,0) spans view y∈[−1,0] → raster row 48.
    expect(raster.ops).toEqual([
      { op: 'clear', x: 0, y: 0, w: 64, h: 64 },
      { op: 'fillRect', color: '#40c040', x: 0, y: 48, w: 16, h: 16 },
      { op: 'fillRect', color: '#808890', x: 48, y: 0, w: 16, h: 16 },
    ])

    // A second draw with an unchanged layer repaints NOTHING — that is the
    // entire point of the cache — but still blits.
    const opCount = raster.ops.length
    const again = drawOnce(renderer, camera)
    expect(raster.ops.length).toBe(opCount)
    expect(again).toEqual(cmds)
  })

  it('patches EXACTLY the painted cell rects on setCell — clear + fill, in cell-index order', () => {
    const layer = createTileLayer({ id: 'l1', width: 4, height: 4, tilesetId: 'ts1' })
    setCell(layer, 0, 0, 1)
    setCell(layer, 3, 3, 2)
    const { factory, rasters } = recordingRasterFactory(fakeSource)
    const renderer = createLayerRenderer({ layer, tileset, projection: topdownProjection, raster: factory })
    const raster = must(rasters[0])
    drawOnce(renderer, Mat3.identity)

    // One painted cell → exactly its 16×16 raster rect, cleared then filled.
    let from = raster.ops.length
    setCell(layer, 1, 2, 2)
    drawOnce(renderer, Mat3.identity)
    expect(raster.ops.slice(from)).toEqual([
      { op: 'clear', x: 16, y: 16, w: 16, h: 16 },
      { op: 'fillRect', color: '#808890', x: 16, y: 16, w: 16, h: 16 },
    ])

    // Two cells painted in "brush order" (3,3) then (0,0) — the patch runs
    // in ascending cell-index order regardless: (0,0) is index 0.
    from = raster.ops.length
    setCell(layer, 3, 3, 1)
    setCell(layer, 0, 0, 2)
    drawOnce(renderer, Mat3.identity)
    expect(raster.ops.slice(from)).toEqual([
      { op: 'clear', x: 0, y: 48, w: 16, h: 16 },
      { op: 'fillRect', color: '#808890', x: 0, y: 48, w: 16, h: 16 },
      { op: 'clear', x: 48, y: 0, w: 16, h: 16 },
      { op: 'fillRect', color: '#40c040', x: 48, y: 0, w: 16, h: 16 },
    ])

    // Erasing a cell clears its rect and fills nothing.
    from = raster.ops.length
    setCell(layer, 1, 2, 0)
    drawOnce(renderer, Mat3.identity)
    expect(raster.ops.slice(from)).toEqual([{ op: 'clear', x: 16, y: 16, w: 16, h: 16 }])
  })

  it('sizes the cache raster for the TRUE world extent when tileSize is not 1', () => {
    // A 4×4 grid at tileSize 2 covers world [0,8]×[0,8] — the same box the
    // cameras, entities, and picking all measure in — so the cache must span
    // 8×8 view units (top-down y-flip: y∈[−8,0]), i.e. 128×128 at 16 px/unit.
    // Before tileSize reached this module, the raster covered only [0,4]²
    // and every non-1-tileSize world drew its tiles at the wrong world size.
    const layer = createTileLayer({ id: 'l1', width: 4, height: 4, tilesetId: 'ts1' })
    setCell(layer, 0, 0, 1)
    const { factory, rasters } = recordingRasterFactory(fakeSource)
    const renderer = createLayerRenderer({
      layer,
      tileset,
      projection: topdownProjection,
      raster: factory,
      tileSize: 2,
    })

    const raster = must(rasters[0])
    expect([raster.width, raster.height]).toEqual([128, 128])
    drawOnce(renderer, Mat3.identity)
    // Cell (0,0) owns world [0,2]×[0,2] → view y∈[−2,0] → raster rows 96..128
    // (row 0 of the grid is the map's SOUTHERN edge: bottom of the window).
    expect(raster.ops).toEqual([
      { op: 'clear', x: 0, y: 0, w: 128, h: 128 },
      { op: 'fillRect', color: '#40c040', x: 0, y: 96, w: 32, h: 32 },
    ])
  })

  it('falls back to per-tile commands under rotated or mirrored cameras (v1 blit is axis-aligned only)', () => {
    const layer = createTileLayer({ id: 'l1', width: 4, height: 4, tilesetId: 'ts1' })
    setCell(layer, 0, 0, 1)
    setCell(layer, 3, 3, 2)
    const { factory, rasters } = recordingRasterFactory(fakeSource)
    const renderer = createLayerRenderer({ layer, tileset, projection: topdownProjection, raster: factory })

    const rotated = Mat3.make(0.8, 0.6, -0.6, 0.8, 0, 0)
    const cmds = drawOnce(renderer, rotated)
    expect(cmds).toHaveLength(2)
    expect(cmds.every((c) => c.kind === 'polyline')).toBe(true)

    const mirrored = Mat3.make(-1, 0, 0, 1, 0, 0)
    expect(drawOnce(renderer, mirrored).every((c) => c.kind === 'polyline')).toBe(true)

    // The cache was never consulted, so it was never painted either.
    expect(must(rasters[0]).ops).toEqual([])
  })
})

describe('per-tile fallback (headless: raster.source === null)', () => {
  it('emits a deterministic command log — identical across draws and across renderer instances', () => {
    const build = (): LayerRenderer => {
      const layer = createTileLayer({ id: 'l1', width: 3, height: 2, elevation: 1, tilesetId: 'ts1' })
      setCell(layer, 0, 0, 1)
      setCell(layer, 1, 0, 2)
      setCell(layer, 2, 1, 2)
      const { factory } = recordingRasterFactory(null)
      return createLayerRenderer({ layer, tileset, projection: isoProjection, raster: factory })
    }
    const camera = Mat3.make(3, 0, 0, 3, 40, 60)

    const rendererA = build()
    const runA1 = drawOnce(rendererA, camera)
    const runA2 = drawOnce(rendererA, camera)
    const runB = drawOnce(build(), camera)

    expect(runA1.length).toBeGreaterThan(0)
    expect(runA1.every((c) => c.kind === 'polyline')).toBe(true)
    // Byte-identical logs — the fingerprint comparison replay hashing makes.
    expect(JSON.stringify(runA2)).toBe(JSON.stringify(runA1))
    expect(JSON.stringify(runB)).toBe(JSON.stringify(runA1))
  })

  it('iso: a unit cell projects to the 2:1 diamond (corner spot-check, stand-in AND landed factory)', () => {
    const layer = createTileLayer({ id: 'l1', width: 1, height: 1, tilesetId: 'ts1', cells: [1] })
    const { factory } = recordingRasterFactory(null)
    const renderer = createLayerRenderer({ layer, tileset, projection: isoProjection, raster: factory })

    // Each corner by hand through project(x, y, z) = (x + y, (x − y)/2 − z):
    const expected = [
      {
        kind: 'polyline',
        points: [
          { x: 0, y: 0 }, // west corner: world (0,0) → (0+0, (0−0)/2) = (0, 0)
          { x: 1, y: 0.5 }, // south: world (1,0) → (1+0, (1−0)/2) = (1, 0.5)
          { x: 2, y: 0 }, // east: world (1,1) → (1+1, (1−1)/2) = (2, 0)
          { x: 1, y: -0.5 }, // north: world (0,1) → (0+1, (0−1)/2) = (1, −0.5)
        ],
        fill: '#40c040',
      },
    ]
    expect(drawOnce(renderer, Mat3.identity)).toEqual(expected)

    // The same cell through the REAL factory (same default params): the
    // stand-in above must mirror @engine/projection's landed convention, not
    // re-invent a private one — this is the cross-check that keeps this
    // file's hand arithmetic honest against docs/DECISIONS.md D7.
    const realRenderer = createLayerRenderer({
      layer,
      tileset,
      projection: createIso(),
      raster: recordingRasterFactory(null).factory,
    })
    expect(drawOnce(realRenderer, Mat3.identity)).toEqual(expected)
  })

  it('iso: a raised layer grows SOUTH and EAST walls (the faces the south-east camera sees), south darker', () => {
    const layer = createTileLayer({ id: 'l1', width: 1, height: 1, elevation: 1, tilesetId: 'ts1', cells: [1] })
    const { factory } = recordingRasterFactory(null)
    const renderer = createLayerRenderer({ layer, tileset, projection: isoProjection, raster: factory })

    const cmds = drawOnce(renderer, Mat3.identity)
    expect(cmds).toHaveLength(3) // south wall, east wall, top face — top last

    const south = must(cmds[0])
    const east = must(cmds[1])
    const top = must(cmds[2])
    expect(top.fill).toBe('#40c040')
    // Grass defines no wall colors, so the walls get derived shades. Lit
    // from the north-west, the south face is the one turned fully away from
    // the light: 0.55 · (0x40, 0xc0, 0x40) = (35, 105, 35) = #236923. The
    // east face catches a graze: 0.75 · (64, 192, 64) = (48, 144, 48) =
    // #309030. Both darker than the top, south darkest.
    expect(south.fill).toBe('#236923')
    expect(east.fill).toBe('#309030')
    // The south wall hangs from the cell's y-min edge at the top face
    // (z = 1) down to the ground (z = 0), each corner by hand:
    expect(south.points).toEqual([
      { x: 0, y: -1 }, // world (0,0) at z=1 → (0, 0/2 − 1)
      { x: 1, y: -0.5 }, // world (1,0) at z=1 → (1, 1/2 − 1)
      { x: 1, y: 0.5 }, // world (1,0) at z=0 → (1, 1/2)
      { x: 0, y: 0 }, // world (0,0) at z=0 → (0, 0)
    ])
    // The east wall hangs from the x-max edge the same way:
    expect(east.points).toEqual([
      { x: 1, y: -0.5 }, // world (1,0) at z=1 → (1, 1/2 − 1)
      { x: 2, y: -1 }, // world (1,1) at z=1 → (2, 0/2 − 1)
      { x: 2, y: 0 }, // world (1,1) at z=0 → (2, 0)
      { x: 1, y: 0.5 }, // world (1,0) at z=0 → (1, 1/2)
    ])
  })

  it('iso: a wall face pressed against an occupied same-layer neighbor is buried, not drawn', () => {
    // Two raised cells side by side along x: (0,0)'s EAST face touches
    // (1,0), so it must not be drawn; every other wall is exposed.
    const layer = createTileLayer({ id: 'l1', width: 2, height: 1, elevation: 1, tilesetId: 'ts1', cells: [1, 1] })
    const { factory } = recordingRasterFactory(null)
    const renderer = createLayerRenderer({ layer, tileset, projection: isoProjection, raster: factory })

    const cmds = drawOnce(renderer, Mat3.identity)
    // Cell (0,0): south wall + top (east buried). Cell (1,0): south + east +
    // top. Painted in ascending x − y: (0,0) then (1,0).
    expect(cmds).toHaveLength(5)
    expect(cmds.map((c) => c.fill)).toEqual(['#236923', '#40c040', '#236923', '#309030', '#40c040'])
  })

  it('iso: tileSize scales ground coordinates but NEVER elevation (z is already world units)', () => {
    // One raised cell at tileSize 2: the cell owns the world square
    // [0,2]×[0,2], but its wall still drops exactly z = 1 world unit — the
    // grid pitch stretches the diamond, not the storey height.
    const layer = createTileLayer({ id: 'l1', width: 1, height: 1, elevation: 1, tilesetId: 'ts1', cells: [1] })
    const { factory } = recordingRasterFactory(null)
    const renderer = createLayerRenderer({
      layer,
      tileset,
      projection: isoProjection,
      raster: factory,
      tileSize: 2,
    })

    const cmds = drawOnce(renderer, Mat3.identity)
    expect(cmds).toHaveLength(3)
    // South wall through project(x, y, z) = (x + y, (x − y)/2 − z), ground
    // corners at world (0,0) and (2,0):
    expect(must(cmds[0]).points).toEqual([
      { x: 0, y: -1 }, // world (0,0) at z=1 → (0, 0 − 1)
      { x: 2, y: 0 }, // world (2,0) at z=1 → (2, 1 − 1)
      { x: 2, y: 1 }, // world (2,0) at z=0 → (2, 1)
      { x: 0, y: 0 }, // world (0,0) at z=0 → (0, 0)
    ])
    // Top face: the diamond is twice the unit size, still one z-unit up.
    expect(must(cmds[2]).points).toEqual([
      { x: 0, y: -1 }, // world (0,0,1)
      { x: 2, y: 0 }, // world (2,0,1)
      { x: 4, y: -1 }, // world (2,2,1) → (4, 0 − 1)
      { x: 2, y: -2 }, // world (0,2,1) → (2, −1 − 1)
    ])
  })

  it('profile: one slab per occupied column, colored by the southernmost cell', () => {
    const layer = createTileLayer({ id: 'l1', width: 2, height: 2, tilesetId: 'ts1' })
    setCell(layer, 0, 0, 2) // stone in the south of column 0
    setCell(layer, 0, 1, 1) // grass hiding behind it
    setCell(layer, 1, 1, 1) // column 1: only grass, in the north
    const { factory } = recordingRasterFactory(null)
    const renderer = createLayerRenderer({ layer, tileset, projection: profileProjection, raster: factory })

    expect(drawOnce(renderer, Mat3.identity)).toEqual([
      {
        kind: 'polyline',
        // Column 0: stone wins (smallest ty is nearest the camera) and it
        // HAS a side color. Slab spans z ∈ [0, 0.15], drawn edge-on.
        points: [
          { x: 0, y: -0.15 },
          { x: 1, y: -0.15 },
          { x: 1, y: 0 },
          { x: 0, y: 0 },
        ],
        fill: '#585858',
      },
      {
        kind: 'polyline',
        // Column 1: grass has no side color, so its top color stands in.
        points: [
          { x: 1, y: -0.15 },
          { x: 2, y: -0.15 },
          { x: 2, y: 0 },
          { x: 1, y: 0 },
        ],
        fill: '#40c040',
      },
    ])
  })
})

describe('iso cache invalidation is conservative (v1)', () => {
  it('any edit repaints the whole layer — walls overlap neighbors, so no surgical patch yet', () => {
    const layer = createTileLayer({ id: 'l1', width: 2, height: 1, elevation: 1, tilesetId: 'ts1' })
    setCell(layer, 0, 0, 1)
    const { factory, rasters } = recordingRasterFactory(fakeSource)
    const renderer = createLayerRenderer({ layer, tileset, projection: isoProjection, raster: factory })
    const raster = must(rasters[0])

    // Bounds from the 2×1 layer's corners at z ∈ {0, 1} through
    // (x + y, (x − y)/2 − z): x∈[0,3], y∈[−1.5,1] → 3×2.5 view units →
    // 48×40 raster at 16 px/unit.
    expect([raster.width, raster.height]).toEqual([48, 40])

    const first = drawOnce(renderer, Mat3.identity)
    expect(first).toHaveLength(1)
    expect(must(first[0]).kind).toBe('image')
    // Full paint: whole-raster clear + 3 faces for the one occupied cell —
    // its east neighbor (1,0) is still empty, so south, east, and top all draw.
    expect(raster.ops).toHaveLength(4)
    expect(raster.ops[0]).toEqual({ op: 'clear', x: 0, y: 0, w: 48, h: 40 })

    const from = raster.ops.length
    setCell(layer, 1, 0, 2)
    drawOnce(renderer, Mat3.identity)
    const appended = raster.ops.slice(from)
    // Conservative: full clear again, then both cells' faces — (0,0) now
    // buries its east wall against the occupied (1,0), so it paints south +
    // top (2), while (1,0) paints south + east + top (3): 1 + 2 + 3 = 6.
    expect(appended).toHaveLength(6)
    expect(appended[0]).toEqual({ op: 'clear', x: 0, y: 0, w: 48, h: 40 })
  })
})

describe('cache resolution cap', () => {
  it('clamps the cache raster to 4096 px per side, trading resolution instead of allocating past it', () => {
    const layer = createTileLayer({ id: 'big', width: 256, height: 256, tilesetId: 'ts1' })

    // 256 view units at 32 px/unit would be 8192 px — halved back to 4096.
    const capped = recordingRasterFactory(fakeSource)
    createLayerRenderer({
      layer,
      tileset,
      projection: topdownProjection,
      raster: capped.factory,
      cachePixelsPerUnit: 32,
    })
    expect([must(capped.rasters[0]).width, must(capped.rasters[0]).height]).toEqual([4096, 4096])

    // The default 16 px/unit lands exactly ON the cap for a 256×256 layer.
    const exact = recordingRasterFactory(fakeSource)
    createLayerRenderer({ layer, tileset, projection: topdownProjection, raster: exact.factory })
    expect([must(exact.rasters[0]).width, must(exact.rasters[0]).height]).toEqual([4096, 4096])
  })
})

describe('createOffscreenRasterFactory', () => {
  it('imports cleanly in node and fails at CALL time with advice, not at import time', () => {
    const factory = createOffscreenRasterFactory()
    expect(() => factory(8, 8)).toThrow(/OffscreenCanvas|browser/)
  })
})

describe('tilemapPlugin', () => {
  it('exposes the {name, version, register} handshake and registers its component schema', () => {
    const plugin = tilemapPlugin()
    expect(plugin.name).toBe('tilemap')
    expect(plugin.version).toBe('0.1.0')

    const registered: Array<{
      name: string
      defaults: () => unknown
      validate?: (value: unknown) => string | null
    }> = []
    const fakeEngine = {
      registry: {
        register(def: (typeof registered)[number]) {
          registered.push(def)
        },
      },
    } as unknown as Engine

    plugin.register(fakeEngine)
    expect(registered.map((d) => d.name)).toEqual(['tilePosition'])

    const def = must(registered[0])
    expect(def.defaults()).toEqual({ tx: 0, ty: 0 })
    expect(def.validate?.({ tx: 3, ty: 4 })).toBeNull()
    // Bad values get a student-legible sentence, not a stack trace.
    expect(def.validate?.({ tx: 3.5, ty: 4 })).toMatch(/whole numbers/)
    expect(def.validate?.('nope')).toMatch(/tilePosition/)
  })
})
