/**
 * The assembled session, proven headless.
 *
 * Every test here runs the REAL factory — real bus, real store, real
 * emitter, real persistence glue — with exactly two fakes at the edges: an
 * in-memory SlotStorage (so boot/save/restore exercise the real two-slot
 * ceremony against a Map) and the pixel-less raster factory pattern from
 * render.test.ts (source: null — no browser, no canvas). No tool is
 * registered unless a test says so: the session's own surface is the thing
 * under proof.
 *
 * Boot is observable only through its residue — the factory boots before
 * any onEvent subscription can exist — so the boot tests read the snapshot
 * the boot left behind: lastAction 'loaded world' is the fingerprint of the
 * world-loaded event having fired through the one event spine.
 */

import type { World } from '@engine/core'
import { Vec2 } from '@engine/math'
import { getCell } from '@engine/tilemap'
import type { RasterFactory } from '@engine/tilemap'
import { parseWorld, serializeWorld } from '@engine/world-format'
import type { SlotStorage } from '@engine/world-format'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BuilderEvent } from '../src/editor/events/builder'
import { createEditorSession, describeEvent } from '../src/editor/session'
import { createStarterWorld } from '../src/editor/starter'
import { createBrushTool, createSelectTool } from '../src/editor/tools'
import type { ToolPointerEvent } from '../src/editor/types'

// --- the two edge fakes -----------------------------------------------------

/** A SlotStorage over a Map — the slot ceremony's keys ('world',
 * 'world.backup', 'world.tmp') land here un-prefixed, so tests can prime
 * and inspect them directly. */
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

/** The pixel-less raster fake (render.test.ts's pattern): source null flips
 * layer renderers onto the per-tile command path — no browser needed. */
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

function makeSession(storage: SlotStorage = memoryStorage()) {
  return createEditorSession({ storage, raster: fakeRaster() })
}

/** A recognizably-different valid world for import/load tests. */
function otherWorld(name = 'imported island'): World {
  const world = createStarterWorld()
  world.meta.name = name
  return world
}

/** Hand-built ToolPointerEvent for driving a registered tool directly
 * (tools.test.ts's pattern): a brush/select-shaped event with defaults. */
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

/**
 * The minimal canvas the viewport actually touches, for attach() tests in
 * node: a MUTABLE rect to measure, listener registration with a `fire`
 * dispatcher, a capture stub, and a getContext stub for the canvas2d
 * backend (whose ctx is only touched at render time — and the rAF stub
 * below never runs a frame).
 */
function fakeCanvas(width = 640, height = 420) {
  const rect = { width, height }
  const handlers = new Map<string, Array<(event: unknown) => void>>()
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: rect.width, height: rect.height }),
    addEventListener(type: string, handler: (event: unknown) => void): void {
      const list = handlers.get(type) ?? []
      list.push(handler)
      handlers.set(type, list)
    },
    removeEventListener(type: string, handler: (event: unknown) => void): void {
      const list = handlers.get(type) ?? []
      const at = list.indexOf(handler)
      if (at >= 0) list.splice(at, 1)
    },
    setPointerCapture(): void {},
    getContext: () => ({}),
  }
  const fire = (type: string, event: Record<string, unknown>): void => {
    for (const handler of [...(handlers.get(type) ?? [])]) handler(event)
  }
  return { canvas: canvas as unknown as HTMLCanvasElement, fire, rect }
}

/** attach() needs an animation-frame API; frames never run (the tests
 * assert state, not pixels), so scheduling is a countable no-op. */
function stubAnimationFrames(): void {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
}

describe('boot', () => {
  it('empty storage boots the starter world, unsaved, brush armed with grass', () => {
    const session = makeSession()
    expect(serializeWorld(session.doc)).toBe(serializeWorld(createStarterWorld()))
    const snap = session.store.getState()
    expect(snap.persistence).toEqual({ state: 'unsaved', message: null })
    expect(snap.activeToolId).toBe('brush')
    expect(snap.activeTile).toBe(1)
    expect(snap.activeLayerId).toBe('ground')
    expect(snap.worldName).toBe('my first world')
    // The boot went through the same path as loadWorld: the world-loaded
    // event fired and the session's own listener announced it.
    expect(snap.lastAction).toBe('loaded world')
  })

  it('a stored world boots as saved', () => {
    const storage = memoryStorage()
    storage.map.set('world', serializeWorld(otherWorld('stored world')))
    const session = makeSession(storage)
    expect(session.doc.meta.name).toBe('stored world')
    expect(session.store.getState().persistence).toEqual({ state: 'saved', message: null })
  })

  it('a corrupt base rescued by the backup boots as restored, with a student message', () => {
    const storage = memoryStorage()
    storage.map.set('world', '{ this is not a world')
    storage.map.set('world.backup', serializeWorld(otherWorld('rescued world')))
    const session = makeSession(storage)
    expect(session.doc.meta.name).toBe('rescued world')
    const { persistence } = session.store.getState()
    expect(persistence.state).toBe('restored')
    expect(persistence.message).toContain('backup')
  })
})

describe('commands through the snapshot', () => {
  it('place → undo → redo updates canUndo/canRedo, lastAction, and the entity list', () => {
    const storage = memoryStorage()
    storage.map.set('world', serializeWorld(createStarterWorld()))
    const session = makeSession(storage) // boots 'saved', so the flip to 'unsaved' is visible

    const placed = session.bus.dispatch({
      kind: 'place-entity',
      marker: 'crate',
      position: { x: 3.5, y: 4.5 },
      elevation: 0,
    })
    expect(placed.ok).toBe(true)
    let snap = session.store.getState()
    expect(snap.canUndo).toBe(true)
    expect(snap.canRedo).toBe(false)
    expect(snap.lastAction).toBe('placed crate')
    expect(snap.persistence.state).toBe('unsaved')
    expect(snap.entities).toEqual([
      { id: 'e1', name: 'player', marker: 'player' },
      { id: 'e2', name: 'crate', marker: 'crate' },
    ])

    session.bus.undo()
    snap = session.store.getState()
    expect(snap.canUndo).toBe(false)
    expect(snap.canRedo).toBe(true)
    expect(snap.lastAction).toBe('undid: place crate')
    expect(snap.entities).toHaveLength(1)

    session.bus.redo()
    snap = session.store.getState()
    expect(snap.canUndo).toBe(true)
    expect(snap.canRedo).toBe(false)
    expect(snap.lastAction).toBe('redid: place crate')
    expect(snap.entities).toHaveLength(2)
  })
})

describe('selection', () => {
  it('dedupes and emits the contract payload shapes', () => {
    const session = makeSession()
    const events: BuilderEvent[] = []
    session.onEvent((event) => {
      if (event.type === 'builder.selection-changed') events.push(event)
    })

    session.select({ kind: 'entity', id: 'e1', point: { x: 16.5, y: 12.5, z: 0 } })
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'builder.selection-changed',
      selection: { kind: 'entity', id: 'e1' },
    })
    const entityInfo = session.store.getState().selection
    expect(entityInfo?.kind).toBe('entity')
    if (entityInfo?.kind === 'entity') expect(entityInfo.name).toBe('player')

    // Reselecting the same entity is silent.
    session.select({ kind: 'entity', id: 'e1', point: { x: 16.5, y: 12.5, z: 0 } })
    expect(events).toHaveLength(1)

    const tile = { layerId: 'ground', tx: 2, ty: 3, elevation: 0 }
    session.select({ kind: 'tile', tile })
    expect(events).toHaveLength(2)
    expect(events[1]).toEqual({
      type: 'builder.selection-changed',
      selection: { kind: 'tile', tx: 2, ty: 3, layerId: 'ground' },
    })
    const tileInfo = session.store.getState().selection
    expect(tileInfo?.kind).toBe('tile')
    if (tileInfo?.kind === 'tile') expect(tileInfo.tileName).toBe('grass')

    // Same cell again: silent.
    session.select({ kind: 'tile', tile: { ...tile } })
    expect(events).toHaveLength(2)

    session.select(null)
    expect(events).toHaveLength(3)
    expect(events[2]).toEqual({ type: 'builder.selection-changed', selection: null })
    expect(session.store.getState().selection).toBeNull()
  })
})

describe('persistence', () => {
  it('save lands the world in storage, flips to saved, and emits world-saved', () => {
    const storage = memoryStorage()
    const session = makeSession(storage)
    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))

    const outcome = session.save()
    expect(outcome).toEqual({ ok: true })
    const stored = storage.map.get('world')
    expect(stored).toBe(serializeWorld(session.doc))
    expect(parseWorld(stored ?? '').ok).toBe(true)
    const snap = session.store.getState()
    expect(snap.persistence).toEqual({ state: 'saved', message: null })
    expect(snap.lastAction).toBe('saved world')
    expect(events.filter((event) => event.type === 'builder.world-saved')).toEqual([
      { type: 'builder.world-saved', worldId: session.doc.meta.worldId },
    ])
  })

  it('a hostile storage fails the save into an error state and leaves the doc alone', () => {
    const hostile: SlotStorage = {
      read: () => null,
      write() {
        throw new Error('quota exceeded')
      },
      remove() {},
    }
    const session = makeSession(hostile)
    const before = serializeWorld(session.doc)
    const outcome = session.save()
    expect(outcome.ok).toBe(false)
    const { persistence, lastAction } = session.store.getState()
    expect(persistence.state).toBe('error')
    expect(persistence.message).toBeTruthy()
    expect(serializeWorld(session.doc)).toBe(before)
    expect(lastAction).toBe('loaded world') // no world-saved was announced
  })

  it('importText refuses garbage with a student-language message, doc untouched', () => {
    const session = makeSession()
    const before = serializeWorld(session.doc)
    const outcome = session.importText('*** definitely not a world file ***')
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.message.length).toBeGreaterThan(0)
    expect(serializeWorld(session.doc)).toBe(before)
  })

  it('importText swaps the doc, clears history, and lands unsaved', () => {
    const session = makeSession()
    session.bus.dispatch({
      kind: 'place-entity',
      marker: 'tree',
      position: { x: 1.5, y: 1.5 },
      elevation: 0,
    })
    expect(session.store.getState().canUndo).toBe(true)

    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))
    const outcome = session.importText(serializeWorld(otherWorld()))
    expect(outcome).toEqual({ ok: true, usedBackup: false })
    expect(session.doc.meta.name).toBe('imported island')
    const snap = session.store.getState()
    expect(snap.canUndo).toBe(false)
    expect(snap.canRedo).toBe(false)
    expect(snap.persistence).toEqual({ state: 'unsaved', message: null })
    expect(events.filter((event) => event.type === 'builder.world-loaded')).toEqual([
      {
        type: 'builder.world-loaded',
        worldId: session.doc.meta.worldId,
        origin: 'import',
        usedBackup: false,
      },
    ])
  })

  it('exportText round-trips through parseWorld to the same bytes', () => {
    const session = makeSession()
    const text = session.exportText()
    expect(text).toBe(serializeWorld(session.doc))
    const parsed = parseWorld(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(serializeWorld(parsed.world)).toBe(text)
  })

  it('restoreBackup without a backup refuses; with one, loads it as restored', () => {
    const storage = memoryStorage()
    const session = makeSession(storage)
    const refused = session.restoreBackup()
    expect(refused.ok).toBe(false)

    storage.map.set('world.backup', serializeWorld(otherWorld('yesterday world')))
    const outcome = session.restoreBackup()
    expect(outcome).toEqual({ ok: true, usedBackup: true })
    expect(session.doc.meta.name).toBe('yesterday world')
    const { persistence } = session.store.getState()
    expect(persistence.state).toBe('restored')
    expect(persistence.message).toContain('backup')
  })
})

describe('loadWorld', () => {
  it('clears selection and cursor, re-emits world-loaded, and sets persistence per origin', () => {
    const session = makeSession()
    session.select({ kind: 'entity', id: 'e1', point: { x: 16.5, y: 12.5, z: 0 } })
    session.moveCursor(0, 0)
    expect(session.store.getState().selection).not.toBeNull()
    expect(session.cursor).not.toBeNull()

    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))
    const next = otherWorld('fresh world')
    session.loadWorld(next, 'new')

    expect(session.store.getState().selection).toBeNull()
    expect(session.cursor).toBeNull()
    expect(session.store.getState().persistence.state).toBe('unsaved')
    expect(events.filter((event) => event.type === 'builder.world-loaded')).toEqual([
      {
        type: 'builder.world-loaded',
        worldId: next.meta.worldId,
        origin: 'new',
        usedBackup: false,
      },
    ])

    session.loadWorld(otherWorld('opened world'), 'load')
    expect(session.store.getState().persistence.state).toBe('saved')
  })
})

describe('the keyboard cell cursor', () => {
  it('summons at the layer center on first use, then clamps to the bounds', () => {
    const session = makeSession()
    expect(session.cursor).toBeNull()

    // First use ignores the delta: the keypress spends itself on appearing.
    session.moveCursor(1, 0)
    expect(session.cursor).toEqual({ tx: 16, ty: 12 }) // 32×24 ground layer's center
    // The fast readout points at the cell's CENTER, in world units.
    expect(session.fast.last).toEqual({
      world: { x: 16.5, y: 12.5 },
      tile: { tx: 16, ty: 12 },
      zoom: 1,
    })

    session.moveCursor(-100, -100)
    expect(session.cursor).toEqual({ tx: 0, ty: 0 })
    session.moveCursor(5, 1000)
    expect(session.cursor).toEqual({ tx: 5, ty: 23 })
  })
})

describe('setActive* validation', () => {
  it('rejects unknown layers, out-of-palette tiles, and unknown markers', () => {
    const session = makeSession()
    expect(() => session.setActiveLayer('no-such-layer')).toThrow()
    expect(() => session.setActiveTile(99)).toThrow()
    expect(() => session.setActiveTile(-1)).toThrow()
    expect(() => session.setActiveTile(1.5)).toThrow()
    expect(() => session.setActiveMarker('dragon')).toThrow()

    // The valid range: 0 (eraser) through the tileset's five tiles.
    session.setActiveTile(0)
    expect(session.store.getState().activeTile).toBe(0)
    session.setActiveTile(5)
    expect(session.store.getState().activeTile).toBe(5)
    session.setActiveMarker('crate')
    expect(session.store.getState().activeMarker).toBe('crate')
    session.setActiveLayer('ground')
    expect(session.store.getState().activeLayerId).toBe('ground')
  })
})

describe('dispose', () => {
  it('is idempotent and drops every event listener', () => {
    const session = makeSession()
    let heard = 0
    session.onEvent(() => {
      heard += 1
    })
    session.dispose()
    session.dispose() // second call: a quiet no-op

    // The spine is severed: neither the caller's listener nor the session's
    // own (which would have updated lastAction) hears anything now.
    const before = session.store.getState().lastAction
    session.bus.dispatch({
      kind: 'place-entity',
      marker: 'crate',
      position: { x: 1.5, y: 1.5 },
      elevation: 0,
    })
    expect(heard).toBe(0)
    expect(session.store.getState().lastAction).toBe(before)
  })
})

describe('describeEvent (the announcement table)', () => {
  it('pins the strings the aria-live region reads', () => {
    const doc = createStarterWorld()
    expect(
      describeEvent(
        {
          type: 'builder.tile-painted',
          layerId: 'ground',
          tile: 2,
          cells: [
            { tx: 1, ty: 1 },
            { tx: 2, ty: 1 },
          ],
          toolId: 'brush',
        },
        doc,
      ),
    ).toBe('painted 2 tiles')
    expect(
      describeEvent(
        { type: 'builder.tile-painted', layerId: 'ground', tile: 0, cells: [{ tx: 1, ty: 1 }], toolId: 'brush' },
        doc,
      ),
    ).toBe('erased 1 tile')
    expect(
      describeEvent(
        {
          type: 'builder.entity-moved',
          id: 'e1',
          from: { x: 16.5, y: 12.5, z: 0 },
          to: { x: 3, y: 2, z: 0 },
        },
        doc,
      ),
    ).toBe('moved player')
    expect(describeEvent({ type: 'builder.world-renamed', from: 'a', to: 'island' }, doc)).toBe(
      "renamed world to 'island'",
    )
    expect(describeEvent({ type: 'builder.command-undone', label: 'place crate' }, doc)).toBe(
      'undid: place crate',
    )
    // Selection changes are navigation, not work: no announcement.
    expect(
      describeEvent({ type: 'builder.selection-changed', selection: null }, doc),
    ).toBeNull()
  })
})

describe('lastActionSeq', () => {
  it('bumps with every announcement — identical labels included — and never on navigation', () => {
    const session = makeSession()
    const booted = session.store.getState()
    // Boot's world-loaded was announcement #1.
    expect(booted.lastAction).toBe('loaded world')
    expect(booted.lastActionSeq).toBe(1)

    session.bus.dispatch({ kind: 'place-entity', marker: 'crate', position: { x: 1.5, y: 1.5 }, elevation: 0 })
    expect(session.store.getState().lastAction).toBe('placed crate')
    expect(session.store.getState().lastActionSeq).toBe(2)

    // The SAME label again: the string cannot tell the announcer anything
    // changed — the sequence number is the whole point.
    session.bus.dispatch({ kind: 'place-entity', marker: 'crate', position: { x: 2.5, y: 1.5 }, elevation: 0 })
    expect(session.store.getState().lastAction).toBe('placed crate')
    expect(session.store.getState().lastActionSeq).toBe(3)

    // Selection changes announce nothing, so the counter holds still.
    session.select({ kind: 'tile', tile: { layerId: 'ground', tx: 1, ty: 1, elevation: 0 } })
    expect(session.store.getState().lastActionSeq).toBe(3)
  })
})

describe('save settles the live gesture', () => {
  it('a half-painted stroke commits into the save: bytes, one entry, one event', () => {
    const storage = memoryStorage()
    const session = makeSession(storage)
    const brush = createBrushTool(session)
    session.addTool(brush) // 'brush' is the boot-default active tool
    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))
    session.setActiveTile(4) // stone: changes every starter cell it touches

    // A stroke mid-gesture: down, one drag, NO pointerup before save.
    brush.onPointerDown(ev({ tile: { tx: 2, ty: 2 }, world: { x: 2.5, y: 2.5, z: 0 } }))
    brush.onPointerMove(ev({ tile: { tx: 3, ty: 2 }, world: { x: 3.5, y: 2.5, z: 0 } }))

    const outcome = session.save()
    expect(outcome).toEqual({ ok: true })

    // The saved bytes CONTAIN the painted cells, as committed state.
    const stored = parseWorld(storage.map.get('world') ?? '')
    expect(stored.ok).toBe(true)
    if (stored.ok) {
      const layer = stored.world.layers[0]
      if (layer === undefined) throw new Error('saved world lost its ground layer')
      expect(getCell(layer, 2, 2)).toBe(4)
      expect(getCell(layer, 3, 2)).toBe(4)
    }

    // The settle was a NORMAL commit: one history entry, one tile-painted.
    expect(session.store.getState().canUndo).toBe(true)
    expect(events.filter((event) => event.type === 'builder.tile-painted')).toHaveLength(1)
    // And the save still won: the settle's 'unsaved' flip happened BEFORE
    // saveDoc ran, so the session honestly reports 'saved'.
    expect(session.store.getState().persistence.state).toBe('saved')

    // The stroke is closed: Esc afterwards has nothing to revert.
    const savedBytes = serializeWorld(session.doc)
    session.cancelGesture()
    expect(serializeWorld(session.doc)).toBe(savedBytes)
  })

  it('a live select drag commits into the save instead of being thrown away', () => {
    const storage = memoryStorage()
    const session = makeSession(storage)
    const select = createSelectTool(session)
    session.addTool(select)
    session.setActiveTool('select')
    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))

    // Press the starter player and drag past the threshold — mid-air now.
    select.onPointerDown(ev({ screen: session.stack.worldToScreen({ x: 16.5, y: 12.5, z: 0 }) }))
    select.onPointerMove(ev({ screen: session.stack.worldToScreen({ x: 20.2, y: 12.3, z: 0 }) }))
    expect(session.preview.entityOverride).not.toBeNull()

    expect(session.save()).toEqual({ ok: true })

    // The drag settled as its commit: snapped center, override gone, one
    // move in history and one entity-moved on the spine.
    expect(session.preview.entityOverride).toBeNull()
    expect(session.doc.entities['e1']?.components['position']).toEqual({ x: 20.5, y: 12.5 })
    expect(events.filter((event) => event.type === 'builder.entity-moved')).toHaveLength(1)
    expect(session.store.getState().canUndo).toBe(true)
    // And the saved bytes carry the moved player.
    const stored = parseWorld(storage.map.get('world') ?? '')
    expect(stored.ok).toBe(true)
    if (stored.ok) {
      expect(stored.world.entities['e1']?.components['position']).toEqual({ x: 20.5, y: 12.5 })
    }
  })
})

describe('the zoom readout (fast channel) stays fresh', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('wheel zoom: deltaY −1 → ×1.25, 0 → ignored, +1 → ×0.8', () => {
    stubAnimationFrames()
    const session = makeSession()
    const { canvas, fire } = fakeCanvas()
    const detach = session.attach(canvas)
    // The deferred boot fit landed at attach and republished: zoom 1, and
    // honestly no pointer coordinates yet.
    expect(session.fast.last).toEqual({ world: null, tile: null, zoom: 1 })

    fire('wheel', { deltaY: -1, clientX: 320, clientY: 210, preventDefault(): void {} })
    expect(session.fast.last?.zoom).toBeCloseTo(1.25, 12)

    // deltaY 0 is "no scroll" (trackpad momentum end, pure-horizontal
    // gestures) — it must not zoom out.
    fire('wheel', { deltaY: 0, clientX: 320, clientY: 210, preventDefault(): void {} })
    expect(session.fast.last?.zoom).toBeCloseTo(1.25, 12)

    fire('wheel', { deltaY: 1, clientX: 320, clientY: 210, preventDefault(): void {} })
    expect(session.fast.last?.zoom).toBeCloseTo(1, 12) // 1.25 × 0.8
    detach()
  })

  it('loadWorld republishes the readout with the FRESH camera zoom', () => {
    stubAnimationFrames()
    const session = makeSession()
    // Even headless (no viewport), boot published an honest readout.
    expect(session.fast.last).toEqual({ world: null, tile: null, zoom: 1 })

    const { canvas, fire } = fakeCanvas()
    const detach = session.attach(canvas)
    fire('wheel', { deltaY: -1, clientX: 320, clientY: 210, preventDefault(): void {} })
    expect(session.fast.last?.zoom).toBeCloseTo(1.25, 12)

    // The new world arrives, the camera rebuilds and refits: the readout
    // must say so instead of showing the OLD world's 1.25.
    session.loadWorld(otherWorld('fresh world'), 'new')
    expect(session.fast.last).toEqual({ world: null, tile: null, zoom: 1 })
    detach()
  })

  it('a deferred fit landing on resize republishes the readout', () => {
    stubAnimationFrames()
    // A capturing ResizeObserver stub: the viewport registers its callback,
    // the test plays layout by triggering it.
    const observers: Array<() => void> = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly callback: () => void
        constructor(callback: () => void) {
          this.callback = callback
          observers.push(() => {
            this.callback()
          })
        }
        observe(): void {}
        disconnect(): void {}
      },
    )

    const session = makeSession()
    const { canvas, rect } = fakeCanvas(0, 0) // not laid out yet: the fit defers
    const detach = session.attach(canvas)

    // Zoom while unfitted (identity camera: fitScale 1) so the eventual fit
    // has something visible to reset.
    session.zoomBy(2)
    expect(session.fast.last?.zoom).toBeCloseTo(2, 12)

    // Layout arrives: the observer fires, the deferred fit lands, and the
    // readout returns to the fitted 1 — not a stale 2.
    rect.width = 640
    rect.height = 420
    for (const trigger of observers) trigger()
    expect(session.fast.last?.zoom).toBeCloseTo(1, 12)
    detach()
  })
})
