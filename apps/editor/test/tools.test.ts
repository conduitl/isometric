/**
 * The three built-in tools, driven headless.
 *
 * No DOM: tools are exercised through the session's public surface plus
 * DIRECT handler calls with hand-built ToolPointerEvents. That split is
 * honest because the enrichment (screen → world/tile) is pointerToCell's
 * contract, already proven in its own tests — what a TOOL owes is what it
 * does with an already-enriched event, and that is what these tests pin.
 *
 * The select tool is the one exception to "screen is decoration": its down
 * handler runs the real resolvePick walk, so its events carry REAL screen
 * points computed through the session's own stack (identity camera before
 * any fit, top-down scale 1 — one world unit is one CSS pixel, which keeps
 * the 3 px drag threshold arithmetic legible in the assertions).
 */

import { Mat3, Vec2 } from '@engine/math'
import { createTileLayer, getCell } from '@engine/tilemap'
import type { RasterFactory } from '@engine/tilemap'
import { serializeWorld } from '@engine/world-format'
import type { SlotStorage } from '@engine/world-format'
import { describe, expect, it } from 'vitest'
import type { BuilderEvent } from '../src/editor/events/builder'
import { createEditorSession } from '../src/editor/session'
import { createStarterWorld } from '../src/editor/starter'
import { createBrushTool, createPlacerTool, createSelectTool } from '../src/editor/tools'
import type { EditorSession, ToolPointerEvent } from '../src/editor/types'

// --- rig --------------------------------------------------------------------

function memoryStorage(): SlotStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    read: (key) => map.get(key) ?? null,
    write(key, value) {
      map.set(key, value)
    },
    remove(key) {
      map.delete(key)
    },
  }
}

function fakeRaster(): RasterFactory {
  return (width, height) => ({
    width,
    height,
    source: null,
    clear(): void {},
    fillRect(): void {},
    fillPoly(): void {},
  })
}

/** A session with the three tool INSTANCES registered directly (addTool),
 * so tests hold the same objects the session routes to — a plugin-installed
 * tool would be unreachable from out here. */
function rig(storage: SlotStorage = memoryStorage()) {
  const session = createEditorSession({ storage, raster: fakeRaster() })
  const select = createSelectTool(session)
  const brush = createBrushTool(session)
  const placer = createPlacerTool(session)
  session.addTool(select)
  session.addTool(brush)
  session.addTool(placer)
  const events: BuilderEvent[] = []
  session.onEvent((event) => events.push(event))
  return { session, select, brush, placer, events }
}

/** Hand-built ToolPointerEvent with quiet defaults. */
function ev(partial: Partial<ToolPointerEvent>): ToolPointerEvent {
  return {
    screen: Vec2.make(0, 0),
    world: null,
    tile: null,
    primary: true,
    shiftKey: false,
    ...partial,
  }
}

/** A brush/placer-shaped event at a cell of the ground layer (tileSize 1). */
function atCell(tx: number, ty: number, extra: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return ev({ tile: { tx, ty }, world: { x: tx + 0.5, y: ty + 0.5, z: 0 }, ...extra })
}

/** A select-shaped event: a REAL screen point for a world position. */
function atWorld(
  session: EditorSession,
  x: number,
  y: number,
  extra: Partial<ToolPointerEvent> = {},
): ToolPointerEvent {
  return ev({ screen: session.stack.worldToScreen({ x, y, z: 0 }), ...extra })
}

const painted = (events: BuilderEvent[]) =>
  events.filter((event) => event.type === 'builder.tile-painted')
const moved = (events: BuilderEvent[]) =>
  events.filter((event) => event.type === 'builder.entity-moved')

// --- brush ------------------------------------------------------------------

describe('the tile brush', () => {
  it('a diagonal drag leaves ONE history entry with gap-free cells', () => {
    const { session, brush, events } = rig()
    session.setActiveTile(4) // stone: changes every cell it crosses
    const baseline = serializeWorld(session.doc)

    brush.onPointerDown(atCell(2, 2))
    brush.onPointerMove(atCell(7, 5)) // one fast jump — the segment must fill in
    brush.onPointerUp(ev({ primary: false })) // ANY up ends the gesture

    const strokes = painted(events)
    expect(strokes).toHaveLength(1)
    const stroke = strokes[0]
    if (stroke?.type !== 'builder.tile-painted') throw new Error('unreachable')
    expect(stroke.tile).toBe(4)
    expect(stroke.cells[0]).toEqual({ tx: 2, ty: 2 })
    expect(stroke.cells[stroke.cells.length - 1]).toEqual({ tx: 7, ty: 5 })
    // Gap-free: consecutive cells differ by at most one step on each axis.
    for (let i = 1; i < stroke.cells.length; i += 1) {
      const a = stroke.cells[i - 1]
      const b = stroke.cells[i]
      if (a === undefined || b === undefined) throw new Error('unreachable')
      expect(Math.abs(b.tx - a.tx)).toBeLessThanOrEqual(1)
      expect(Math.abs(b.ty - a.ty)).toBeLessThanOrEqual(1)
    }

    // ONE entry: a single undo reverts the whole gesture, byte-exactly.
    expect(session.store.getState().canUndo).toBe(true)
    session.bus.undo()
    expect(session.store.getState().canUndo).toBe(false)
    expect(serializeWorld(session.doc)).toBe(baseline)
  })

  it('a mid-stroke tool switch cancels: cells revert, no history, no event', () => {
    const { session, brush, events } = rig()
    session.setActiveTile(4)
    const baseline = serializeWorld(session.doc)

    brush.onPointerDown(atCell(1, 1))
    brush.onPointerMove(atCell(3, 3))
    expect(serializeWorld(session.doc)).not.toBe(baseline) // paints live

    // The session cancels the OUTGOING tool's gesture on switch — and the
    // outgoing tool is this very instance ('brush' is the boot default).
    session.setActiveTool('select')

    expect(serializeWorld(session.doc)).toBe(baseline)
    expect(painted(events)).toHaveLength(0)
    expect(session.store.getState().canUndo).toBe(false)
  })

  it('keyboard onCursorAct leaves the identical history/event shape as a click', () => {
    const clicked = rig()
    clicked.session.setActiveTile(4)
    clicked.brush.onPointerDown(atCell(3, 3))
    clicked.brush.onPointerUp(ev({}))

    const keyed = rig()
    keyed.session.setActiveTile(4)
    keyed.brush.onCursorAct({ tx: 3, ty: 3 })

    expect(painted(keyed.events)).toEqual(painted(clicked.events))
    expect(painted(keyed.events)).toEqual([
      {
        type: 'builder.tile-painted',
        layerId: 'ground',
        tile: 4,
        cells: [{ tx: 3, ty: 3 }],
        toolId: 'brush',
      },
    ])
    expect(keyed.session.store.getState().lastAction).toBe('painted 1 tile')
    expect(keyed.session.store.getState().canUndo).toBe(true)
  })

  it('activeTile 0 erases', () => {
    const { session, brush, events } = rig()
    session.setActiveTile(0)
    const layer = session.doc.layers[0]
    if (layer === undefined) throw new Error('starter world lost its ground layer')
    expect(getCell(layer, 6, 5)).toBeGreaterThan(0) // pond water

    brush.onCursorAct({ tx: 6, ty: 5 })
    expect(getCell(layer, 6, 5)).toBe(0)
    expect(painted(events)).toEqual([
      { type: 'builder.tile-painted', layerId: 'ground', tile: 0, cells: [{ tx: 6, ty: 5 }], toolId: 'brush' },
    ])
    expect(session.store.getState().lastAction).toBe('erased 1 tile')
  })

  it('a second concurrent pointerdown mid-stroke is ignored; the first gesture completes', () => {
    const { session, brush, events } = rig()
    session.setActiveTile(4)

    brush.onPointerDown(atCell(2, 2))
    // The second finger: without the guard this would beginTileStroke again
    // and the bus would rightly throw on the open gesture.
    expect(() => brush.onPointerDown(atCell(10, 10))).not.toThrow()
    // The first gesture is still live and completes normally.
    brush.onPointerMove(atCell(3, 2))
    brush.onPointerUp(ev({}))

    const strokes = painted(events)
    expect(strokes).toHaveLength(1)
    const stroke = strokes[0]
    if (stroke?.type !== 'builder.tile-painted') throw new Error('unreachable')
    const has = (tx: number, ty: number) =>
      stroke.cells.some((cell) => cell.tx === tx && cell.ty === ty)
    expect(has(2, 2)).toBe(true)
    expect(has(3, 2)).toBe(true)
    expect(has(10, 10)).toBe(false) // the ignored down painted nothing
    expect(session.store.getState().canUndo).toBe(true)
  })

  it('setActiveLayer mid-stroke cancels the gesture: cells revert, no history', () => {
    // A two-layer world: the stroke opens on 'ground', then the storey
    // switches out from under it.
    const storage = memoryStorage()
    const world = createStarterWorld()
    world.layers.push(
      createTileLayer({ id: 'upper', width: 8, height: 6, elevation: 1, layerBand: 1, tilesetId: 'terrain' }),
    )
    storage.map.set('world', serializeWorld(world))
    const { session, brush, events } = rig(storage)
    session.setActiveTile(4)
    const baseline = serializeWorld(session.doc)

    brush.onPointerDown(atCell(2, 2))
    brush.onPointerMove(atCell(4, 2))
    expect(serializeWorld(session.doc)).not.toBe(baseline) // paints live

    session.setActiveLayer('upper') // 'brush' is the boot-default active tool

    expect(serializeWorld(session.doc)).toBe(baseline) // every cell reverted
    expect(painted(events)).toHaveLength(0)
    expect(session.store.getState().canUndo).toBe(false)
    expect(session.store.getState().activeLayerId).toBe('upper')
  })

  it('re-selecting the SAME layer is a no-op and leaves a live stroke alone', () => {
    const { session, brush, events } = rig()
    session.setActiveTile(4)

    brush.onPointerDown(atCell(2, 2))
    session.setActiveLayer('ground') // already active: early-return, no cancel
    brush.onPointerMove(atCell(3, 2))
    brush.onPointerUp(ev({}))

    expect(painted(events)).toHaveLength(1) // one uninterrupted gesture
    expect(session.store.getState().canUndo).toBe(true)
  })

  it('leaving the layer mid-drag keeps the stroke alive as one gesture', () => {
    const { session, brush, events } = rig()
    session.setActiveTile(4)

    brush.onPointerDown(atCell(1, 1))
    // Off the map: the enriched tile is null, the world point keeps going.
    brush.onPointerMove(ev({ world: { x: -2.5, y: 1.5, z: 0 } }))
    // Back in bounds: still the same stroke.
    brush.onPointerMove(atCell(2, 1))
    brush.onPointerUp(ev({}))

    const strokes = painted(events)
    expect(strokes).toHaveLength(1) // one gesture, one entry
    const stroke = strokes[0]
    if (stroke?.type !== 'builder.tile-painted') throw new Error('unreachable')
    // In-bounds cells painted on both sides of the excursion; the off-map
    // cells were refused by the stroke and appear nowhere.
    const has = (tx: number, ty: number) =>
      stroke.cells.some((cell) => cell.tx === tx && cell.ty === ty)
    expect(has(1, 1)).toBe(true)
    expect(has(2, 1)).toBe(true)
    expect(stroke.cells.every((cell) => cell.tx >= 0)).toBe(true)
  })
})

// --- placer -----------------------------------------------------------------

describe('the entity placer', () => {
  it('places the active marker at the cell center and selects it', () => {
    const { session, placer, events } = rig()
    session.setActiveMarker('crate')

    placer.onPointerDown(atCell(4, 5, { world: { x: 4.2, y: 5.7, z: 0 } }))

    const crate = session.doc.entities['e2']
    expect(crate).toBeDefined()
    expect(crate?.components['position']).toEqual({ x: 4.5, y: 5.5 }) // center, not the click
    expect(crate?.components['elevation']).toEqual({ z: 0 })
    expect(crate?.components['marker']).toEqual({ kind: 'crate' })
    const selected = session.store.getState().selection
    expect(selected?.kind).toBe('entity')
    if (selected?.kind === 'entity') expect(selected.id).toBe('e2')
    expect(
      events.filter((event) => event.type === 'builder.entity-placed'),
    ).toEqual([
      {
        type: 'builder.entity-placed',
        id: 'e2',
        marker: 'crate',
        name: 'crate',
        position: { x: 4.5, y: 5.5 },
        elevation: 0,
      },
    ])
  })

  it('shift places at the exact world point instead of the center', () => {
    const { session, placer } = rig()
    placer.onPointerDown(atCell(9, 3, { world: { x: 9.25, y: 3.75, z: 0 }, shiftKey: true }))
    expect(session.doc.entities['e2']?.components['position']).toEqual({ x: 9.25, y: 3.75 })
  })

  it('onCursorAct places at the cell center, and takes the layer elevation', () => {
    // A world whose ground layer sits at z = 2: the placement must adopt it.
    const storage = memoryStorage()
    const raised = createStarterWorld()
    const ground = raised.layers[0]
    if (ground === undefined) throw new Error('starter world lost its ground layer')
    ground.elevation = 2
    storage.map.set('world', serializeWorld(raised))
    const { session, placer } = rig(storage)

    placer.onCursorAct({ tx: 1, ty: 2 })
    const placedEntity = session.doc.entities['e2']
    expect(placedEntity?.components['position']).toEqual({ x: 1.5, y: 2.5 })
    expect(placedEntity?.components['elevation']).toEqual({ z: 2 })
  })

  it('a click outside the layer places nothing', () => {
    const { session, placer } = rig()
    const before = Object.keys(session.doc.entities).length
    placer.onPointerDown(ev({ world: { x: -3, y: -3, z: 0 } })) // tile: null
    expect(Object.keys(session.doc.entities)).toHaveLength(before)
  })
})

// --- select -----------------------------------------------------------------

describe('the selection tool', () => {
  it('picks the entity under the pointer on down', () => {
    const { session, select } = rig()
    select.onPointerDown(atWorld(session, 16.5, 12.5)) // the starter player's spot: cell (16,12)'s center
    const selected = session.store.getState().selection
    expect(selected?.kind).toBe('entity')
    if (selected?.kind === 'entity') expect(selected.id).toBe('e1')
  })

  it('drags past the threshold via the preview, snapping to cell centers, and commits on ANY up', () => {
    const { session, select, events } = rig()
    select.onPointerDown(atWorld(session, 16.5, 12.5))
    // 4.2+ px of travel (scale 1): past the 3 px threshold — the drag begins
    // and the ghost snaps to the landing cell's center.
    select.onPointerMove(atWorld(session, 20.2, 12.3))
    expect(session.preview.entityOverride).toEqual({
      id: 'e1',
      point: { x: 20.5, y: 12.5, z: 0 },
    })

    // The lostpointercapture case: 'up' arrives with primary false and must
    // still commit the gesture.
    select.onPointerUp(atWorld(session, 20.2, 12.3, { primary: false }))
    expect(session.preview.entityOverride).toBeNull()
    expect(session.doc.entities['e1']?.components['position']).toEqual({ x: 20.5, y: 12.5 })
    expect(moved(events)).toEqual([
      {
        type: 'builder.entity-moved',
        id: 'e1',
        from: { x: 16.5, y: 12.5, z: 0 },
        to: { x: 20.5, y: 12.5, z: 0 },
      },
    ])
    expect(session.store.getState().canUndo).toBe(true)
  })

  it('shift drags position freely — no snapping', () => {
    const { session, select } = rig()
    select.onPointerDown(atWorld(session, 16.5, 12.5))
    // hypot(3.25, 1) ≈ 3.4 px: past the threshold, and nowhere near a center.
    select.onPointerMove(atWorld(session, 19.75, 13.5, { shiftKey: true }))
    expect(session.preview.entityOverride?.point).toEqual({ x: 19.75, y: 13.5, z: 0 })
    select.onPointerUp(ev({ primary: false }))
    expect(session.doc.entities['e1']?.components['position']).toEqual({ x: 19.75, y: 13.5 })
  })

  it('a sub-threshold click never dispatches a move', () => {
    const { session, select, events } = rig()
    select.onPointerDown(atWorld(session, 16.5, 12.5))
    select.onPointerMove(atWorld(session, 18.5, 12.5)) // 2 px: inside the threshold
    expect(session.preview.entityOverride).toBeNull() // no drag ever began
    select.onPointerUp(atWorld(session, 18.5, 12.5))
    expect(moved(events)).toHaveLength(0)
    expect(session.store.getState().canUndo).toBe(false)
    expect(session.doc.entities['e1']?.components['position']).toEqual({ x: 16.5, y: 12.5 })
  })

  it('Esc cancels a live drag: the entity snaps back, nothing committed', () => {
    const { session, select, events } = rig()
    session.setActiveTool('select') // so cancelGesture routes here
    select.onPointerDown(atWorld(session, 16.5, 12.5))
    select.onPointerMove(atWorld(session, 20.5, 12.5))
    expect(session.preview.entityOverride).not.toBeNull()

    session.cancelGesture()
    expect(session.preview.entityOverride).toBeNull()
    select.onPointerUp(ev({})) // the late up is inert
    expect(moved(events)).toHaveLength(0)
    expect(session.store.getState().canUndo).toBe(false)
    expect(session.doc.entities['e1']?.components['position']).toEqual({ x: 16.5, y: 12.5 })
  })

  it('picks a tile when no entity is near, and null when the pick fails outright', () => {
    const { session, select } = rig()
    select.onPointerDown(atWorld(session, 2.5, 2.5)) // grass, far from the player
    const tileSel = session.store.getState().selection
    expect(tileSel?.kind).toBe('tile')
    if (tileSel?.kind === 'tile') {
      expect(tileSel.tile).toEqual({ layerId: 'ground', tx: 2, ty: 2, elevation: 0 })
      expect(tileSel.tileName).toBe('grass')
    }

    // A camera collapsed to nothing cannot be inverted: the pick honestly
    // answers null, and the selection clears.
    session.stack.setCamera(Mat3.scaling(0, 0))
    select.onPointerDown(ev({ screen: Vec2.make(10, 10) }))
    expect(session.store.getState().selection).toBeNull()
  })

  it('onCursorAct: an entity standing in the cell beats the tile under it', () => {
    const { session, select } = rig()
    select.onCursorAct({ tx: 16, ty: 12 }) // the player's cell
    const entitySel = session.store.getState().selection
    expect(entitySel?.kind).toBe('entity')
    if (entitySel?.kind === 'entity') expect(entitySel.id).toBe('e1')

    select.onCursorAct({ tx: 1, ty: 1 }) // nobody stands here: the tile wins
    const tileSel = session.store.getState().selection
    expect(tileSel?.kind).toBe('tile')
    if (tileSel?.kind === 'tile') {
      expect(tileSel.tile).toEqual({ layerId: 'ground', tx: 1, ty: 1, elevation: 0 })
    }
  })

  it('a second concurrent pointerdown mid-drag is ignored; the first drag completes', () => {
    const { session, select, events } = rig()
    select.onPointerDown(atWorld(session, 16.5, 12.5))
    select.onPointerMove(atWorld(session, 20.2, 12.5)) // past the threshold: drag live
    expect(session.preview.entityOverride).not.toBeNull()

    // The second finger lands on empty grass: without the guard it would
    // cancel the live drag and steal the selection.
    expect(() => select.onPointerDown(atWorld(session, 2.5, 2.5))).not.toThrow()
    expect(session.preview.entityOverride).not.toBeNull() // drag survived
    const stillEntity = session.store.getState().selection
    expect(stillEntity?.kind).toBe('entity') // selection did not jump to the tile

    select.onPointerUp(ev({ primary: false }))
    expect(moved(events)).toHaveLength(1) // the FIRST gesture committed, once
    expect(session.doc.entities['e1']?.components['position']).toEqual({ x: 20.5, y: 12.5 })
  })
})

// --- keyboard grab (the lesson keyboard twin of a pointer drag) -------------

describe('the select tool keyboard grab', () => {
  it('grab, carry with the cursor, drop: exactly one command and one event', () => {
    const { session, select, events } = rig()
    session.setActiveTool('select')

    // Acting on the player's cell while it is NOT selected selects it — the
    // pick ladder, never a grab.
    select.onCursorAct({ tx: 16, ty: 12 })
    expect(session.preview.entityOverride).toBeNull()

    // Acting AGAIN on the now-selected entity's cell GRABS it: the preview
    // drag opens at the committed position.
    select.onCursorAct({ tx: 16, ty: 12 })
    expect(session.preview.entityOverride).toEqual({ id: 'e1', point: { x: 16.5, y: 12.5, z: 0 } })

    // Carry: every cursor move shows the ghost on the visited cell's CENTER.
    select.onCursorMove?.({ tx: 17, ty: 12 })
    expect(session.preview.entityOverride?.point).toEqual({ x: 17.5, y: 12.5, z: 0 })
    select.onCursorMove?.({ tx: 18, ty: 13 })
    expect(session.preview.entityOverride?.point).toEqual({ x: 18.5, y: 13.5, z: 0 })

    // While carrying, the ledgers stay untouched — the carry is an opinion.
    expect(moved(events)).toHaveLength(0)
    expect(session.store.getState().canUndo).toBe(false)

    // Drop: one move-entity, one entity-moved, exact from/to.
    select.onCursorAct({ tx: 18, ty: 13 })
    expect(session.preview.entityOverride).toBeNull()
    expect(moved(events)).toEqual([
      {
        type: 'builder.entity-moved',
        id: 'e1',
        from: { x: 16.5, y: 12.5, z: 0 },
        to: { x: 18.5, y: 13.5, z: 0 },
      },
    ])
    expect(session.store.getState().canUndo).toBe(true)
  })

  it('the whole gesture works through the session surface (moveCursor routes onCursorMove)', () => {
    const { session, events } = rig()
    session.setActiveTool('select')

    // The cursor summons at the layer center — which IS the player's cell.
    session.moveCursor(0, 0)
    expect(session.cursor).toEqual({ tx: 16, ty: 12 })
    session.actAtCursor() // select the player
    session.actAtCursor() // grab it
    expect(session.preview.entityOverride).not.toBeNull()

    session.moveCursor(1, 0) // carry: the session routes the move to the tool
    expect(session.preview.entityOverride?.point).toEqual({ x: 17.5, y: 12.5, z: 0 })

    session.actAtCursor() // drop
    expect(session.preview.entityOverride).toBeNull()
    expect(moved(events)).toEqual([
      {
        type: 'builder.entity-moved',
        id: 'e1',
        from: { x: 16.5, y: 12.5, z: 0 },
        to: { x: 17.5, y: 12.5, z: 0 },
      },
    ])
    expect(session.doc.entities['e1']?.components['position']).toEqual({ x: 17.5, y: 12.5 })
  })

  it('Esc mid-carry cancels: the entity snaps back, nothing committed', () => {
    const { session, select, events } = rig()
    session.setActiveTool('select') // so cancelGesture routes here

    select.onCursorAct({ tx: 16, ty: 12 }) // select
    select.onCursorAct({ tx: 16, ty: 12 }) // grab
    select.onCursorMove?.({ tx: 20, ty: 12 })
    expect(session.preview.entityOverride).not.toBeNull()

    session.cancelGesture()
    expect(session.preview.entityOverride).toBeNull()
    expect(moved(events)).toHaveLength(0)
    expect(session.store.getState().canUndo).toBe(false)
    expect(session.doc.entities['e1']?.components['position']).toEqual({ x: 16.5, y: 12.5 })

    // The grab is fully retired: acting at the old cell selects (already
    // selected: silently) rather than dropping a ghost.
    select.onCursorMove?.({ tx: 5, ty: 5 })
    expect(session.preview.entityOverride).toBeNull()
  })

  it("acting on a NON-selected entity's cell selects it instead of grabbing", () => {
    const { session, select } = rig()
    session.setActiveTool('select')
    // A crate standing on cell (4, 5)'s center.
    session.bus.dispatch({
      kind: 'place-entity',
      marker: 'crate',
      position: { x: 4.5, y: 5.5 },
      elevation: 0,
    })

    select.onCursorAct({ tx: 16, ty: 12 }) // select the player
    select.onCursorAct({ tx: 4, ty: 5 }) // the crate's cell: select, don't grab
    const selected = session.store.getState().selection
    expect(selected?.kind).toBe('entity')
    if (selected?.kind === 'entity') expect(selected.id).toBe('e2')
    expect(session.preview.entityOverride).toBeNull()
  })
})
