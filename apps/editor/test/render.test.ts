/**
 * Scene-renderer smoke proofs, headless.
 *
 * The null backend records "what would be drawn" as plain data, and a
 * pixel-less raster factory (source: null — the same pattern the
 * three-windows tests use, reconstructed here rather than imported across
 * apps) flips every layer onto the per-tile command path, so tile geometry
 * is visible to assertions. The raster factory also COUNTS its calls: a
 * layer renderer asks for exactly one raster at creation, which makes
 * renderer-cache hits and misses directly observable from outside — the
 * cheapest honest probe of the structural-sharing contract.
 */

import type { World } from '@engine/core'
import { createWorld, spawn } from '@engine/core'
import { Vec2 } from '@engine/math'
import { createIso, createTopDown, createTransformStack, fitCamera } from '@engine/projection'
import { createNullBackend } from '@engine/renderer'
import type { RasterFactory } from '@engine/tilemap'
import { describe, expect, it } from 'vitest'
import { PIP_FIGURINE } from '../src/editor/figurine'
import { createSceneRenderer } from '../src/editor/render'
import type { RenderUi } from '../src/editor/render'
import { createStarterWorld } from '../src/editor/starter'

const SIZE = { width: 640, height: 420, dpr: 1 } as const

const BASE_UI: RenderUi = {
  selection: null,
  hoverTile: null,
  cursorTile: null,
  entityOverride: null,
  activeLayerId: 'ground',
  grid: false,
  overlays: [],
}

/** A raster factory with no pixel store, counting how many rasters were
 * ever requested (one per layer-renderer creation). */
function countingRaster(): { raster: RasterFactory; calls: () => number } {
  let count = 0
  const raster: RasterFactory = (width, height) => {
    count += 1
    return {
      width,
      height,
      source: null,
      clear(): void {},
      fillRect(): void {},
      fillPoly(): void {},
    }
  }
  return { raster, calls: () => count }
}

/** One assembled scene over the starter world, camera fitted like the app. */
function setup() {
  const doc = createStarterWorld()
  const stack = createTransformStack(createTopDown())
  stack.setCamera(
    fitCamera({
      viewWidth: SIZE.width,
      viewHeight: SIZE.height,
      worldMin: Vec2.zero,
      worldMax: Vec2.make(32, 24),
      zRange: [0, 2],
      projection: stack.projection,
    }),
  )
  const { raster, calls } = countingRaster()
  const renderer = createSceneRenderer({ raster })
  return { doc, stack, renderer, calls }
}

/** All commands of the first recorded frame. */
function frame(backendFrames: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>): ReadonlyArray<Record<string, unknown>> {
  const first = backendFrames[0]
  expect(first).toBeDefined()
  return first ?? []
}

describe('createSceneRenderer', () => {
  it('renders the starter world: an honored beginFrame, commands, one closed frame', () => {
    const { doc, stack, renderer } = setup()
    const backend = createNullBackend()
    renderer.render(backend, doc, stack, SIZE, BASE_UI)

    const commands = frame(backend.frames)
    expect(commands[0]).toEqual({
      kind: 'begin',
      width: SIZE.width,
      height: SIZE.height,
      dpr: SIZE.dpr,
      background: '#0d131e',
    })
    expect(commands[commands.length - 1]).toEqual({ kind: 'end' })
    // Terrain (per-tile polylines), the player marker, labels — a real scene.
    expect(commands.length).toBeGreaterThan(10)
    expect(commands.some((cmd) => cmd.kind === 'polyline')).toBe(true)
    expect(commands.some((cmd) => cmd.kind === 'circle')).toBe(true)
  })

  it('entityOverride moves the drawn marker to the override point', () => {
    const { doc, stack, renderer } = setup()

    const plain = createNullBackend()
    renderer.render(plain, doc, stack, SIZE, BASE_UI)
    const committedCircle = frame(plain.frames).find((cmd) => cmd.kind === 'circle')
    expect(committedCircle).toBeDefined()

    const overridePoint = { x: 3, y: 2, z: 0 }
    const dragged = createNullBackend()
    renderer.render(dragged, doc, stack, SIZE, {
      ...BASE_UI,
      entityOverride: { id: 'e1', point: overridePoint },
    })
    const ghostCircle = frame(dragged.frames).find((cmd) => cmd.kind === 'circle')
    expect(ghostCircle).toBeDefined()

    const expected = stack.worldToScreen(overridePoint)
    expect(ghostCircle?.x).toBeCloseTo(expected.x, 9)
    expect(ghostCircle?.y).toBeCloseTo(expected.y, 9)
    expect(ghostCircle?.x).not.toBeCloseTo(committedCircle?.x as number, 9)
  })

  it('the entity override reaches the lens pass: lesson ink follows the drag ghost', () => {
    // Lesson-02's flagship moment, at the render.ts seam: while the starter
    // player (entity e1, committed at (16.5, 12.5)) is mid-drag, the
    // right-triangle overlay's marker endpoint must draw at the OVERRIDE
    // point — the same substitution the marker dot gets — so the numbers
    // move while the student drags, not on drop.
    const { doc, stack, renderer } = setup()
    const overlays: RenderUi['overlays'] = [
      { kind: 'right-triangle', a: { marker: 'player' }, b: { x: 19.5, y: 16.5 } },
    ]

    const plain = createNullBackend()
    renderer.render(plain, doc, stack, SIZE, { ...BASE_UI, overlays })
    // The hypotenuse is the frame's only gold 3-wide stroke (@engine/lens's
    // own weight); its first point is the marker-resolved `a`.
    const committed = frame(plain.frames).find(
      (cmd) => cmd.kind === 'polyline' && cmd.stroke === '#ffd166' && cmd.lineWidth === 3,
    )
    expect(committed).toBeDefined()

    const overridePoint = { x: 10, y: 5, z: 0 }
    const dragged = createNullBackend()
    renderer.render(dragged, doc, stack, SIZE, {
      ...BASE_UI,
      overlays,
      entityOverride: { id: 'e1', point: overridePoint },
    })
    const ghost = frame(dragged.frames).find(
      (cmd) => cmd.kind === 'polyline' && cmd.stroke === '#ffd166' && cmd.lineWidth === 3,
    )
    expect(ghost).toBeDefined()

    const expected = stack.worldToScreen(overridePoint)
    const ghostPoints = ghost?.points as ReadonlyArray<{ x: number; y: number }>
    const committedPoints = committed?.points as ReadonlyArray<{ x: number; y: number }>
    expect(ghostPoints[0]?.x).toBeCloseTo(expected.x, 9)
    expect(ghostPoints[0]?.y).toBeCloseTo(expected.y, 9)
    // And it MOVED: the committed frame's hypotenuse started elsewhere.
    expect(ghostPoints[0]?.x).not.toBeCloseTo(committedPoints[0]?.x as number, 9)
  })

  it('grid: true adds one polyline per grid line over the active layer', () => {
    const { doc, stack, renderer } = setup()
    const backend = createNullBackend()
    renderer.render(backend, doc, stack, SIZE, { ...BASE_UI, grid: true })
    const gridLines = frame(backend.frames).filter(
      (cmd) => cmd.kind === 'polyline' && cmd.stroke === '#2a3242',
    )
    // (width + 1) verticals + (height + 1) horizontals for the 32×24 layer.
    expect(gridLines).toHaveLength(33 + 25)

    const without = createNullBackend()
    renderer.render(without, doc, stack, SIZE, BASE_UI)
    expect(frame(without.frames).some((cmd) => cmd.stroke === '#2a3242')).toBe(false)
  })

  it('the axis compass labels E and N in every frame', () => {
    const { doc, stack, renderer } = setup()
    const backend = createNullBackend()
    renderer.render(backend, doc, stack, SIZE, BASE_UI)
    const texts = frame(backend.frames)
      .filter((cmd) => cmd.kind === 'text')
      .map((cmd) => cmd.text)
    expect(texts).toContain('E')
    expect(texts).toContain('N')
  })

  it('cursorTile draws its bright cell outline', () => {
    const { doc, stack, renderer } = setup()
    const backend = createNullBackend()
    renderer.render(backend, doc, stack, SIZE, { ...BASE_UI, cursorTile: { tx: 2, ty: 3 } })
    const cursor = frame(backend.frames).find(
      (cmd) => cmd.kind === 'polyline' && cmd.stroke === '#ffd166',
    )
    expect(cursor).toBeDefined()
    expect(cursor?.lineWidth).toBe(2)
    expect(cursor?.closed).toBe(true)
    // The outline's first corner is the cell's own (tx, ty) corner on screen.
    const corner = stack.worldToScreen({ x: 2, y: 3, z: 0 })
    const points = cursor?.points as ReadonlyArray<{ x: number; y: number }>
    expect(points[0]?.x).toBeCloseTo(corner.x, 9)
    expect(points[0]?.y).toBeCloseTo(corner.y, 9)
  })

  it('lens overlays draw between the grid and the selection outline', () => {
    // The pinned sandwich: world, grid, LESSON INK, then the pick overlays —
    // the lesson's picture must never hide the very cell the student is
    // about to click (render.ts documents the order; this pins it).
    const { doc, stack, renderer } = setup()
    const backend = createNullBackend()
    renderer.render(backend, doc, stack, SIZE, {
      ...BASE_UI,
      grid: true,
      selection: { kind: 'tile', tile: { layerId: 'ground', tx: 4, ty: 5, elevation: 0 } },
      overlays: [{ kind: 'cell-highlight', tx: 2, ty: 3 }],
    })
    const commands = frame(backend.frames)

    // The lens cell highlight is the only 2.5-wide stroke in the frame
    // (grid 1, markers 1.5, selection 2 — @engine/lens's own weight).
    const overlayAt = commands.findIndex((cmd) => cmd.kind === 'polyline' && cmd.lineWidth === 2.5)
    const lastGridAt = commands.reduce(
      (last, cmd, at) => (cmd.kind === 'polyline' && cmd.stroke === '#2a3242' ? at : last),
      -1,
    )
    const selectionAt = commands.findIndex(
      (cmd) => cmd.kind === 'polyline' && cmd.stroke === '#8ab4ff' && cmd.lineWidth === 2,
    )
    expect(overlayAt).toBeGreaterThan(-1)
    expect(lastGridAt).toBeGreaterThan(-1)
    expect(selectionAt).toBeGreaterThan(-1)
    expect(overlayAt).toBeGreaterThan(lastGridAt) // above the grid…
    expect(overlayAt).toBeLessThan(selectionAt) // …below the selection

    // And the highlight really is the lesson's cell: the outline's first
    // corner projects from (tx, ty) on the ground plane.
    const overlay = commands[overlayAt]
    const corner = stack.worldToScreen({ x: 2, y: 3, z: 0 })
    const points = overlay?.points as ReadonlyArray<{ x: number; y: number }>
    expect(points[0]?.x).toBeCloseTo(corner.x, 9)
    expect(points[0]?.y).toBeCloseTo(corner.y, 9)
  })

  it('the layer-renderer cache survives an entity-only doc swap; reset() clears it', () => {
    const { doc, stack, renderer, calls } = setup()
    renderer.render(createNullBackend(), doc, stack, SIZE, BASE_UI)
    expect(calls()).toBe(1) // one layer, one raster request

    // An entity edit the way Immer produces it: new document object, new
    // entities branch, LAYERS ARRAY SHARED BY REFERENCE (structural sharing).
    const player = doc.entities['e1']
    if (player === undefined) throw new Error('starter world lost its player')
    const swapped: World = {
      ...doc,
      entities: { ...doc.entities, e1: { ...player, name: 'renamed' } },
    }
    renderer.render(createNullBackend(), swapped, stack, SIZE, BASE_UI)
    expect(calls()).toBe(1) // same layer object → cache hit, no new renderer

    renderer.reset() // loadWorld's move: layer objects are about to be strangers
    renderer.render(createNullBackend(), swapped, stack, SIZE, BASE_UI)
    expect(calls()).toBe(2)
  })

  describe('figurine markers', () => {
    /** A bare world holding exactly one pip entity — no tile layers, so
     * every polyline in the frame belongs to the figurine (compass arrows
     * and the marker label are the only other commands, and neither is a
     * fill-only polyline). */
    function worldWithPip(): World {
      const doc = createWorld({ settings: { tileSize: 1 } })
      spawn(doc, {
        name: 'pip',
        components: {
          position: { x: 1.5, y: 1.5 },
          elevation: { z: 0 },
          marker: { kind: 'pip' },
          figurine: PIP_FIGURINE,
        },
      })
      return doc
    }

    it('an entity carrying a valid figurine draws as a voxel miniature — no dot, label kept', () => {
      const doc = worldWithPip()
      const stack = createTransformStack(createIso())
      stack.setCamera(
        fitCamera({
          viewWidth: SIZE.width,
          viewHeight: SIZE.height,
          worldMin: Vec2.zero,
          worldMax: Vec2.make(2, 2),
          zRange: [0, 1],
          projection: stack.projection,
        }),
      )
      const { raster } = countingRaster()
      const renderer = createSceneRenderer({ raster })
      const backend = createNullBackend()
      renderer.render(backend, doc, stack, SIZE, { ...BASE_UI, activeLayerId: null })

      const commands = frame(backend.frames)
      // No dot: a figurine entity never falls through to drawCircle.
      expect(commands.some((cmd) => cmd.kind === 'circle')).toBe(false)
      // The label still draws, exactly as an ordinary marker's would.
      expect(commands.some((cmd) => cmd.kind === 'text' && cmd.text === 'pip')).toBe(true)

      // Every filled, unstroked polyline is one voxel face — the SAME
      // "filled quad, no stroke" command @engine/tilemap's per-tile path
      // uses (render.ts's drawFigurine reuses it deliberately). Pip's
      // eighteen slices (~2,400 blocks), with hidden-face culling, come to
      // exactly this many visible faces — well under the size-capped worst
      // case, which is the cap's whole point.
      const quads = commands.filter(
        (cmd) => cmd.kind === 'polyline' && cmd.fill !== undefined && cmd.stroke === undefined,
      )
      expect(quads).toHaveLength(932)
      // Spot-check one real color: bear brown, PIP_FIGURINE's first palette
      // entry's top face — proof the palette (not a placeholder) painted it.
      expect(quads.some((cmd) => cmd.fill === PIP_FIGURINE.palette[0]?.top)).toBe(true)
    })

    it('a malformed figurine component falls back to the ordinary dot, believing nothing', () => {
      const doc = createWorld({ settings: { tileSize: 1 } })
      spawn(doc, {
        name: 'broken pip',
        components: {
          position: { x: 1.5, y: 1.5 },
          marker: { kind: 'pip' },
          figurine: { size: 'not a number' }, // shape-check must reject this
        },
      })
      const stack = createTransformStack(createTopDown())
      stack.setCamera(
        fitCamera({
          viewWidth: SIZE.width,
          viewHeight: SIZE.height,
          worldMin: Vec2.zero,
          worldMax: Vec2.make(3, 3),
          zRange: [0, 1],
          projection: stack.projection,
        }),
      )
      const { raster } = countingRaster()
      const renderer = createSceneRenderer({ raster })
      const backend = createNullBackend()
      renderer.render(backend, doc, stack, SIZE, { ...BASE_UI, activeLayerId: null })

      const commands = frame(backend.frames)
      const dot = commands.find((cmd) => cmd.kind === 'circle')
      expect(dot).toBeDefined()
      expect(dot?.fill).toBe('#a97a50') // MARKER_COLORS.pip — even the fallback dot IS Pip-colored
    })
  })
})
