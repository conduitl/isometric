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
import { WHEEL_MAX_NOTCHES, WHEEL_ZOOM_PER_NOTCH, wheelZoomFactor } from '../src/editor/camera'
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

describe("fixture worlds (origin 'fixture')", () => {
  const REFUSAL =
    'This is a lesson world you are visiting — your own world is parked and safe. ' +
    'Head back to it before saving.'

  it('raises fixtureActive and tells the parked-world story — through edits too', () => {
    const session = makeSession()
    expect(session.fixtureActive).toBe(false)

    session.loadWorld(otherWorld('lesson stage'), 'fixture')
    expect(session.fixtureActive).toBe(true)
    expect(session.store.getState().persistence).toEqual({
      state: 'unsaved',
      message: 'lesson world — your own world is parked and safe',
    })

    // Editing the fixture keeps the message up: the status bar's story
    // while a fixture is live is "your world is parked", never silence.
    session.bus.dispatch({ kind: 'place-entity', marker: 'crate', position: { x: 2.5, y: 2.5 }, elevation: 0 })
    expect(session.store.getState().persistence).toEqual({
      state: 'unsaved',
      message: 'lesson world — your own world is parked and safe',
    })
  })

  it('save refuses with zero storage calls and zero document side effects', () => {
    // A hostile SlotStorage that records every call: the refusal is only
    // proven if this ledger stays EMPTY (write would also throw — but it
    // must never even be reached).
    const calls: string[] = []
    const hostile: SlotStorage = {
      read: () => null, // boot finds empty storage (reads are not the hazard)
      write(key) {
        calls.push(`write:${key}`)
        throw new Error('save() must never touch storage while a fixture is live')
      },
      remove(key) {
        calls.push(`remove:${key}`)
      },
    }
    const session = makeSession(hostile)
    const brush = createBrushTool(session)
    session.addTool(brush) // 'brush' is the boot-default active tool
    session.loadWorld(otherWorld('lesson stage'), 'fixture')
    session.setActiveTile(4) // stone: really changes the grass it touches

    // Open a LIVE stroke: a refusing save must not settle (commit) it.
    brush.onPointerDown(ev({ tile: { tx: 1, ty: 1 }, world: { x: 1.5, y: 1.5, z: 0 } }))
    const bytesBefore = serializeWorld(session.doc)
    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))

    const outcome = session.save()
    expect(outcome).toEqual({ ok: false, message: REFUSAL })
    expect(calls).toEqual([]) // the ledger: not one storage call
    expect(serializeWorld(session.doc)).toBe(bytesBefore) // document untouched
    expect(events).toEqual([]) // no world-saved, no settle-committed stroke
    expect(session.store.getState().canUndo).toBe(false) // nothing entered history
    expect(session.store.getState().persistence).toEqual({ state: 'unsaved', message: REFUSAL })

    // The stroke is STILL the live gesture it was: Esc reverts its cell —
    // the proof the refusal left the gesture exactly alone.
    session.cancelGesture()
    const ground = session.doc.layers.find((layer) => layer.id === 'ground')
    if (ground === undefined) throw new Error('fixture world lost its ground layer')
    expect(getCell(ground, 1, 1)).toBe(1) // grass again
  })

  it('any other origin lowers the flag, and save works again', () => {
    const storage = memoryStorage()
    const session = makeSession(storage)
    session.loadWorld(otherWorld('lesson stage'), 'fixture')
    expect(session.save().ok).toBe(false)

    session.loadWorld(otherWorld('my own world'), 'load')
    expect(session.fixtureActive).toBe(false)
    expect(session.store.getState().persistence).toEqual({ state: 'saved', message: null })
    expect(session.save()).toEqual({ ok: true })
    expect(storage.map.get('world')).toBe(serializeWorld(session.doc))
  })
})

describe("loadWorld origin 'park-restore' (the parked world coming home)", () => {
  it("arrives honestly UNSAVED with the keep-it message — its bytes may sit in no save slot", () => {
    const storage = memoryStorage()
    const session = makeSession(storage)
    // The detour: a fixture holds the stage, an iso lens is up, and the
    // fixture has history — everything a restore must sweep.
    session.loadWorld(otherWorld('lesson stage'), 'fixture')
    session.setViewProjection('iso')
    session.bus.dispatch({ kind: 'place-entity', marker: 'crate', position: { x: 2.5, y: 2.5 }, elevation: 0 })
    expect(session.store.getState().canUndo).toBe(true)

    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))
    session.loadWorld(otherWorld('my own world'), 'park-restore')

    // The full 'load' semantics, preserved: flag down, history cleared,
    // lens reset — a park-restore is a load in every mechanical respect.
    expect(session.fixtureActive).toBe(false)
    expect(session.store.getState().canUndo).toBe(false)
    expect(session.viewProjection).toBeNull()
    // …except the badge: NOT 'saved' — the restored bytes exist in no save
    // slot until the student saves, and the message names the one action
    // that closes that window.
    expect(session.store.getState().persistence).toEqual({
      state: 'unsaved',
      message: 'back from the lesson — press Ctrl+S to keep your world',
    })
    // The frozen event vocabulary (D4) knows no 'park-restore': to lesson
    // data this arrival IS a load, and the event says so.
    expect(
      events.filter((event) => event.type === 'builder.world-loaded').map((event) => event.origin),
    ).toEqual(['load'])
  })

  it('a save after the restore flips to saved — the window closes', () => {
    const storage = memoryStorage()
    const session = makeSession(storage)
    session.loadWorld(otherWorld('lesson stage'), 'fixture')
    session.loadWorld(otherWorld('my own world'), 'park-restore')
    expect(session.store.getState().persistence.state).toBe('unsaved')

    expect(session.save()).toEqual({ ok: true })
    expect(session.store.getState().persistence).toEqual({ state: 'saved', message: null })
    expect(storage.map.get('world')).toBe(serializeWorld(session.doc))
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

describe('announce — the tutorial host\'s door into the one voice', () => {
  it('sets lastAction, bumps the seq, and emits NO builder event', () => {
    const session = makeSession()
    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))
    const seqBefore = session.store.getState().lastActionSeq

    session.announce('step 2 of 5: Find the address (12, 4)')
    const snap = session.store.getState()
    expect(snap.lastAction).toBe('step 2 of 5: Find the address (12, 4)')
    expect(snap.lastActionSeq).toBe(seqBefore + 1)
    // NO event: a rail change is narration, not work — lessons must never
    // be able to gate on their own announcements.
    expect(events).toEqual([])
  })

  it('shares lastActionSeq monotonically with builder-event announcements', () => {
    const session = makeSession()
    expect(session.store.getState().lastActionSeq).toBe(1) // boot's 'loaded world'

    session.bus.dispatch({ kind: 'place-entity', marker: 'crate', position: { x: 1.5, y: 1.5 }, elevation: 0 })
    expect(session.store.getState().lastActionSeq).toBe(2)
    expect(session.store.getState().lastAction).toBe('placed crate')

    session.announce('hint: try the brush')
    expect(session.store.getState().lastActionSeq).toBe(3)
    expect(session.store.getState().lastAction).toBe('hint: try the brush')

    // Back to the event spine: the SAME counter keeps climbing — one voice,
    // one sequence, so the status bar's re-announcement parity trick works
    // across both kinds of speech.
    session.bus.undo()
    expect(session.store.getState().lastActionSeq).toBe(4)
    expect(session.store.getState().lastAction).toBe('undid: place crate')
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

describe('setViewProjection — the curated view lens (ARCHITECTURE §4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rebuilds the stack around the new matrix, mirrors the snapshot, emits honestly — and never touches the document', () => {
    const storage = memoryStorage()
    storage.map.set('world', serializeWorld(createStarterWorld()))
    const session = makeSession(storage) // boots 'saved': a lens flip must not dirty it
    expect(session.viewProjection).toBeNull()
    expect(session.store.getState().viewProjection).toBeNull()
    expect(session.store.getState().primaryProjection).toBe('topdown')

    const events: BuilderEvent[] = []
    session.onEvent((event) => {
      if (event.type === 'builder.view-projection-changed') events.push(event)
    })
    const docBefore = serializeWorld(session.doc)
    const screenBefore = session.stack.worldToScreen({ x: 3, y: 2, z: 0 })

    session.setViewProjection('iso')

    // Same world point, different matrix: the stack really was rebuilt.
    const screenAfter = session.stack.worldToScreen({ x: 3, y: 2, z: 0 })
    expect(screenAfter).not.toEqual(screenBefore)
    expect(session.viewProjection).toBe('iso')
    expect(session.store.getState().viewProjection).toBe('iso')
    // The event names the EFFECTIVE projections: primary → lens.
    expect(events).toEqual([{ type: 'builder.view-projection-changed', from: 'topdown', to: 'iso' }])
    // The announcement rode the one spine…
    expect(session.store.getState().lastAction).toBe('switched to iso view')
    // …and the DOCUMENT is untouched: same bytes, still 'saved'.
    expect(serializeWorld(session.doc)).toBe(docBefore)
    expect(session.store.getState().persistence.state).toBe('saved')

    // Null returns to the primary, and the event says so by name.
    session.setViewProjection(null)
    expect(events).toHaveLength(2)
    expect(events[1]).toEqual({ type: 'builder.view-projection-changed', from: 'iso', to: 'topdown' })
    expect(session.viewProjection).toBeNull()
  })

  it('is a no-op on the same name — one switch, one event', () => {
    const session = makeSession()
    const events: BuilderEvent[] = []
    session.onEvent((event) => {
      if (event.type === 'builder.view-projection-changed') events.push(event)
    })
    session.setViewProjection(null) // already null
    session.setViewProjection('profile')
    session.setViewProjection('profile') // same lens again
    expect(events).toHaveLength(1)
  })

  it('naming the primary from the null lens changes no matrix: no event, no rebuild', () => {
    const session = makeSession()
    const events: BuilderEvent[] = []
    session.onEvent((event) => {
      if (event.type === 'builder.view-projection-changed') events.push(event)
    })
    const stackBefore = session.stack
    session.setViewProjection('topdown') // the starter primary's own name
    expect(events).toHaveLength(0) // effective projection never changed
    expect(session.stack).toBe(stackBefore) // same stack object: nothing rebuilt
    expect(session.store.getState().viewProjection).toBe('topdown') // mirrored honestly all the same
  })

  it('loadWorld resets the lens — a new document arrives in its own primary', () => {
    const session = makeSession()
    session.setViewProjection('iso')
    expect(session.viewProjection).toBe('iso')
    session.loadWorld(otherWorld('fresh world'), 'new')
    expect(session.viewProjection).toBeNull()
    expect(session.store.getState().viewProjection).toBeNull()
  })

  it('a lens switch refits the camera: the zoom readout returns to 1', () => {
    stubAnimationFrames()
    const session = makeSession()
    const { canvas, fire } = fakeCanvas()
    const detach = session.attach(canvas)
    fire('wheel', { deltaY: -100, clientX: 320, clientY: 210, preventDefault(): void {} })
    expect(session.fast.last?.zoom).toBeCloseTo(WHEEL_ZOOM_PER_NOTCH, 12)

    // The new matrix frames the whole world afresh — a student must never
    // meet the iso lens through a viewport zoomed for top-down.
    session.setViewProjection('iso')
    expect(session.fast.last?.zoom).toBeCloseTo(1, 12)
    detach()
  })
})

describe('setViewProjection cancels the live gesture (mirroring setActiveLayer)', () => {
  it('an open stroke dies with the lens switch: cells reverted, no history entry, no event', () => {
    const session = makeSession()
    const brush = createBrushTool(session)
    session.addTool(brush) // 'brush' is the boot-default active tool
    session.setActiveTile(4) // stone: really changes the grass it touches
    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))

    // A stroke mid-gesture: down paints the cell live, no pointerup yet.
    brush.onPointerDown(ev({ tile: { tx: 2, ty: 2 }, world: { x: 2.5, y: 2.5, z: 0 } }))
    const ground = session.doc.layers.find((layer) => layer.id === 'ground')
    if (ground === undefined) throw new Error('starter world lost its ground layer')
    expect(getCell(ground, 2, 2)).toBe(4) // painted, live

    // The lens switch: the stroke was recording under the OLD matrix, so
    // it dies with it — cancelled, never committed.
    session.setViewProjection('iso')
    expect(getCell(ground, 2, 2)).toBe(1) // grass again: the stroke reverted
    expect(session.store.getState().canUndo).toBe(false) // nothing entered history
    expect(events.filter((event) => event.type === 'builder.tile-painted')).toEqual([])
    // The switch itself still happened, announcement and all.
    expect(session.viewProjection).toBe('iso')
  })

  it('a live drag dies with the lens switch: override gone, nothing committed', () => {
    const session = makeSession()
    const select = createSelectTool(session)
    session.addTool(select)
    session.setActiveTool('select')

    // Press the starter player and drag past the threshold — mid-air now.
    select.onPointerDown(ev({ screen: session.stack.worldToScreen({ x: 16.5, y: 12.5, z: 0 }) }))
    select.onPointerMove(ev({ screen: session.stack.worldToScreen({ x: 20.2, y: 12.3, z: 0 }) }))
    expect(session.preview.entityOverride).not.toBeNull()

    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))
    session.setViewProjection('profile')

    expect(session.preview.entityOverride).toBeNull() // the ghost is gone
    expect(session.doc.entities['e1']?.components['position']).toEqual({ x: 16.5, y: 12.5 })
    expect(events.filter((event) => event.type === 'builder.entity-moved')).toEqual([])
    expect(session.store.getState().canUndo).toBe(false)
  })

  it('a no-op lens call leaves the live gesture alone — only real matrix changes cancel', () => {
    const session = makeSession()
    const brush = createBrushTool(session)
    session.addTool(brush)
    session.setActiveTile(4)
    brush.onPointerDown(ev({ tile: { tx: 2, ty: 2 }, world: { x: 2.5, y: 2.5, z: 0 } }))

    // Naming the primary from the null lens changes no matrix (pinned
    // above): the stroke must survive it.
    session.setViewProjection('topdown')
    const ground = session.doc.layers.find((layer) => layer.id === 'ground')
    if (ground === undefined) throw new Error('starter world lost its ground layer')
    expect(getCell(ground, 2, 2)).toBe(4) // still painted: the stroke lives

    // And it is still THE live gesture: Esc reverts it, proving the no-op
    // switch neither cancelled nor committed it.
    session.cancelGesture()
    expect(getCell(ground, 2, 2)).toBe(1)
  })
})

describe('the zoom readout (fast channel) stays fresh', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('wheel zoom is proportional: one notch each way round-trips, 0 is ignored', () => {
    stubAnimationFrames()
    const session = makeSession()
    const { canvas, fire } = fakeCanvas()
    const detach = session.attach(canvas)
    // The deferred boot fit landed at attach and republished: zoom 1, and
    // honestly no pointer coordinates yet.
    expect(session.fast.last).toEqual({ world: null, tile: null, zoom: 1 })

    // One full notch in (deltaY −100) is exactly one step. All assertions
    // reference the camera.ts dial — tuning the feel must not fail them.
    fire('wheel', { deltaY: -100, clientX: 320, clientY: 210, preventDefault(): void {} })
    expect(session.fast.last?.zoom).toBeCloseTo(WHEEL_ZOOM_PER_NOTCH, 12)

    // deltaY 0 is "no scroll" (trackpad momentum end, pure-horizontal
    // gestures) — it must not zoom out.
    fire('wheel', { deltaY: 0, clientX: 320, clientY: 210, preventDefault(): void {} })
    expect(session.fast.last?.zoom).toBeCloseTo(WHEEL_ZOOM_PER_NOTCH, 12)

    // A trackpad-sized nudge is a trackpad-sized zoom, not a full step —
    // the proportional contract that killed the old fixed-factor-per-event.
    fire('wheel', { deltaY: -10, clientX: 320, clientY: 210, preventDefault(): void {} })
    expect(session.fast.last?.zoom).toBeCloseTo(WHEEL_ZOOM_PER_NOTCH * WHEEL_ZOOM_PER_NOTCH ** 0.1, 12)
    fire('wheel', { deltaY: 10, clientX: 320, clientY: 210, preventDefault(): void {} })
    expect(session.fast.last?.zoom).toBeCloseTo(WHEEL_ZOOM_PER_NOTCH, 12)

    // One full notch out returns exactly to 1: in and out are inverses.
    fire('wheel', { deltaY: 100, clientX: 320, clientY: 210, preventDefault(): void {} })
    expect(session.fast.last?.zoom).toBeCloseTo(1, 12)
    detach()
  })

  it('loadWorld republishes the readout with the FRESH camera zoom', () => {
    stubAnimationFrames()
    const session = makeSession()
    // Even headless (no viewport), boot published an honest readout.
    expect(session.fast.last).toEqual({ world: null, tile: null, zoom: 1 })

    const { canvas, fire } = fakeCanvas()
    const detach = session.attach(canvas)
    fire('wheel', { deltaY: -100, clientX: 320, clientY: 210, preventDefault(): void {} })
    expect(session.fast.last?.zoom).toBeCloseTo(WHEEL_ZOOM_PER_NOTCH, 12)

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

describe('wheelZoomFactor (camera.ts — the zoom-feel dial)', () => {
  it('one full notch is exactly one step (the dial), each way', () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(WHEEL_ZOOM_PER_NOTCH, 12)
    expect(wheelZoomFactor(100)).toBeCloseTo(1 / WHEEL_ZOOM_PER_NOTCH, 12)
  })

  it('half-notches compose to whole ones — the property that tames trackpads', () => {
    expect(wheelZoomFactor(-50) * wheelZoomFactor(-50)).toBeCloseTo(wheelZoomFactor(-100), 12)
    expect(wheelZoomFactor(20) * wheelZoomFactor(80)).toBeCloseTo(wheelZoomFactor(100), 12)
  })

  it('a wild fling clamps to the notch cap — one event can never teleport the zoom', () => {
    expect(wheelZoomFactor(-1e6)).toBeCloseTo(WHEEL_ZOOM_PER_NOTCH ** WHEEL_MAX_NOTCHES, 8)
    expect(wheelZoomFactor(1e6)).toBeCloseTo(WHEEL_ZOOM_PER_NOTCH ** -WHEEL_MAX_NOTCHES, 12)
  })
})

describe('space-pan (hold Space, drag to pan — the Figma grammar)', () => {
  it('a drag during standby pans the camera and never reaches the tool', () => {
    stubAnimationFrames()
    const session = makeSession()
    session.addTool(createBrushTool(session))
    session.setActiveTile(4) // stone: a leaked paint would really change grass
    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))
    const { canvas, fire } = fakeCanvas()
    const detach = session.attach(canvas)
    const before = session.stack.camera

    session.beginSpacePan()
    fire('pointerdown', { pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 100, shiftKey: false })
    // The tool was shielded: the brush's down would have opened a stroke.
    expect(session.bus.strokeOpen()).toBe(false)
    fire('pointermove', { pointerId: 1, buttons: 1, clientX: 130, clientY: 80, shiftKey: false })
    fire('pointerup', { pointerId: 1, button: 0, clientX: 130, clientY: 80, shiftKey: false })
    expect(session.endSpacePan()).toBe(true) // the hold carried a pan

    // The picture slid with the pointer: +30 east, −20 down-screen — a pure
    // translation, scale untouched (the axis-aligned invariant holds).
    const after = session.stack.camera
    expect(after.tx - before.tx).toBeCloseTo(30, 12)
    expect(after.ty - before.ty).toBeCloseTo(-20, 12)
    expect(after.a).toBeCloseTo(before.a, 12)
    expect(after.b).toBe(0)
    expect(after.c).toBe(0)
    // No paint, no history, no events: the world never noticed the pan.
    expect(events.filter((event) => event.type === 'builder.tile-painted')).toEqual([])
    expect(session.store.getState().canUndo).toBe(false)
    detach()
  })

  it('an untouched tap reports no engagement — the caller may treat it as "act"', () => {
    const session = makeSession() // no viewport needed: state-only question
    session.beginSpacePan()
    expect(session.endSpacePan()).toBe(false)
  })

  it('releasing Space mid-drag keeps the pan alive until pointerup; the NEXT drag is the tool again', () => {
    stubAnimationFrames()
    const session = makeSession()
    session.addTool(createBrushTool(session))
    session.setActiveTile(4)
    const { canvas, fire } = fakeCanvas()
    const detach = session.attach(canvas)

    session.beginSpacePan()
    fire('pointerdown', { pointerId: 1, button: 0, buttons: 1, clientX: 200, clientY: 200, shiftKey: false })
    expect(session.endSpacePan()).toBe(true) // Space lifts mid-drag…
    const mid = session.stack.camera
    fire('pointermove', { pointerId: 1, buttons: 1, clientX: 240, clientY: 210, shiftKey: false })
    expect(session.stack.camera.tx - mid.tx).toBeCloseTo(40, 12) // …but the pan still owns the pointer
    fire('pointerup', { pointerId: 1, button: 0, clientX: 240, clientY: 210, shiftKey: false })

    // Standby is over: a fresh down belongs to the brush and opens a stroke.
    fire('pointerdown', { pointerId: 2, button: 0, buttons: 1, clientX: 320, clientY: 210, shiftKey: false })
    expect(session.bus.strokeOpen()).toBe(true)
    fire('pointerup', { pointerId: 2, button: 0, clientX: 320, clientY: 210, shiftKey: false })
    detach()
  })

  it('key auto-repeat cannot erase the engagement record', () => {
    stubAnimationFrames()
    const session = makeSession()
    const { canvas, fire } = fakeCanvas()
    const detach = session.attach(canvas)

    session.beginSpacePan()
    fire('pointerdown', { pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 100, shiftKey: false })
    session.beginSpacePan() // the repeat keydown mid-drag — must be a no-op
    fire('pointerup', { pointerId: 1, button: 0, clientX: 100, clientY: 100, shiftKey: false })
    expect(session.endSpacePan()).toBe(true) // the pan still counts: no act on keyup
    detach()
  })
})
