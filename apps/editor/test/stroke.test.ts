/*
 * Tile-stroke semantics — the raster half of the split undo substrate.
 *
 * One stroke = one gesture = at most ONE history entry and ONE
 * builder.tile-painted event, no matter how many pointer moves fed it.
 * These tests pin the whole gesture protocol: coalescing, first-paint
 * order, cancel-leaves-no-trace, zero-change-commits-nothing, the
 * stroke-open atomicity throws, byte-exact undo/redo, and the host's
 * tilesTouched being told about real cell changes only.
 */

import { createWorld, getEntity } from '@engine/core'
import type { World } from '@engine/core'
import { createTileLayer, getCell } from '@engine/tilemap'
import { serializeWorld } from '@engine/world-format'
import { describe, expect, it } from 'vitest'
import { createCommandBus } from '../src/editor/commands/bus'
import type { BuilderEvent } from '../src/editor/events/builder'
import type { DocumentHost } from '../src/editor/types'

// --- rig -------------------------------------------------------------------

interface Rig {
  readonly host: DocumentHost
  readonly bus: ReturnType<typeof createCommandBus>
  readonly events: BuilderEvent[]
  readonly touched: string[]
}

function createRig(initial: World): Rig {
  let doc = initial
  const events: BuilderEvent[] = []
  const touched: string[] = []
  const host: DocumentHost = {
    get doc() {
      return doc
    },
    replaceDoc(next: World) {
      doc = next
    },
    tilesTouched(layerId: string) {
      touched.push(layerId)
    },
  }
  const bus = createCommandBus({ host, emit: (event) => events.push(event) })
  return { host, bus, events, touched }
}

/** A 6×4 ground layer, blank except cell (0,0) = 1 and cell (5,3) = 2 —
 * pre-filled cells so both painting-over and erasing have something real. */
function strokeWorld(): World {
  const world = createWorld({ name: 'stroke world', settings: { seed: 9 } })
  world.tilesets.push({
    id: 'terrain',
    name: 'terrain',
    tiles: [
      { name: 'grass', colors: { top: '#4caf50' } },
      { name: 'water', colors: { top: '#2196f3' } },
      { name: 'sand', colors: { top: '#ffe082' } },
    ],
  })
  const cells = new Array<number>(6 * 4).fill(0)
  cells[0] = 1 // (0,0)
  cells[3 * 6 + 5] = 2 // (5,3)
  world.layers.push(createTileLayer({ id: 'ground', width: 6, height: 4, tilesetId: 'terrain', cells }))
  return world
}

// --- gesture protocol ------------------------------------------------------

describe('stroke gestures', () => {
  it('returns null for a layer that does not exist', () => {
    const { bus } = createRig(strokeWorld())
    expect(bus.beginTileStroke('no-such-layer', 1)).toBeNull()
    // And the bus is NOT left thinking a stroke is open.
    expect(bus.dispatch({ kind: 'rename-world', name: 'still alive' }).ok).toBe(true)
  })

  it('coalesces repeat paints of one cell: one run, original before, one event cell', () => {
    const { host, bus, events } = createRig(strokeWorld())
    const before = serializeWorld(host.doc)

    const stroke = bus.beginTileStroke('ground', 3)
    expect(stroke).not.toBeNull()
    if (stroke === null) return
    expect(stroke.paint(1, 1)).toBe(true)
    expect(stroke.paint(2, 1)).toBe(true)
    expect(stroke.paint(1, 1)).toBe(false) // already 3 — painting sand on sand is a no-op
    stroke.end()

    expect(events).toEqual([
      {
        type: 'builder.tile-painted',
        layerId: 'ground',
        tile: 3,
        cells: [
          { tx: 1, ty: 1 },
          { tx: 2, ty: 1 },
        ], // first-paint order, the repeat coalesced away
        toolId: 'brush',
      },
    ])

    // The coalesced run kept the ORIGINAL before: one undo restores it.
    expect(bus.undo()).toBe('paint 2 tiles')
    expect(serializeWorld(host.doc)).toBe(before)
  })

  it('lists event cells in first-paint order, not grid order', () => {
    const { bus, events } = createRig(strokeWorld())
    const stroke = bus.beginTileStroke('ground', 1)
    if (stroke === null) throw new Error('layer missing')
    stroke.paint(3, 2)
    stroke.paint(1, 0)
    stroke.paint(2, 1)
    stroke.end()

    expect(events).toHaveLength(1) // ONE event for the whole gesture
    const event = events[0] as Extract<BuilderEvent, { type: 'builder.tile-painted' }>
    expect(event.cells).toEqual([
      { tx: 3, ty: 2 },
      { tx: 1, ty: 0 },
      { tx: 2, ty: 1 },
    ])
  })

  it('cancel reverts every painted cell exactly and leaves no trace', () => {
    const { host, bus, events } = createRig(strokeWorld())
    const before = serializeWorld(host.doc)

    const stroke = bus.beginTileStroke('ground', 2)
    if (stroke === null) throw new Error('layer missing')
    stroke.paint(0, 0) // overwrites the pre-filled 1
    stroke.paint(1, 0)
    stroke.paint(4, 2)
    stroke.cancel()

    expect(serializeWorld(host.doc)).toBe(before)
    expect(bus.canUndo()).toBe(false)
    expect(events).toEqual([]) // cancelled gestures emit nothing
  })

  it('a stroke that changed nothing commits nothing', () => {
    const { host, bus, events } = createRig(strokeWorld())
    const before = serializeWorld(host.doc)

    const stroke = bus.beginTileStroke('ground', 1)
    if (stroke === null) throw new Error('layer missing')
    expect(stroke.paint(0, 0)).toBe(false) // (0,0) is already 1
    expect(stroke.paint(-1, 2)).toBe(false) // out of bounds
    stroke.end()

    expect(serializeWorld(host.doc)).toBe(before)
    expect(bus.canUndo()).toBe(false)
    expect(events).toEqual([])
  })

  it('out-of-bounds and fractional paints return false and record nothing', () => {
    const { host, bus } = createRig(strokeWorld())
    const before = serializeWorld(host.doc)
    const stroke = bus.beginTileStroke('ground', 3)
    if (stroke === null) throw new Error('layer missing')
    expect(stroke.paint(-1, 0)).toBe(false)
    expect(stroke.paint(6, 0)).toBe(false) // width is 6, so tx 6 is one past the edge
    expect(stroke.paint(0, 4)).toBe(false) // height is 4
    expect(stroke.paint(0.5, 1)).toBe(false) // between cells is not a cell
    stroke.end()
    expect(serializeWorld(host.doc)).toBe(before)
    expect(bus.canUndo()).toBe(false)
  })

  it('erasing (tile 0) works and labels itself honestly', () => {
    const { host, bus } = createRig(strokeWorld())
    const stroke = bus.beginTileStroke('ground', 0)
    if (stroke === null) throw new Error('layer missing')
    expect(stroke.paint(0, 0)).toBe(true) // 1 → 0
    expect(stroke.paint(5, 3)).toBe(true) // 2 → 0
    stroke.end()

    const layer = host.doc.layers[0]
    if (layer === undefined) throw new Error('layer missing')
    expect(getCell(layer, 0, 0)).toBe(0)
    expect(getCell(layer, 5, 3)).toBe(0)
    expect(bus.undo()).toBe('erase 2 tiles')
  })
})

// --- strokeOpen: the polite door to the atomicity latch --------------------

describe('strokeOpen', () => {
  it('reports false → true → false across begin/end', () => {
    const { bus } = createRig(strokeWorld())
    expect(bus.strokeOpen()).toBe(false)
    const stroke = bus.beginTileStroke('ground', 1)
    if (stroke === null) throw new Error('layer missing')
    expect(bus.strokeOpen()).toBe(true)
    stroke.paint(1, 1) // painting mid-gesture keeps the flag up
    expect(bus.strokeOpen()).toBe(true)
    stroke.end()
    expect(bus.strokeOpen()).toBe(false)
  })

  it('reports false → true → false across begin/cancel', () => {
    const { bus } = createRig(strokeWorld())
    expect(bus.strokeOpen()).toBe(false)
    const stroke = bus.beginTileStroke('ground', 2)
    if (stroke === null) throw new Error('layer missing')
    expect(bus.strokeOpen()).toBe(true)
    stroke.cancel()
    expect(bus.strokeOpen()).toBe(false)
  })

  it('a refused begin (unknown layer) never latches the flag', () => {
    const { bus } = createRig(strokeWorld())
    expect(bus.beginTileStroke('no-such-layer', 1)).toBeNull()
    expect(bus.strokeOpen()).toBe(false)
  })
})

// --- atomicity: a gesture admits no interleaving ---------------------------

describe('stroke-open atomicity', () => {
  it('dispatch/undo/redo/beginTileStroke/clearHistory all throw while a stroke is open', () => {
    const { bus } = createRig(strokeWorld())
    const stroke = bus.beginTileStroke('ground', 1)
    if (stroke === null) throw new Error('layer missing')
    stroke.paint(2, 2)

    expect(() => bus.dispatch({ kind: 'rename-world', name: 'nope' })).toThrow(/stroke is open/)
    expect(() => bus.undo()).toThrow(/stroke is open/)
    expect(() => bus.redo()).toThrow(/stroke is open/)
    expect(() => bus.beginTileStroke('ground', 2)).toThrow(/stroke is open/)
    expect(() => bus.clearHistory()).toThrow(/stroke is open/)

    // Ending the stroke reopens the bus for business.
    stroke.end()
    expect(bus.dispatch({ kind: 'rename-world', name: 'fine now' }).ok).toBe(true)
  })

  it('cancel also releases the atomicity latch', () => {
    const { bus } = createRig(strokeWorld())
    const stroke = bus.beginTileStroke('ground', 1)
    if (stroke === null) throw new Error('layer missing')
    stroke.paint(2, 2)
    stroke.cancel()
    expect(bus.dispatch({ kind: 'rename-world', name: 'fine' }).ok).toBe(true)
  })

  it('a closed stroke refuses further use', () => {
    const { bus } = createRig(strokeWorld())
    const stroke = bus.beginTileStroke('ground', 1)
    if (stroke === null) throw new Error('layer missing')
    stroke.end()
    expect(() => stroke.paint(0, 0)).toThrow(/already ended/)
    expect(() => stroke.end()).toThrow(/already ended/)
    expect(() => stroke.cancel()).toThrow(/already ended/)
  })
})

// --- undo/redo of strokes: byte-exact, in-place ----------------------------

describe('stroke undo/redo', () => {
  it('restores cells byte-exactly through undo and redo', () => {
    const { host, bus } = createRig(strokeWorld())
    const before = serializeWorld(host.doc)

    const stroke = bus.beginTileStroke('ground', 2)
    if (stroke === null) throw new Error('layer missing')
    stroke.paint(0, 0) // 1 → 2
    stroke.paint(1, 1) // 0 → 2
    stroke.paint(5, 3) // pre-filled with 2 already — a no-op, never recorded
    stroke.paint(4, 3) // 0 → 2
    stroke.end()
    const after = serializeWorld(host.doc)
    expect(after).not.toBe(before)

    expect(bus.undo()).toBe('paint 3 tiles') // the (5,3) no-op never recorded
    expect(serializeWorld(host.doc)).toBe(before)
    expect(bus.redo()).toBe('paint 3 tiles')
    expect(serializeWorld(host.doc)).toBe(after)

    // Twice more — in-place mutation has no snapshots to hide behind.
    bus.undo()
    expect(serializeWorld(host.doc)).toBe(before)
    bus.redo()
    expect(serializeWorld(host.doc)).toBe(after)
  })

  it('stroke undo survives interleaved entity commands (the split substrate joint)', () => {
    const { host, bus } = createRig(strokeWorld())
    const start = serializeWorld(host.doc)

    const stroke = bus.beginTileStroke('ground', 3)
    if (stroke === null) throw new Error('layer missing')
    stroke.paint(2, 2)
    stroke.end()

    // An entity command replaces the document OBJECT — but structural
    // sharing keeps the layers array (and its cells) reference-identical,
    // so the stroke's history entry still points at the live layer.
    bus.dispatch({ kind: 'place-entity', marker: 'crate', position: { x: 1, y: 1 }, elevation: 0 })
    const crateId = `e${host.doc.nextEntityId - 1}`
    expect(getEntity(host.doc, crateId)).toBeDefined()

    expect(bus.undo()).toBe('place crate')
    expect(bus.undo()).toBe('paint 1 tile')
    expect(serializeWorld(host.doc)).toBe(start)
  })
})

// --- tilesTouched: real changes only ---------------------------------------

describe('tilesTouched', () => {
  it('fires per actually-changed paint, on undo/redo of a stroke, and on cancel — never for no-ops', () => {
    const { bus, touched } = createRig(strokeWorld())

    const stroke = bus.beginTileStroke('ground', 1)
    if (stroke === null) throw new Error('layer missing')
    stroke.paint(0, 0) // (0,0) already 1: no change
    expect(touched).toEqual([])
    stroke.paint(-1, 0) // out of bounds: no change
    expect(touched).toEqual([])
    stroke.paint(1, 0) // real change
    expect(touched).toEqual(['ground'])
    stroke.paint(1, 0) // repeat: no change
    expect(touched).toEqual(['ground'])
    stroke.end() // committing touches nothing further
    expect(touched).toEqual(['ground'])

    bus.undo() // stroke undo mutates cells in place → touched, no replaceDoc
    expect(touched).toEqual(['ground', 'ground'])
    bus.redo()
    expect(touched).toEqual(['ground', 'ground', 'ground'])
  })

  it('cancel reports touched only when cells were actually reverted', () => {
    const { bus, touched } = createRig(strokeWorld())

    // A stroke that changed nothing: cancel stays silent.
    const empty = bus.beginTileStroke('ground', 1)
    if (empty === null) throw new Error('layer missing')
    empty.paint(0, 0) // already 1
    empty.cancel()
    expect(touched).toEqual([])

    // A stroke that changed one cell: cancel reverts it → one more touch.
    const real = bus.beginTileStroke('ground', 2)
    if (real === null) throw new Error('layer missing')
    real.paint(1, 1)
    expect(touched).toEqual(['ground'])
    real.cancel()
    expect(touched).toEqual(['ground', 'ground'])
  })

  it('entity commands never report tilesTouched (they replace the document instead)', () => {
    const { bus, touched } = createRig(strokeWorld())
    bus.dispatch({ kind: 'place-entity', marker: 'tree', position: { x: 0, y: 0 }, elevation: 0 })
    bus.undo()
    bus.redo()
    expect(touched).toEqual([])
  })
})
