import { describe, expect, it } from 'vitest'
import { createWorld, spawn } from '@engine/core'
import type { TileLayer, World } from '@engine/core'
import type { BuilderEvent } from '../src/events'
import { evaluateWorldPredicate, isEventPredicate, isWorldPredicate, matchEventPredicate } from '../src/predicates'
import type { EventPredicate } from '../src/predicates'
import type { StepPredicate } from '../src/types'

// NOTE: layers are hand-rolled literals on purpose — @engine/tutorial (and
// its tests) may not import @engine/tilemap; the dependency diet is part of
// the contract under test (see the predicates.ts header).
function makeLayer(opts: {
  id?: string
  width?: number
  height?: number
  set?: ReadonlyArray<readonly [number, number, number]>
}): TileLayer {
  const width = opts.width ?? 8
  const height = opts.height ?? 6
  const cells = new Uint16Array(width * height)
  for (const [tx, ty, tile] of opts.set ?? []) cells[ty * width + tx] = tile
  return {
    id: opts.id ?? 'ground',
    name: opts.id ?? 'ground',
    width,
    height,
    elevation: 0,
    layerBand: 0,
    tilesetId: 'ts',
    cells,
  }
}

function worldWithLayers(...layers: TileLayer[]): World {
  const world = createWorld()
  world.layers.push(...layers)
  return world
}

const painted: BuilderEvent = {
  type: 'builder.tile-painted',
  layerId: 'ground',
  tile: 2,
  cells: [{ tx: 1, ty: 1 }],
  toolId: 'brush',
}
const saved: BuilderEvent = { type: 'builder.world-saved', worldId: 'w1' }

describe('evaluateWorldPredicate: tile-at', () => {
  it('reads the FIRST layer when layerId is omitted', () => {
    const doc = worldWithLayers(makeLayer({ id: 'a', set: [[3, 2, 5]] }), makeLayer({ id: 'b' }))
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 3, ty: 2 })).toBe(true)
  })

  it('reads the named layer when layerId is given', () => {
    const doc = worldWithLayers(makeLayer({ id: 'a' }), makeLayer({ id: 'b', set: [[1, 1, 4]] }))
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 1, ty: 1, layerId: 'b' })).toBe(true)
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 1, ty: 1, layerId: 'a' })).toBe(false)
  })

  it('is false for an unknown layer, and for a world with no layers at all', () => {
    const doc = worldWithLayers(makeLayer({ id: 'a', set: [[0, 0, 1]] }))
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 0, ty: 0, layerId: 'nope' })).toBe(false)
    expect(evaluateWorldPredicate(createWorld(), { kind: 'tile-at', tx: 0, ty: 0 })).toBe(false)
  })

  it('bounds-checks: out-of-range and fractional coordinates are false, never a wrapped read', () => {
    const doc = worldWithLayers(makeLayer({ width: 4, height: 3, set: [[0, 1, 9]] }))
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: -1, ty: 0 })).toBe(false)
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 4, ty: 0 })).toBe(false)
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 0, ty: 3 })).toBe(false)
    // (-1, 2) would alias cell (3, 1) under naive index math — 2*4 + (-1) = 7 = 1*4 + 3.
    const aliased = worldWithLayers(makeLayer({ width: 4, height: 3, set: [[3, 1, 9]] }))
    expect(evaluateWorldPredicate(aliased, { kind: 'tile-at', tx: -1, ty: 2 })).toBe(false)
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 0.5, ty: 1 })).toBe(false)
  })

  it('tile omitted means "any non-empty"; explicit tile matches exactly; tile 0 asks "is empty?"', () => {
    const doc = worldWithLayers(makeLayer({ set: [[2, 2, 7]] }))
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 2, ty: 2 })).toBe(true)
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 3, ty: 3 })).toBe(false)
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 2, ty: 2, tile: 7 })).toBe(true)
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 2, ty: 2, tile: 6 })).toBe(false)
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 3, ty: 3, tile: 0 })).toBe(true)
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 2, ty: 2, tile: 0 })).toBe(false)
  })

  it('addresses cells by the taught row-major formula: index = ty * width + tx', () => {
    // width 5: cell (3, 2) lives at raw index 2*5 + 3 = 13. Write index 13
    // by hand and ask for (3, 2) — and prove (2, 3) is NOT the same cell.
    const layer = makeLayer({ width: 5, height: 4 })
    layer.cells[13] = 7
    const doc = worldWithLayers(layer)
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 3, ty: 2, tile: 7 })).toBe(true)
    expect(evaluateWorldPredicate(doc, { kind: 'tile-at', tx: 2, ty: 3, tile: 7 })).toBe(false)
  })
})

describe('evaluateWorldPredicate: entity-exists', () => {
  it('counts entities whose marker.kind matches, default atLeast 1', () => {
    const doc = createWorld()
    spawn(doc, { components: { marker: { kind: 'crate' } } })
    expect(evaluateWorldPredicate(doc, { kind: 'entity-exists', marker: 'crate' })).toBe(true)
    expect(evaluateWorldPredicate(doc, { kind: 'entity-exists', marker: 'tree' })).toBe(false)
  })

  it('honors atLeast', () => {
    const doc = createWorld()
    spawn(doc, { components: { marker: { kind: 'crate' } } })
    expect(evaluateWorldPredicate(doc, { kind: 'entity-exists', marker: 'crate', atLeast: 2 })).toBe(false)
    spawn(doc, { components: { marker: { kind: 'crate' } } })
    expect(evaluateWorldPredicate(doc, { kind: 'entity-exists', marker: 'crate', atLeast: 2 })).toBe(true)
  })

  it('ignores malformed markers — a marker is an object with a string kind, or it is nothing', () => {
    const doc = createWorld()
    spawn(doc, { components: { marker: 'crate' } }) // string, not object
    spawn(doc, { components: { marker: { kind: 7 } } }) // kind is not a string
    spawn(doc, { components: { marker: null } })
    spawn(doc, { components: {} }) // no marker at all
    expect(evaluateWorldPredicate(doc, { kind: 'entity-exists', marker: 'crate' })).toBe(false)
  })
})

describe('evaluateWorldPredicate: entity-at', () => {
  it('matches when the marker entity position FLOORS to the cell', () => {
    const doc = createWorld()
    spawn(doc, { components: { marker: { kind: 'crate' }, position: { x: 3.7, y: 4.2 } } })
    expect(evaluateWorldPredicate(doc, { kind: 'entity-at', marker: 'crate', tx: 3, ty: 4 })).toBe(true)
    expect(evaluateWorldPredicate(doc, { kind: 'entity-at', marker: 'crate', tx: 4, ty: 4 })).toBe(false)
  })

  it('floors negative positions toward negative infinity: (-0.5, 2) stands on cell (-1, 2)', () => {
    const doc = createWorld()
    spawn(doc, { components: { marker: { kind: 'crate' }, position: { x: -0.5, y: 2 } } })
    expect(evaluateWorldPredicate(doc, { kind: 'entity-at', marker: 'crate', tx: -1, ty: 2 })).toBe(true)
    expect(evaluateWorldPredicate(doc, { kind: 'entity-at', marker: 'crate', tx: 0, ty: 2 })).toBe(false)
  })

  it('reads position defensively — unreadable position means "not in the geometry"', () => {
    const doc = createWorld()
    spawn(doc, { components: { marker: { kind: 'crate' } } }) // no position
    spawn(doc, { components: { marker: { kind: 'chest' }, position: { x: '3', y: 4 } } })
    expect(evaluateWorldPredicate(doc, { kind: 'entity-at', marker: 'crate', tx: 0, ty: 0 })).toBe(false)
    expect(evaluateWorldPredicate(doc, { kind: 'entity-at', marker: 'chest', tx: 3, ty: 4 })).toBe(false)
  })

  it('any matching marker entity satisfies it, not only the first', () => {
    const doc = createWorld()
    spawn(doc, { components: { marker: { kind: 'crate' }, position: { x: 0, y: 0 } } })
    spawn(doc, { components: { marker: { kind: 'crate' }, position: { x: 5, y: 5 } } })
    expect(evaluateWorldPredicate(doc, { kind: 'entity-at', marker: 'crate', tx: 5, ty: 5 })).toBe(true)
  })
})

describe('evaluateWorldPredicate: entity-distance', () => {
  const between = (distance: number, tolerance?: number): StepPredicate => ({
    kind: 'entity-distance',
    markerA: 'player',
    markerB: 'chest',
    distance,
    ...(tolerance === undefined ? {} : { tolerance }),
  })

  it('measures ground-plane Euclidean distance: the 3-4-5 triangle', () => {
    const doc = createWorld()
    spawn(doc, { components: { marker: { kind: 'player' }, position: { x: 0, y: 0 } } })
    spawn(doc, { components: { marker: { kind: 'chest' }, position: { x: 3, y: 4 } } })
    expect(evaluateWorldPredicate(doc, between(5))).toBe(true)
    expect(evaluateWorldPredicate(doc, between(4))).toBe(false)
  })

  it('defaults tolerance to 0.05 — float dust passes, a real miss fails', () => {
    const doc = createWorld()
    spawn(doc, { components: { marker: { kind: 'player' }, position: { x: 0, y: 0 } } })
    spawn(doc, { components: { marker: { kind: 'chest' }, position: { x: 3, y: 4.04 } } })
    // hypot(3, 4.04) ≈ 5.032 → within 0.05 of 5.
    expect(evaluateWorldPredicate(doc, between(5))).toBe(true)
    const miss = createWorld()
    spawn(miss, { components: { marker: { kind: 'player' }, position: { x: 0, y: 0 } } })
    spawn(miss, { components: { marker: { kind: 'chest' }, position: { x: 3, y: 4.1 } } })
    // hypot(3, 4.1) ≈ 5.080 → outside 0.05.
    expect(evaluateWorldPredicate(miss, between(5))).toBe(false)
  })

  it('honors an explicit tolerance, including zero for exact-only', () => {
    const doc = createWorld()
    spawn(doc, { components: { marker: { kind: 'player' }, position: { x: 0, y: 0 } } })
    spawn(doc, { components: { marker: { kind: 'chest' }, position: { x: 0, y: 5.4 } } })
    expect(evaluateWorldPredicate(doc, between(5, 0.5))).toBe(true)
    expect(evaluateWorldPredicate(doc, between(5, 0.3))).toBe(false)
    const exact = createWorld()
    spawn(exact, { components: { marker: { kind: 'player' }, position: { x: 0, y: 0 } } })
    spawn(exact, { components: { marker: { kind: 'chest' }, position: { x: 3, y: 4 } } })
    expect(evaluateWorldPredicate(exact, between(5, 0))).toBe(true)
  })

  it('is false when either marker is missing or its position is unreadable', () => {
    const doc = createWorld()
    spawn(doc, { components: { marker: { kind: 'player' }, position: { x: 0, y: 0 } } })
    expect(evaluateWorldPredicate(doc, between(5))).toBe(false) // no chest at all
    spawn(doc, { components: { marker: { kind: 'chest' } } }) // chest without a place
    expect(evaluateWorldPredicate(doc, between(5))).toBe(false)
  })

  it('uses the FIRST entity of each marker in entityIds order', () => {
    const doc = createWorld()
    spawn(doc, { components: { marker: { kind: 'player' }, position: { x: 0, y: 0 } } }) // e1 — the one measured
    spawn(doc, { components: { marker: { kind: 'player' }, position: { x: 100, y: 100 } } }) // e2 — ignored
    spawn(doc, { components: { marker: { kind: 'chest' }, position: { x: 3, y: 4 } } })
    expect(evaluateWorldPredicate(doc, between(5))).toBe(true)

    const flipped = createWorld()
    spawn(flipped, { components: { marker: { kind: 'player' }, position: { x: 100, y: 100 } } }) // e1 — measured, far away
    spawn(flipped, { components: { marker: { kind: 'player' }, position: { x: 0, y: 0 } } })
    spawn(flipped, { components: { marker: { kind: 'chest' }, position: { x: 3, y: 4 } } })
    expect(evaluateWorldPredicate(flipped, between(5))).toBe(false)
  })

  it('measures the ground plane only — elevation does not stretch the distance', () => {
    const doc = createWorld()
    spawn(doc, { components: { marker: { kind: 'player' }, position: { x: 0, y: 0 }, elevation: { z: 10 } } })
    spawn(doc, { components: { marker: { kind: 'chest' }, position: { x: 3, y: 4 } } })
    expect(evaluateWorldPredicate(doc, between(5))).toBe(true)
  })
})

describe('evaluateWorldPredicate: all / any composition', () => {
  const yes: StepPredicate = { kind: 'entity-exists', marker: 'crate' }
  const no: StepPredicate = { kind: 'entity-exists', marker: 'ghost' }
  const docWithCrate = (): World => {
    const doc = createWorld()
    spawn(doc, { components: { marker: { kind: 'crate' } } })
    return doc
  }

  it('empty all is TRUE (vacuous truth) and empty any is FALSE (no member can succeed)', () => {
    const doc = createWorld()
    expect(evaluateWorldPredicate(doc, { kind: 'all', of: [] })).toBe(true)
    expect(evaluateWorldPredicate(doc, { kind: 'any', of: [] })).toBe(false)
  })

  it('all requires every leaf; any requires one', () => {
    const doc = docWithCrate()
    expect(evaluateWorldPredicate(doc, { kind: 'all', of: [yes, yes] })).toBe(true)
    expect(evaluateWorldPredicate(doc, { kind: 'all', of: [yes, no] })).toBe(false)
    expect(evaluateWorldPredicate(doc, { kind: 'any', of: [no, yes] })).toBe(true)
    expect(evaluateWorldPredicate(doc, { kind: 'any', of: [no, no] })).toBe(false)
  })

  it('nests', () => {
    const doc = docWithCrate()
    const nested: StepPredicate = { kind: 'all', of: [yes, { kind: 'any', of: [no, yes] }] }
    expect(evaluateWorldPredicate(doc, nested)).toBe(true)
  })

  it('treats an event leaf as unsatisfied: it poisons every all, while an any may still pass through a world leaf', () => {
    const doc = docWithCrate()
    const eventLeaf: StepPredicate = { kind: 'event', type: 'builder.world-saved' }
    expect(evaluateWorldPredicate(doc, eventLeaf)).toBe(false)
    expect(evaluateWorldPredicate(doc, { kind: 'all', of: [yes, eventLeaf] })).toBe(false)
    // Validation forbids authoring this mix; the evaluator still answers
    // honestly if handed one.
    expect(evaluateWorldPredicate(doc, { kind: 'any', of: [eventLeaf, yes] })).toBe(true)
  })
})

describe('isEventPredicate / isWorldPredicate', () => {
  const event: StepPredicate = { kind: 'event', type: 'builder.world-saved' }
  const tile: StepPredicate = { kind: 'tile-at', tx: 0, ty: 0 }

  it('classifies leaves', () => {
    expect(isEventPredicate(event)).toBe(true)
    expect(isWorldPredicate(event)).toBe(false)
    expect(isEventPredicate(tile)).toBe(false)
    expect(isWorldPredicate(tile)).toBe(true)
  })

  it('a composition of world leaves is a world predicate', () => {
    const composed: StepPredicate = { kind: 'all', of: [tile, { kind: 'any', of: [tile] }] }
    expect(isWorldPredicate(composed)).toBe(true)
    expect(isEventPredicate(composed)).toBe(false)
  })

  it('a composition containing an event leaf — however deep — is NEITHER family', () => {
    const mixed: StepPredicate = { kind: 'all', of: [tile, { kind: 'any', of: [event] }] }
    expect(isWorldPredicate(mixed)).toBe(false)
    expect(isEventPredicate(mixed)).toBe(false)
  })
})

describe('matchEventPredicate', () => {
  it('matches on the resolved event type', () => {
    const p: EventPredicate = { kind: 'event', type: 'builder.world-saved' }
    expect(matchEventPredicate(saved, p)).toBe(true)
    expect(matchEventPredicate(painted, p)).toBe(false)
  })

  it('never matches a type outside the frozen vocabulary (nothing resolves it)', () => {
    const p: EventPredicate = { kind: 'event', type: 'builder.nonsense' }
    expect(matchEventPredicate(saved, p)).toBe(false)
  })

  it('where fields must ALL be strictly equal on the payload top level', () => {
    expect(matchEventPredicate(painted, { kind: 'event', type: 'builder.tile-painted', where: { tile: 2 } })).toBe(true)
    expect(matchEventPredicate(painted, { kind: 'event', type: 'builder.tile-painted', where: { tile: 3 } })).toBe(false)
    expect(
      matchEventPredicate(painted, {
        kind: 'event',
        type: 'builder.tile-painted',
        where: { tile: 2, layerId: 'ground' },
      }),
    ).toBe(true)
    expect(
      matchEventPredicate(painted, {
        kind: 'event',
        type: 'builder.tile-painted',
        where: { tile: 2, layerId: 'sky' },
      }),
    ).toBe(false)
  })

  it('strict means strict: "2" the string does not match 2 the number', () => {
    expect(matchEventPredicate(painted, { kind: 'event', type: 'builder.tile-painted', where: { tile: '2' } })).toBe(false)
  })

  it('a field the event does not carry matches nothing; an empty where matches any event of the type', () => {
    expect(
      matchEventPredicate(painted, { kind: 'event', type: 'builder.tile-painted', where: { worldId: 'w1' } }),
    ).toBe(false)
    expect(matchEventPredicate(painted, { kind: 'event', type: 'builder.tile-painted', where: {} })).toBe(true)
  })

  it('evaluateWorldPredicate never satisfies an event predicate — a moment is not a snapshot', () => {
    const doc = createWorld()
    expect(evaluateWorldPredicate(doc, { kind: 'event', type: 'builder.world-saved' })).toBe(false)
  })
})

describe('matchEventPredicate: toCell', () => {
  // A drag-drop that lands mid-cell: (6.3, 8.9) stands on cell (6, 8) —
  // the same floor convention entity-at uses.
  const moved: BuilderEvent = {
    type: 'builder.entity-moved',
    id: 'e1',
    from: { x: 3, y: 4, z: 0 },
    to: { x: 6.3, y: 8.9, z: 0 },
  }
  const movedTo = (tx: number, ty: number): EventPredicate => ({
    kind: 'event',
    type: 'builder.entity-moved',
    toCell: { tx, ty },
  })

  it('hits when the event to-position FLOORS into the named cell', () => {
    expect(matchEventPredicate(moved, movedTo(6, 8))).toBe(true)
  })

  it('misses a neighboring cell — near is not in', () => {
    expect(matchEventPredicate(moved, movedTo(7, 8))).toBe(false)
    expect(matchEventPredicate(moved, movedTo(6, 9))).toBe(false)
  })

  it('floors toward negative infinity: a drop at (-0.5, 2) lands in cell (-1, 2), not (0, 2)', () => {
    const negativeDrop: BuilderEvent = {
      type: 'builder.entity-moved',
      id: 'e1',
      from: { x: 0, y: 0, z: 0 },
      to: { x: -0.5, y: 2, z: 0 },
    }
    expect(matchEventPredicate(negativeDrop, movedTo(-1, 2))).toBe(true)
    expect(matchEventPredicate(negativeDrop, movedTo(0, 2))).toBe(false)
  })

  it('never matches a non-moved event, even when the predicate type matches it — only a move HAS a destination', () => {
    // Validation forbids authoring toCell on anything but entity-moved; the
    // matcher still fails safe when handed one.
    const paintedWithCell: EventPredicate = {
      kind: 'event',
      type: 'builder.tile-painted',
      toCell: { tx: 1, ty: 1 },
    }
    expect(matchEventPredicate(painted, paintedWithCell)).toBe(false)
    // Control: the same predicate without toCell matches the same event.
    expect(matchEventPredicate(painted, { kind: 'event', type: 'builder.tile-painted' })).toBe(true)
    // And a type mismatch stays a mismatch, toCell or not.
    expect(matchEventPredicate(saved, movedTo(6, 8))).toBe(false)
  })

  it('ANDs with where: both the named fields and the landing cell must hit', () => {
    const both: EventPredicate = {
      kind: 'event',
      type: 'builder.entity-moved',
      where: { id: 'e1' },
      toCell: { tx: 6, ty: 8 },
    }
    expect(matchEventPredicate(moved, both)).toBe(true)
    const wrongWhere: EventPredicate = { ...both, where: { id: 'e2' } }
    expect(matchEventPredicate(moved, wrongWhere)).toBe(false)
    const wrongCell: EventPredicate = { ...both, toCell: { tx: 0, ty: 0 } }
    expect(matchEventPredicate(moved, wrongCell)).toBe(false)
  })
})

describe('matchEventPredicate: atCell', () => {
  // A drag-paint that changed three cells — atCell must find ANY one of
  // them, not just the first or last.
  const gesture: BuilderEvent = {
    type: 'builder.tile-painted',
    layerId: 'portrait',
    tile: 1,
    cells: [
      { tx: 2, ty: 3 },
      { tx: 5, ty: 9 },
      { tx: 7, ty: 1 },
    ],
    toolId: 'brush',
  }
  const paintedAt = (tx: number, ty: number): EventPredicate => ({
    kind: 'event',
    type: 'builder.tile-painted',
    atCell: { tx, ty },
  })

  it('hits when the named cell is among the gesture\'s painted cells — first, middle, or last', () => {
    expect(matchEventPredicate(gesture, paintedAt(2, 3))).toBe(true)
    expect(matchEventPredicate(gesture, paintedAt(5, 9))).toBe(true)
    expect(matchEventPredicate(gesture, paintedAt(7, 1))).toBe(true)
  })

  it('misses a cell the gesture never touched — near is not in', () => {
    expect(matchEventPredicate(gesture, paintedAt(2, 4))).toBe(false)
    expect(matchEventPredicate(gesture, paintedAt(0, 0))).toBe(false)
  })

  it('never matches a non-painted event, even when the predicate type matches it — only a paint gesture HAS painted cells', () => {
    // Validation forbids authoring atCell on anything but tile-painted; the
    // matcher still fails safe when handed one.
    const moved: BuilderEvent = {
      type: 'builder.entity-moved',
      id: 'e1',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 2, y: 3, z: 0 },
    }
    const movedWithCell: EventPredicate = {
      kind: 'event',
      type: 'builder.entity-moved',
      atCell: { tx: 1, ty: 1 },
    }
    expect(matchEventPredicate(moved, movedWithCell)).toBe(false)
    // Control: the same predicate without atCell matches the same event.
    expect(matchEventPredicate(moved, { kind: 'event', type: 'builder.entity-moved' })).toBe(true)
    // And a type mismatch stays a mismatch, atCell or not.
    expect(matchEventPredicate(saved, paintedAt(2, 3))).toBe(false)
  })

  it('fails safe on a malformed cells payload — an array of non-cell entries, or no array at all', () => {
    const notAnArray = { ...gesture, cells: null } as unknown as BuilderEvent
    expect(matchEventPredicate(notAnArray, paintedAt(2, 3))).toBe(false)
    const garbageEntries = {
      ...gesture,
      cells: ['nope', { tx: '2', ty: 3 }, { tx: 2 }, null],
    } as unknown as BuilderEvent
    expect(matchEventPredicate(garbageEntries, paintedAt(2, 3))).toBe(false)
  })

  it('ANDs with where: both the named fields and the painted cell must hit', () => {
    const both: EventPredicate = {
      kind: 'event',
      type: 'builder.tile-painted',
      where: { tile: 1 },
      atCell: { tx: 5, ty: 9 },
    }
    expect(matchEventPredicate(gesture, both)).toBe(true)
    const wrongWhere: EventPredicate = { ...both, where: { tile: 2 } }
    expect(matchEventPredicate(gesture, wrongWhere)).toBe(false)
    const wrongCell: EventPredicate = { ...both, atCell: { tx: 0, ty: 0 } }
    expect(matchEventPredicate(gesture, wrongCell)).toBe(false)
  })
})
