/**
 * The transient-edit preview protocol, proven against a REAL session.
 *
 * The protocol's whole promise is what does NOT happen: between begin and
 * commit, nothing touches history, the store, or the event stream — the
 * drag is an opinion rendered as an override. These tests watch all three
 * ledgers around a full drag lifecycle, and pin the byte-exactness of undo
 * after a commit (serializeWorld is canonical, so "same bytes" is exactly
 * "same world").
 */

import { spawn } from '@engine/core'
import type { RasterFactory } from '@engine/tilemap'
import { serializeWorld } from '@engine/world-format'
import type { SlotStorage } from '@engine/world-format'
import { describe, expect, it } from 'vitest'
import type { BuilderEvent } from '../src/editor/events/builder'
import { createEditorSession } from '../src/editor/session'
import { createStarterWorld } from '../src/editor/starter'

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

function makeSession(storage: SlotStorage = memoryStorage()) {
  return createEditorSession({ storage, raster: fakeRaster() })
}

describe('the entity drag preview', () => {
  it('begin → update → commit: one command, one event, one undo step — byte-exact', () => {
    const session = makeSession()
    const events: BuilderEvent[] = []
    session.onEvent((event) => {
      if (event.type === 'builder.entity-moved') events.push(event)
    })
    const baseline = serializeWorld(session.doc)

    const drag = session.preview.beginEntityDrag('e1')
    expect(drag).not.toBeNull()
    // The override is live from the moment the drag begins, at the
    // committed start point (the player stands on the center of cell
    // (16, 12) — the starter contract's half-coordinates).
    expect(session.preview.entityOverride).toEqual({ id: 'e1', point: { x: 16.5, y: 12.5, z: 0 } })

    drag?.update({ x: 3, y: 2, z: 0 })
    // The ghost moved; the ledgers did not.
    expect(session.preview.entityOverride).toEqual({ id: 'e1', point: { x: 3, y: 2, z: 0 } })
    expect(session.store.getState().canUndo).toBe(false)
    expect(events).toHaveLength(0)
    expect(serializeWorld(session.doc)).toBe(baseline)

    drag?.commit()
    expect(session.preview.entityOverride).toBeNull()
    expect(events).toEqual([
      {
        type: 'builder.entity-moved',
        id: 'e1',
        from: { x: 16.5, y: 12.5, z: 0 },
        to: { x: 3, y: 2, z: 0 },
      },
    ])
    expect(session.store.getState().canUndo).toBe(true)

    // Exactly ONE history entry: a single undo restores the original bytes
    // and empties the stack.
    expect(session.bus.undo()).toBe('move player')
    expect(session.store.getState().canUndo).toBe(false)
    expect(serializeWorld(session.doc)).toBe(baseline)

    // The retired handle is inert: a stray update cannot resurrect the ghost.
    drag?.update({ x: 9, y: 9, z: 0 })
    expect(session.preview.entityOverride).toBeNull()
  })

  it('a drag that ends where it began commits nothing at all', () => {
    const session = makeSession()
    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))
    const baseline = serializeWorld(session.doc)

    const wiggle = session.preview.beginEntityDrag('e1')
    wiggle?.update({ x: 5, y: 5, z: 0 })
    wiggle?.update({ x: 16.5, y: 12.5, z: 0 }) // back to the start
    wiggle?.commit()
    expect(session.preview.entityOverride).toBeNull()
    expect(session.store.getState().canUndo).toBe(false)
    expect(events.filter((event) => event.type === 'builder.entity-moved')).toHaveLength(0)
    expect(serializeWorld(session.doc)).toBe(baseline)

    // Same for a begin/commit with no update in between.
    const still = session.preview.beginEntityDrag('e1')
    still?.commit()
    expect(session.store.getState().canUndo).toBe(false)
    expect(serializeWorld(session.doc)).toBe(baseline)
  })

  it('cancel leaves no history and no event — the gesture never happened', () => {
    const session = makeSession()
    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))
    const baseline = serializeWorld(session.doc)

    const drag = session.preview.beginEntityDrag('e1')
    drag?.update({ x: 7, y: 7, z: 0 })
    drag?.cancel()
    expect(session.preview.entityOverride).toBeNull()
    expect(session.store.getState().canUndo).toBe(false)
    expect(events.filter((event) => event.type === 'builder.entity-moved')).toHaveLength(0)
    expect(serializeWorld(session.doc)).toBe(baseline)
  })

  it('one drag at a time: a second begin answers null until the first retires', () => {
    const session = makeSession()
    const first = session.preview.beginEntityDrag('e1')
    expect(first).not.toBeNull()
    expect(session.preview.beginEntityDrag('e1')).toBeNull()
    first?.commit() // at the start point: dispatches nothing, but retires
    const second = session.preview.beginEntityDrag('e1')
    expect(second).not.toBeNull()
    second?.cancel()
  })

  it('refuses entities that are missing or have no position', () => {
    const storage = memoryStorage()
    const world = createStarterWorld()
    spawn(world, { name: 'ghost' }) // e2: no position component at all
    storage.map.set('world', serializeWorld(world))
    const session = makeSession(storage)

    expect(session.preview.beginEntityDrag('e99')).toBeNull()
    expect(session.preview.beginEntityDrag('e2')).toBeNull()
    expect(session.preview.entityOverride).toBeNull()
  })
})

describe('clearing overrides the active tool does not own', () => {
  // The hole these pin shut: tools clear their OWN drags through the handle
  // they hold, but a drag begun elsewhere (a panel, or a tool switched away
  // from mid-gesture) is reachable by nobody the session's onCancel routing
  // can see. loadWorld and cancelGesture sweep the channel itself.

  it('loadWorld drops a live override begun outside any tool', () => {
    const session = makeSession()
    const drag = session.preview.beginEntityDrag('e1')
    drag?.update({ x: 3, y: 2, z: 0 })
    expect(session.preview.entityOverride).not.toBeNull()

    session.loadWorld(createStarterWorld(), 'new')
    // The old world's ghost must not haunt the new one.
    expect(session.preview.entityOverride).toBeNull()

    // The outstanding handle is inert: no resurrection, no late commit.
    drag?.update({ x: 9, y: 9, z: 0 })
    expect(session.preview.entityOverride).toBeNull()
    drag?.commit()
    expect(session.store.getState().canUndo).toBe(false)
  })

  it('cancelGesture clears a drag even after the active tool switched away', () => {
    const session = makeSession()
    const baseline = serializeWorld(session.doc)
    // Begin the drag OUTSIDE any tool (the boot-default active tool is the
    // brush, which knows nothing of this preview)…
    const drag = session.preview.beginEntityDrag('e1')
    drag?.update({ x: 5, y: 5, z: 0 })
    // …switch tools mid-drag: no onCancel can reach this drag, so the
    // override survives the switch…
    session.setActiveTool('select')
    expect(session.preview.entityOverride).not.toBeNull()

    // …and Esc still kills it, through the session's own sweep.
    session.cancelGesture()
    expect(session.preview.entityOverride).toBeNull()
    // Cancelled means cancelled: no history, no event, same bytes — and the
    // orphaned handle cannot commit the gesture after the fact.
    drag?.commit()
    expect(session.store.getState().canUndo).toBe(false)
    expect(serializeWorld(session.doc)).toBe(baseline)
  })
})
