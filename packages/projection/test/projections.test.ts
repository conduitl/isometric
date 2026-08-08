import { describe, expect, it } from 'vitest'
import type { Rng } from '@engine/math'
import { createRng, Mat3, Vec2 } from '@engine/math'
import type { InverseConstraint, Projection, ProjectionName, WorldPoint } from '../src/index'
import {
  createIso,
  createProfile,
  createTopDown,
  createTransformStack,
  DEPTH_BAND_STRIDE,
} from '../src/index'

const CASES = 200

/**
 * A random but guaranteed-invertible camera: zoom in [0.2, 3) on each axis
 * (never zero), a rotation, then a pan. Built by composition so no draw of
 * the rng can produce a collapsed matrix.
 */
const randomCamera = (rng: Rng): Mat3 =>
  Mat3.compose(
    Mat3.translation(rng.range(-200, 200), rng.range(-200, 200)),
    Mat3.compose(
      Mat3.rotation(rng.range(-3, 3)),
      Mat3.scaling(rng.range(0.2, 3), rng.range(0.2, 3)),
    ),
  )

const expectWorldClose = (actual: WorldPoint | null, expected: WorldPoint): void => {
  expect(actual).not.toBeNull()
  if (actual === null) return
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

const expectVecClose = (actual: Vec2, expected: Vec2): void => {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
}

describe('projection formulas (the semantics table, spot-checked)', () => {
  it('profile: project = (s·x, −s·z); y is gone', () => {
    const p = createProfile({ scale: 2 })
    expect(p.project({ x: 3, y: 9, z: 2 })).toEqual({ x: 6, y: -4 })
    // Two points differing only in y land on the SAME view point — rank deficiency in action.
    expect(p.project({ x: 3, y: -100, z: 2 })).toEqual(p.project({ x: 3, y: 100, z: 2 }))
  })

  it('topdown: project = (s·x, −s·y); z is invisible', () => {
    const p = createTopDown()
    expect(p.project({ x: 3, y: 4, z: 9 })).toEqual({ x: 3, y: -4 })
    expect(p.project({ x: 3, y: 4, z: 0 })).toEqual(p.project({ x: 3, y: 4, z: 99 }))
  })

  it('iso: the basis-vector landing spots ARE the projection', () => {
    const p = createIso() // defaults: tileWidth 2, tileHeight 1, zScale 1
    // South-east camera: one step east lands right-and-DOWN (toward the
    // viewer), one step north right-and-UP (away), one step up straight up
    // the screen — the three columns of the lens.
    expect(p.project({ x: 1, y: 0, z: 0 })).toEqual({ x: 1, y: 0.5 })
    expect(p.project({ x: 0, y: 1, z: 0 })).toEqual({ x: 1, y: -0.5 })
    expect(p.project({ x: 0, y: 0, z: 1 })).toEqual({ x: 0, y: -1 })
  })

  it('property: project(p) = ground·(x,y) + elevation·z — the data IS the behavior', () => {
    const rng = createRng(410)
    const projections = [
      createProfile({ scale: 1.5 }),
      createTopDown({ scale: 0.5 }),
      createIso({ tileWidth: 4, tileHeight: 2, zScale: 3 }),
    ]
    for (const projection of projections) {
      for (let k = 0; k < 50; k++) {
        const p = { x: rng.range(-50, 50), y: rng.range(-50, 50), z: rng.range(-10, 10) }
        const fromData = Vec2.add(
          Mat3.applyVector(projection.ground, Vec2.make(p.x, p.y)),
          Vec2.scale(projection.elevation, p.z),
        )
        expectVecClose(projection.project(p), fromData)
      }
    }
  })

  it('the reified data matches the architecture table', () => {
    const profile = createProfile({ scale: 2 })
    expect(profile.ground).toEqual(Mat3.make(2, 0, 0, 0, 0, 0))
    expect(profile.elevation).toEqual({ x: 0, y: -2 })
    // Rank-deficient on purpose: profile's ground matrix has no inverse.
    expect(Mat3.determinant(profile.ground)).toBe(0)

    const topdown = createTopDown({ scale: 3 })
    expect(topdown.ground).toEqual(Mat3.make(3, 0, 0, -3, 0, 0))
    expect(topdown.elevation).toEqual({ x: 0, y: 0 })

    const iso = createIso()
    expect(iso.ground).toEqual(Mat3.make(1, 0.5, 1, -0.5, 0, 0))
    expect(iso.elevation).toEqual({ x: 0, y: -1 })
    // det = −w·h/2 — the closed form students derive. Nonzero, so iso
    // picking always works; NEGATIVE like topdown's −s², so the two views
    // share one winding and a map never reads mirror-reversed between them.
    expect(Mat3.determinant(iso.ground)).toBe(-1)
    expect(Math.sign(Mat3.determinant(iso.ground))).toBe(
      Math.sign(Mat3.determinant(topdown.ground)),
    )
  })

  it('exposes name and params as inspectable, frozen data with documented defaults', () => {
    expect(createProfile().params).toEqual({ scale: 1 })
    expect(createTopDown().params).toEqual({ scale: 1 })
    expect(createIso().params).toEqual({ tileWidth: 2, tileHeight: 1, zScale: 1 })
    expect(createIso().name).toBe('iso')
    expect(createProfile().name).toBe('profile')
    expect(createTopDown().name).toBe('topdown')
    expect(Object.isFrozen(createIso().params)).toBe(true)
    expect(Object.isFrozen(createIso().ground)).toBe(true)
  })

  it('rejects nonsense dimensions with a friendly message', () => {
    expect(() => createProfile({ scale: 0 })).toThrow(/positive/)
    expect(() => createTopDown({ scale: -1 })).toThrow(/positive/)
    expect(() => createIso({ tileWidth: 0 })).toThrow(/positive/)
    expect(() => createIso({ tileHeight: Number.NaN })).toThrow(/positive/)
    // zScale is a dimension like the others: the iso depth/overlap story
    // needs climbing to move points up the screen, so k must be > 0.
    expect(() => createIso({ zScale: Number.POSITIVE_INFINITY })).toThrow(/positive/)
    expect(() => createIso({ zScale: 0 })).toThrow(/positive/)
    expect(() => createIso({ zScale: -0.4 })).toThrow(/positive/)
  })
})

describe('worldToScreen ∘ screenToWorld round-trips under seeded random cameras', () => {
  it('profile: lane and ground constraints, 200 cases', () => {
    const rng = createRng(420)
    const projection = createProfile({ scale: 2 })
    for (let k = 0; k < CASES; k++) {
      const stack = createTransformStack(projection, randomCamera(rng))
      const lane = rng.range(-20, 20)
      const constraint: InverseConstraint =
        k % 2 === 0 ? { kind: 'lane', y: lane } : { kind: 'ground' }
      // A world point CONSISTENT with the constraint (its y is the pinned lane).
      const world = {
        x: rng.range(-50, 50),
        y: constraint.kind === 'lane' ? constraint.y : 0,
        z: rng.range(-10, 10),
      }
      expectWorldClose(stack.screenToWorld(stack.worldToScreen(world), constraint), world)

      // And the mirror direction: any screen point, pulled back then re-projected.
      const screen = Vec2.make(rng.range(-300, 300), rng.range(-300, 300))
      const picked = stack.screenToWorld(screen, constraint)
      expect(picked).not.toBeNull()
      if (picked !== null) expectVecClose(stack.worldToScreen(picked), screen)
    }
  })

  it('topdown: ground and elevation constraints, 200 cases', () => {
    const rng = createRng(421)
    const projection = createTopDown({ scale: 1.5 })
    for (let k = 0; k < CASES; k++) {
      const stack = createTransformStack(projection, randomCamera(rng))
      const constraint: InverseConstraint =
        k % 2 === 0 ? { kind: 'elevation', z: rng.range(-10, 10) } : { kind: 'ground' }
      const world = {
        x: rng.range(-50, 50),
        y: rng.range(-50, 50),
        z: constraint.kind === 'elevation' ? constraint.z : 0,
      }
      expectWorldClose(stack.screenToWorld(stack.worldToScreen(world), constraint), world)

      const screen = Vec2.make(rng.range(-300, 300), rng.range(-300, 300))
      const picked = stack.screenToWorld(screen, constraint)
      expect(picked).not.toBeNull()
      if (picked !== null) expectVecClose(stack.worldToScreen(picked), screen)
    }
  })

  it('iso: ground and elevation constraints, 200 cases', () => {
    const rng = createRng(422)
    const projection = createIso({ tileWidth: 2, tileHeight: 1, zScale: 0.75 })
    for (let k = 0; k < CASES; k++) {
      const stack = createTransformStack(projection, randomCamera(rng))
      const constraint: InverseConstraint =
        k % 2 === 0 ? { kind: 'elevation', z: rng.range(-10, 10) } : { kind: 'ground' }
      const world = {
        x: rng.range(-50, 50),
        y: rng.range(-50, 50),
        z: constraint.kind === 'elevation' ? constraint.z : 0,
      }
      expectWorldClose(stack.screenToWorld(stack.worldToScreen(world), constraint), world)

      const screen = Vec2.make(rng.range(-300, 300), rng.range(-300, 300))
      const picked = stack.screenToWorld(screen, constraint)
      expect(picked).not.toBeNull()
      if (picked !== null) expectVecClose(stack.worldToScreen(picked), screen)
    }
  })
})

describe('the iso inverse, checked by hand and against its closed form', () => {
  it('hand-derivable case: view (4, 1) on the ground is world (3, 1, 0)', () => {
    // With defaults (w = 2, h = 1, k = 1): project(3, 1, 0) =
    // ((3 + 1)·1, (3 − 1)·0.5) = (4, 1). Now walk it backwards as a student
    // would: v′ = 1 + 0·1 = 1; sum = 4/1 = 4; diff = 1/0.5 = 2;
    // x = (4 + 2)/2 = 3; y = (4 − 2)/2 = 1.
    const iso = createIso()
    expect(iso.project({ x: 3, y: 1, z: 0 })).toEqual({ x: 4, y: 1 })
    expectWorldClose(iso.inverse(Vec2.make(4, 1), { kind: 'ground' }), { x: 3, y: 1, z: 0 })
  })

  it('hand-derivable case with elevation: undo the z·k slide first', () => {
    // project(2, 2, 1) = ((2 + 2)·1, (2 − 2)·0.5 − 1·1) = (4, −1). Backwards
    // with z pinned to 1: v′ = −1 + 1 = 0; sum = 4/1 = 4; diff = 0/0.5 = 0;
    // x = (4 + 0)/2 = 2; y = (4 − 0)/2 = 2.
    const iso = createIso()
    expect(iso.project({ x: 2, y: 2, z: 1 })).toEqual({ x: 4, y: -1 })
    expectWorldClose(iso.inverse(Vec2.make(4, -1), { kind: 'elevation', z: 1 }), {
      x: 2,
      y: 2,
      z: 1,
    })
  })

  it('property: inverse matches the closed form x = (u/(w/2) + v′/(h/2))/2, y = (u/(w/2) − v′/(h/2))/2', () => {
    const rng = createRng(423)
    const w = 4
    const h = 2
    const k = 1.5
    const iso = createIso({ tileWidth: w, tileHeight: h, zScale: k })
    for (let n = 0; n < CASES; n++) {
      const view = Vec2.make(rng.range(-100, 100), rng.range(-100, 100))
      const z = rng.range(-10, 10)
      const vPrime = view.y + z * k
      const expected = {
        x: (view.x / (w / 2) + vPrime / (h / 2)) / 2,
        y: (view.x / (w / 2) - vPrime / (h / 2)) / 2,
        z,
      }
      expectWorldClose(iso.inverse(view, { kind: 'elevation', z }), expected)
    }
  })
})

describe('invalid constraints return null — a fact about the geometry, not an error', () => {
  const view = Vec2.make(10, 20)

  it("profile rejects 'elevation': its screen already determines z; the missing number is y", () => {
    expect(createProfile().inverse(view, { kind: 'elevation', z: 3 })).toBeNull()
  })

  it("topdown rejects 'lane': its screen already determines y; the missing number is z", () => {
    expect(createTopDown().inverse(view, { kind: 'lane', y: 3 })).toBeNull()
  })

  it("iso rejects 'lane': iso tools always pin a height instead", () => {
    expect(createIso().inverse(view, { kind: 'lane', y: 3 })).toBeNull()
  })

  it("profile 'ground' behaves exactly as lane y = 0", () => {
    const profile = createProfile({ scale: 2 })
    expect(profile.inverse(view, { kind: 'ground' })).toEqual(
      profile.inverse(view, { kind: 'lane', y: 0 }),
    )
  })
})

describe('depth keys (the per-view ordering relation)', () => {
  it('profile: within-band depth is −y — smaller y is nearer the southern camera', () => {
    const p = createProfile()
    expect(p.depth({ x: 7, y: 5, z: 3 }, 0)).toBe(-5)
    // The nearer point (smaller y) gets the LARGER key: drawn later, on top.
    expect(p.depth({ x: 0, y: 1, z: 0 }, 0)).toBeGreaterThan(p.depth({ x: 0, y: 4, z: 0 }, 0))
  })

  it('topdown: within-band depth is z — higher things draw later', () => {
    const p = createTopDown()
    expect(p.depth({ x: 7, y: 5, z: 3 }, 0)).toBe(3)
    expect(p.depth({ x: 0, y: 0, z: 2 }, 0)).toBeGreaterThan(p.depth({ x: 9, y: 9, z: 1 }, 0))
  })

  it('iso: within-band depth is x − y + z — the south-east camera lesson', () => {
    const p = createIso()
    expect(p.depth({ x: 1, y: 2, z: 3 }, 0)).toBe(2)
    // A step east (+x) or up (+z) moves you one unit NEARER the south-east
    // camera; a step north (+y) moves you one unit farther.
    expect(p.depth({ x: 2, y: 1, z: 0 }, 0)).toBe(p.depth({ x: 1, y: 1, z: 1 }, 0))
    expect(p.depth({ x: 0, y: 1, z: 0 }, 0)).toBeLessThan(p.depth({ x: 0, y: 0, z: 0 }, 0))
  })

  it('bands always dominate: the composite key is band · DEPTH_BAND_STRIDE + within', () => {
    const p = createIso()
    expect(p.depth({ x: 1, y: 2, z: 3 }, 2)).toBe(2 * DEPTH_BAND_STRIDE + 2)
    // A huge within-band value in band 0 still loses to a tiny one in band 1.
    const hugeWithinBand0 = p.depth({ x: 500, y: 0, z: 50 }, 0)
    const tinyWithinBand1 = p.depth({ x: 0, y: 0, z: 0 }, 1)
    expect(hugeWithinBand0).toBeLessThan(tinyWithinBand1)
  })

  it('all three projections use the same band composition', () => {
    const at: WorldPoint = { x: 3, y: 4, z: 5 }
    const projections: Projection[] = [createProfile(), createTopDown(), createIso()]
    for (const p of projections) {
      expect(p.depth(at, 3) - p.depth(at, 0)).toBe(3 * DEPTH_BAND_STRIDE)
    }
  })
})

describe('the within-band clamp: band dominance survives even absurd coordinates', () => {
  // "Bands always dominate" has a precondition — |within| < STRIDE/2 — and
  // depth() enforces it by clamping to ±(STRIDE/2 − 1). These tests probe
  // the exact boundary and far beyond it, in all three projections.
  const LIMIT = DEPTH_BAND_STRIDE / 2 - 1

  // World points engineered so each projection's within-band key equals a
  // chosen value v: profile's key is −y, topdown's is z, iso's is x − y + z.
  const pointWithKey: Record<ProjectionName, (v: number) => WorldPoint> = {
    profile: (v) => ({ x: 0, y: -v, z: 0 }),
    topdown: (v) => ({ x: 0, y: 0, z: v }),
    iso: (v) => ({ x: v, y: 0, z: 0 }),
  }

  const projections: Projection[] = [createProfile(), createTopDown(), createIso()]

  it('at the boundary ±(STRIDE/2 − 1), bands still dominate in all three projections', () => {
    for (const p of projections) {
      const make = pointWithKey[p.name]
      const maxInBand0 = p.depth(make(LIMIT), 0)
      const minInBand1 = p.depth(make(-LIMIT), 1)
      expect(maxInBand0).toBe(LIMIT) // the boundary value passes through unclamped
      expect(minInBand1).toBe(DEPTH_BAND_STRIDE - LIMIT)
      expect(maxInBand0).toBeLessThan(minInBand1)
    }
  })

  it('beyond the boundary the key pins to the band edge instead of leaking into a neighbor', () => {
    for (const p of projections) {
      const make = pointWithKey[p.name]
      // Three full strides past anything sane — enough to reach band 3 if
      // the within-band term were folded in unclamped.
      const wildNear = p.depth(make(3 * DEPTH_BAND_STRIDE), 0)
      const wildFar = p.depth(make(-3 * DEPTH_BAND_STRIDE), 1)
      expect(wildNear).toBe(LIMIT) // pinned at band 0's near edge
      expect(wildFar).toBe(DEPTH_BAND_STRIDE - LIMIT) // pinned at band 1's far edge
      // Even the two worst cases stay in band order.
      expect(wildNear).toBeLessThan(wildFar)
    }
  })
})

describe('review regression: the published ground-constraint table matches behavior', () => {
  it("profile 'ground' pins y = 0 and carries z FROM the click — the point is generally not on the ground plane", () => {
    // The interface table (types.ts) promises this exact behavior; this test
    // keeps the published curriculum from silently drifting away from it.
    const profile = createProfile({ scale: 1 })
    expect(profile.inverse(Vec2.make(10, 20), { kind: 'ground' })).toEqual({ x: 10, y: 0, z: -20 })
  })

  it("topdown and iso 'ground' really do return z = 0", () => {
    const td = createTopDown({ scale: 1 }).inverse(Vec2.make(3, -4), { kind: 'ground' })
    const iso = createIso().inverse(Vec2.make(1, 2), { kind: 'ground' })
    expect(td?.z).toBe(0)
    expect(iso?.z).toBe(0)
  })
})
