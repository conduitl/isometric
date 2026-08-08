import { describe, expect, it } from 'vitest'
import type { Rng } from '@engine/math'
import { createRng, Mat3, Vec2 } from '@engine/math'
import type { Projection, WorldPoint } from '../src/index'
import {
  createIso,
  createProfile,
  createTopDown,
  createTransformStack,
  fitCamera,
} from '../src/index'

const randomCamera = (rng: Rng): Mat3 =>
  Mat3.compose(
    Mat3.translation(rng.range(-200, 200), rng.range(-200, 200)),
    Mat3.compose(
      Mat3.rotation(rng.range(-3, 3)),
      Mat3.scaling(rng.range(0.2, 3), rng.range(0.2, 3)),
    ),
  )

describe('createTransformStack', () => {
  it('defaults to the identity camera: view plane IS the screen', () => {
    const projection = createIso()
    const stack = createTransformStack(projection)
    expect(stack.camera).toBe(Mat3.identity)
    const p: WorldPoint = { x: 3, y: 1, z: 0 }
    expect(stack.worldToScreen(p)).toEqual(projection.project(p))
  })

  it('property: worldToScreen is exactly camera ∘ project', () => {
    const rng = createRng(430)
    const projection = createTopDown({ scale: 2 })
    for (let k = 0; k < 100; k++) {
      const camera = randomCamera(rng)
      const stack = createTransformStack(projection, camera)
      const p = { x: rng.range(-50, 50), y: rng.range(-50, 50), z: rng.range(-10, 10) }
      expect(stack.worldToScreen(p)).toEqual(Mat3.apply(camera, projection.project(p)))
    }
  })

  it('setCamera swaps the camera and stages() reflects it immediately', () => {
    const stack = createTransformStack(createIso())
    const zoomed = Mat3.compose(Mat3.translation(100, 50), Mat3.scaling(2, 2))
    stack.setCamera(zoomed)
    expect(stack.camera).toBe(zoomed)
    const stages = stack.stages()
    expect(stages[1]?.matrix).toBe(zoomed)
  })

  it('stages() names the two hops in pipeline order, as data', () => {
    const camera = Mat3.translation(5, 7)
    const stages = createTransformStack(createProfile(), camera).stages()
    expect(stages).toHaveLength(2)
    expect(stages[0]).toEqual({ name: 'projection', kind: 'projection' })
    expect(stages[0]?.matrix).toBeUndefined() // a projection is not a matrix — it eats a third coordinate
    expect(stages[1]).toEqual({ name: 'camera', kind: 'matrix', matrix: camera })
  })

  it('screenToWorld returns null when the camera collapsed the screen (zero scale)', () => {
    const stack = createTransformStack(createTopDown(), Mat3.scaling(0, 0))
    expect(stack.screenToWorld(Vec2.make(10, 10), { kind: 'ground' })).toBeNull()
  })

  it('screenToWorld passes constraint rejections through as null', () => {
    const stack = createTransformStack(createProfile())
    expect(stack.screenToWorld(Vec2.make(10, 10), { kind: 'elevation', z: 1 })).toBeNull()
  })
})

describe('fitCamera', () => {
  const VIEW_W = 800
  const VIEW_H = 450
  const PADDING = 24
  const worldMin = Vec2.make(-3, -2)
  const worldMax = Vec2.make(5, 7)
  const zRange = [0, 4] as const

  /** The eight fit-relevant world corners: 4 ground corners × 2 z extremes. */
  const cornersOf = (min: Vec2, max: Vec2, zs: readonly [number, number]): WorldPoint[] => {
    const corners: WorldPoint[] = []
    for (const z of zs) {
      corners.push(
        { x: min.x, y: min.y, z },
        { x: max.x, y: min.y, z },
        { x: min.x, y: max.y, z },
        { x: max.x, y: max.y, z },
      )
    }
    return corners
  }

  const screenBounds = (
    projection: Projection,
    camera: Mat3,
    corners: readonly WorldPoint[],
  ): { minX: number; minY: number; maxX: number; maxY: number } => {
    const stack = createTransformStack(projection, camera)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const corner of corners) {
      const s = stack.worldToScreen(corner)
      minX = Math.min(minX, s.x)
      minY = Math.min(minY, s.y)
      maxX = Math.max(maxX, s.x)
      maxY = Math.max(maxY, s.y)
    }
    return { minX, minY, maxX, maxY }
  }

  const allThree: Projection[] = [createProfile(), createTopDown(), createIso()]

  it('puts every projected corner inside the padded view, for all three projections', () => {
    for (const projection of allThree) {
      const camera = fitCamera({
        viewWidth: VIEW_W,
        viewHeight: VIEW_H,
        worldMin,
        worldMax,
        zRange,
        projection,
      })
      const b = screenBounds(projection, camera, cornersOf(worldMin, worldMax, zRange))
      const epsilon = 1e-9
      expect(b.minX).toBeGreaterThanOrEqual(PADDING - epsilon)
      expect(b.minY).toBeGreaterThanOrEqual(PADDING - epsilon)
      expect(b.maxX).toBeLessThanOrEqual(VIEW_W - PADDING + epsilon)
      expect(b.maxY).toBeLessThanOrEqual(VIEW_H - PADDING + epsilon)
    }
  })

  it('fits tightly: the limiting dimension exactly spans the padded view', () => {
    for (const projection of allThree) {
      const camera = fitCamera({
        viewWidth: VIEW_W,
        viewHeight: VIEW_H,
        worldMin,
        worldMax,
        zRange,
        projection,
      })
      const b = screenBounds(projection, camera, cornersOf(worldMin, worldMax, zRange))
      const usedW = (b.maxX - b.minX) / (VIEW_W - 2 * PADDING)
      const usedH = (b.maxY - b.minY) / (VIEW_H - 2 * PADDING)
      expect(Math.max(usedW, usedH)).toBeCloseTo(1, 9)
    }
  })

  it('scales uniformly (2:1 diamonds must stay 2:1) and centers the bounds', () => {
    for (const projection of allThree) {
      const camera = fitCamera({
        viewWidth: VIEW_W,
        viewHeight: VIEW_H,
        worldMin,
        worldMax,
        zRange,
        projection,
      })
      expect(camera.a).toBeGreaterThan(0)
      expect(camera.a).toBe(camera.d) // uniform: same stretch on both axes
      expect(camera.b).toBe(0)
      expect(camera.c).toBe(0)
      const b = screenBounds(projection, camera, cornersOf(worldMin, worldMax, zRange))
      expect((b.minX + b.maxX) / 2).toBeCloseTo(VIEW_W / 2, 9)
      expect((b.minY + b.maxY) / 2).toBeCloseTo(VIEW_H / 2, 9)
    }
  })

  it('honors a custom padding, down to zero', () => {
    const projection = createTopDown()
    const camera = fitCamera({
      viewWidth: 100,
      viewHeight: 100,
      worldMin: Vec2.make(0, 0),
      worldMax: Vec2.make(10, 10),
      projection,
      padding: 0,
    })
    const b = screenBounds(projection, camera, cornersOf(Vec2.make(0, 0), Vec2.make(10, 10), [0, 0]))
    // A square world in a square view with no padding fills it edge to edge.
    expect(b.minX).toBeCloseTo(0, 9)
    expect(b.minY).toBeCloseTo(0, 9)
    expect(b.maxX).toBeCloseTo(100, 9)
    expect(b.maxY).toBeCloseTo(100, 9)
  })

  it('handles the degenerate profile case: a flat world projects to a line, width alone votes', () => {
    // Profile with zRange [0, 0]: every corner lands at view y = 0, so the
    // projected bounds have zero height. Scale must come from width only,
    // with no NaN leaking out of a 0/0.
    const projection = createProfile()
    const camera = fitCamera({
      viewWidth: VIEW_W,
      viewHeight: VIEW_H,
      worldMin,
      worldMax,
      projection,
    })
    expect(Number.isFinite(camera.a)).toBe(true)
    // World x spans 8 units; the padded view is 752 px wide; 752/8 = 94.
    expect(camera.a).toBeCloseTo((VIEW_W - 2 * PADDING) / 8, 9)
    const b = screenBounds(projection, camera, cornersOf(worldMin, worldMax, [0, 0]))
    expect(b.minY).toBeCloseTo(VIEW_H / 2, 9) // the line sits centered
    expect(b.maxY).toBeCloseTo(VIEW_H / 2, 9)
  })

  it('handles a single point: nothing to fit, scale falls back to 1, point centered', () => {
    const projection = createTopDown()
    const point = Vec2.make(7, -3)
    const camera = fitCamera({
      viewWidth: VIEW_W,
      viewHeight: VIEW_H,
      worldMin: point,
      worldMax: point,
      projection,
    })
    expect(camera.a).toBe(1)
    const stack = createTransformStack(projection, camera)
    const s = stack.worldToScreen({ x: point.x, y: point.y, z: 0 })
    expect(s.x).toBeCloseTo(VIEW_W / 2, 9)
    expect(s.y).toBeCloseTo(VIEW_H / 2, 9)
  })

  it('rejects a nonsense view size with a friendly message', () => {
    expect(() =>
      fitCamera({
        viewWidth: 0,
        viewHeight: 450,
        worldMin,
        worldMax,
        projection: createTopDown(),
      }),
    ).toThrow(/positive view size/)
  })
})
