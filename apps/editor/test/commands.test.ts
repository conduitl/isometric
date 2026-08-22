/*
 * The entity/settings command substrate, property-tested.
 *
 * The headline CI gate from docs/ARCHITECTURE.md §6: `apply ∘ invert =
 * identity`, PER COMMAND KIND, over seeded-random worlds and commands. The
 * equality is byte equality of serializeWorld output — the canonical writer
 * means "same bytes" is exactly "same world", so one string comparison
 * checks every field the file format knows about.
 *
 * Around the property sit the conversational contracts of dispatch:
 * rejections answer instead of throwing, no-ops leave no trace in history
 * or events, every applied command emits exactly one event with exact
 * payloads, and a new commit clears the redo stack.
 */

import { createWorld, entityIds, spawn } from '@engine/core'
import type { World } from '@engine/core'
import { createRng } from '@engine/math'
import type { Rng } from '@engine/math'
import { createTileLayer } from '@engine/tilemap'
import { parseWorld, serializeWorld } from '@engine/world-format'
import { describe, expect, it } from 'vitest'
import { createCommandBus } from '../src/editor/commands/bus'
import type { BuilderEvent } from '../src/editor/events/builder'
import { PIP_FIGURINE } from '../src/editor/figurine'
import type { DocumentHost, EditorCommand } from '../src/editor/types'

// --- rig: a plain document host + bus + event log --------------------------

interface Rig {
  readonly host: DocumentHost
  readonly bus: ReturnType<typeof createCommandBus>
  readonly events: BuilderEvent[]
}

function createRig(initial: World): Rig {
  let doc = initial
  const events: BuilderEvent[] = []
  const host: DocumentHost = {
    get doc() {
      return doc
    },
    replaceDoc(next: World) {
      doc = next
    },
    tilesTouched() {},
  }
  const bus = createCommandBus({ host, emit: (event) => events.push(event) })
  return { host, bus, events }
}

// --- seeded world/command generators ---------------------------------------

const MARKERS = ['player', 'crate', 'tree'] as const
const NAMES = ['scout', 'boulder', 'old oak', 'door', 'chest'] as const

function randomWorld(rng: Rng): World {
  const world = createWorld({ name: 'proving ground', settings: { seed: rng.int(1, 10_000) } })
  world.tilesets.push({
    id: 'terrain',
    name: 'terrain',
    tiles: [
      { name: 'grass', colors: { top: '#4caf50' } },
      { name: 'water', colors: { top: '#2196f3' } },
    ],
  })
  world.layers.push(createTileLayer({ id: 'ground', width: 8, height: 6, tilesetId: 'terrain' }))
  const count = rng.int(1, 5)
  for (let i = 0; i < count; i += 1) {
    const marker = MARKERS[rng.int(0, MARKERS.length)] as string
    spawn(world, {
      name: marker,
      components: {
        position: { x: rng.int(0, 8), y: rng.int(0, 6) },
        elevation: { z: rng.int(0, 3) },
        marker: { kind: marker },
      },
    })
  }
  return world
}

function pickEntityId(rng: Rng, world: World): string {
  const ids = entityIds(world)
  return ids[rng.int(0, ids.length)] as string
}

/** A guaranteed-to-apply command of the given kind (never a no-op: moves
 * shift by at least one cell, renames always pick a fresh name). */
function randomCommandOfKind(rng: Rng, world: World, kind: EditorCommand['kind']): EditorCommand {
  switch (kind) {
    case 'place-entity': {
      const marker = MARKERS[rng.int(0, MARKERS.length)] as string
      const named = rng.next() < 0.5
      return {
        kind,
        marker,
        ...(named ? { name: NAMES[rng.int(0, NAMES.length)] as string } : {}),
        position: { x: rng.int(0, 8), y: rng.int(0, 6) },
        elevation: rng.int(0, 3),
      }
    }
    case 'move-entity': {
      const id = pickEntityId(rng, world)
      const holder = world.entities[id]
      if (holder === undefined) throw new Error('generator picked a missing entity')
      const position = holder.components['position'] as { x: number; y: number }
      const withElevation = rng.next() < 0.5
      return {
        kind,
        id,
        to: { x: position.x + rng.int(1, 4), y: position.y + rng.int(1, 4) },
        ...(withElevation ? { toElevation: rng.int(4, 8) } : {}), // 4..7 — never the current 0..2
      }
    }
    case 'rename-entity':
      return { kind, id: pickEntityId(rng, world), name: `renamed ${NAMES[rng.int(0, NAMES.length)] as string}` }
    case 'delete-entity':
      return { kind, id: pickEntityId(rng, world) }
    case 'rename-world':
      return { kind, name: `renamed ${NAMES[rng.int(0, NAMES.length)] as string}` }
  }
}

// --- the property: apply ∘ invert = identity, per command kind -------------

describe('apply ∘ invert = identity (seeded property, per command kind)', () => {
  const kinds: ReadonlyArray<EditorCommand['kind']> = [
    'place-entity',
    'move-entity',
    'rename-entity',
    'delete-entity',
    'rename-world',
  ]

  kinds.forEach((kind, kindIndex) => {
    it(`${kind}: undo restores the pre-dispatch bytes, redo the post-dispatch bytes`, () => {
      const rng = createRng(1000 + kindIndex)
      for (let round = 0; round < 25; round += 1) {
        const { host, bus } = createRig(randomWorld(rng))
        const command = randomCommandOfKind(rng, host.doc, kind)

        const before = serializeWorld(host.doc)
        const result = bus.dispatch(command)
        expect(result.ok).toBe(true)
        const after = serializeWorld(host.doc)
        expect(after).not.toBe(before) // the generator never produces no-ops

        expect(bus.undo()).not.toBeNull()
        expect(serializeWorld(host.doc)).toBe(before)

        expect(bus.redo()).not.toBeNull()
        expect(serializeWorld(host.doc)).toBe(after)

        // And once more around, because undo state machines love off-by-ones.
        bus.undo()
        expect(serializeWorld(host.doc)).toBe(before)
        bus.redo()
        expect(serializeWorld(host.doc)).toBe(after)
      }
    })
  })
})

// --- rejections: answered, never thrown ------------------------------------

describe('rejections', () => {
  it('rejects moving a missing entity, touching nothing', () => {
    const { host, bus, events } = createRig(randomWorld(createRng(1)))
    const before = serializeWorld(host.doc)
    const result = bus.dispatch({ kind: 'move-entity', id: 'e999', to: { x: 1, y: 1 } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('e999')
    expect(serializeWorld(host.doc)).toBe(before)
    expect(bus.canUndo()).toBe(false)
    expect(events).toEqual([])
  })

  it('rejects moving an entity that has no position component', () => {
    const world = randomWorld(createRng(2))
    const ghost = spawn(world, { name: 'ghost', components: {} })
    const { bus, events } = createRig(world)
    const result = bus.dispatch({ kind: 'move-entity', id: ghost.id, to: { x: 1, y: 1 } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('position')
    expect(bus.canUndo()).toBe(false)
    expect(events).toEqual([])
  })

  it('rejects renaming and deleting missing entities', () => {
    const { bus, events } = createRig(randomWorld(createRng(3)))
    expect(bus.dispatch({ kind: 'rename-entity', id: 'e999', name: 'nope' }).ok).toBe(false)
    expect(bus.dispatch({ kind: 'delete-entity', id: 'e999' }).ok).toBe(false)
    expect(bus.canUndo()).toBe(false)
    expect(events).toEqual([])
  })
})

// --- no-ops: ok, but no history entry and no event -------------------------

describe('no-ops', () => {
  it('renaming an entity to its current name changes nothing', () => {
    const world = createWorld({ name: 'noop world' })
    const crate = spawn(world, { name: 'crate', components: { position: { x: 1, y: 2 } } })
    const { host, bus, events } = createRig(world)
    const before = serializeWorld(host.doc)

    const result = bus.dispatch({ kind: 'rename-entity', id: crate.id, name: 'crate' })
    expect(result).toEqual({ ok: true, label: 'rename crate' })
    expect(serializeWorld(host.doc)).toBe(before)
    expect(bus.canUndo()).toBe(false)
    expect(events).toEqual([])
  })

  it('moving an entity to exactly where it stands changes nothing', () => {
    const world = createWorld()
    const crate = spawn(world, {
      name: 'crate',
      components: { position: { x: 3, y: 4 }, elevation: { z: 2 } },
    })
    const { bus, events } = createRig(world)

    // Same x/y, elevation unstated: no-op.
    expect(bus.dispatch({ kind: 'move-entity', id: crate.id, to: { x: 3, y: 4 } })).toEqual({
      ok: true,
      label: 'move crate',
    })
    // Same x/y AND the same storey named explicitly: still a no-op.
    expect(
      bus.dispatch({ kind: 'move-entity', id: crate.id, to: { x: 3, y: 4 }, toElevation: 2 }).ok,
    ).toBe(true)
    expect(bus.canUndo()).toBe(false)
    expect(events).toEqual([])

    // Same x/y but a DIFFERENT storey: that is a real move.
    const result = bus.dispatch({ kind: 'move-entity', id: crate.id, to: { x: 3, y: 4 }, toElevation: 5 })
    expect(result.ok).toBe(true)
    expect(bus.canUndo()).toBe(true)
    expect(events).toHaveLength(1)
  })

  it('renaming the world to its current name changes nothing', () => {
    const world = createWorld({ name: 'keeper' })
    const { bus, events } = createRig(world)
    expect(bus.dispatch({ kind: 'rename-world', name: 'keeper' })).toEqual({
      ok: true,
      label: 'rename world',
    })
    expect(bus.canUndo()).toBe(false)
    expect(events).toEqual([])
  })
})

// --- event payloads: one event per dispatch, exact facts -------------------

describe('event payloads', () => {
  it('place-entity emits builder.entity-placed with the pre-minted id', () => {
    const world = createWorld()
    spawn(world, { name: 'first', components: { position: { x: 0, y: 0 } } }) // e1
    const { bus, events } = createRig(world)
    const nextId = `e${world.nextEntityId}`

    const result = bus.dispatch({
      kind: 'place-entity',
      marker: 'crate',
      position: { x: 5, y: 6 },
      elevation: 1,
    })
    expect(result).toEqual({ ok: true, label: 'place crate' })
    expect(events).toEqual([
      {
        type: 'builder.entity-placed',
        id: nextId,
        marker: 'crate',
        name: 'crate', // display name defaults to the marker kind
        position: { x: 5, y: 6 },
        elevation: 1,
      },
    ])
  })

  it('move-entity emits builder.entity-moved with exact from/to, z from elevation (default 0)', () => {
    const world = createWorld()
    const flat = spawn(world, { name: 'flat', components: { position: { x: 1, y: 2 } } })
    const tall = spawn(world, { name: 'tall', components: { position: { x: 3, y: 4 }, elevation: { z: 2 } } })
    const { bus, events } = createRig(world)

    bus.dispatch({ kind: 'move-entity', id: flat.id, to: { x: 7, y: 8 } })
    bus.dispatch({ kind: 'move-entity', id: tall.id, to: { x: 5, y: 5 }, toElevation: 1 })

    expect(events).toEqual([
      {
        type: 'builder.entity-moved',
        id: flat.id,
        from: { x: 1, y: 2, z: 0 }, // no elevation component → ground level
        to: { x: 7, y: 8, z: 0 },
      },
      {
        type: 'builder.entity-moved',
        id: tall.id,
        from: { x: 3, y: 4, z: 2 },
        to: { x: 5, y: 5, z: 1 },
      },
    ])
  })

  it('rename/delete/rename-world each emit one event with exact facts', () => {
    const world = createWorld({ name: 'old name' })
    const crate = spawn(world, {
      name: 'crate',
      components: { position: { x: 0, y: 0 }, marker: { kind: 'crate' } },
    })
    const plain = spawn(world, { name: 'plain', components: { position: { x: 1, y: 1 } } })
    const { bus, events } = createRig(world)

    bus.dispatch({ kind: 'rename-entity', id: crate.id, name: 'box' })
    bus.dispatch({ kind: 'delete-entity', id: crate.id })
    bus.dispatch({ kind: 'delete-entity', id: plain.id })
    bus.dispatch({ kind: 'rename-world', name: 'new name' })

    expect(events).toEqual([
      { type: 'builder.entity-renamed', id: crate.id, from: 'crate', to: 'box' },
      { type: 'builder.entity-deleted', id: crate.id, marker: 'crate', name: 'box' },
      { type: 'builder.entity-deleted', id: plain.id, marker: null, name: 'plain' },
      { type: 'builder.world-renamed', from: 'old name', to: 'new name' },
    ])
  })

  it('undo and redo emit their own labelled events, never the inverse of the original', () => {
    const world = createWorld()
    const { bus, events } = createRig(world)
    bus.dispatch({ kind: 'place-entity', marker: 'tree', position: { x: 2, y: 2 }, elevation: 0 })
    events.length = 0

    expect(bus.undo()).toBe('place tree')
    expect(bus.redo()).toBe('place tree')
    expect(events).toEqual([
      { type: 'builder.command-undone', label: 'place tree' },
      { type: 'builder.command-redone', label: 'place tree' },
    ])
  })
})

// --- stack mechanics -------------------------------------------------------

describe('history stacks', () => {
  it('a new commit clears the redo stack', () => {
    const { bus } = createRig(createWorld())
    bus.dispatch({ kind: 'place-entity', marker: 'crate', position: { x: 0, y: 0 }, elevation: 0 })
    bus.dispatch({ kind: 'place-entity', marker: 'tree', position: { x: 1, y: 1 }, elevation: 0 })
    bus.undo()
    expect(bus.canRedo()).toBe(true)

    bus.dispatch({ kind: 'place-entity', marker: 'player', position: { x: 2, y: 2 }, elevation: 0 })
    expect(bus.canRedo()).toBe(false)
    expect(bus.redo()).toBeNull()
  })

  it('a no-op does NOT clear the redo stack (nothing was committed)', () => {
    const world = createWorld({ name: 'stable' })
    const { bus } = createRig(world)
    bus.dispatch({ kind: 'place-entity', marker: 'crate', position: { x: 0, y: 0 }, elevation: 0 })
    bus.undo()
    expect(bus.canRedo()).toBe(true)
    bus.dispatch({ kind: 'rename-world', name: 'stable' }) // no-op
    expect(bus.canRedo()).toBe(true)
  })

  it('undo/redo on empty stacks answer null, and clearHistory empties both', () => {
    const { bus } = createRig(createWorld())
    expect(bus.undo()).toBeNull()
    expect(bus.redo()).toBeNull()

    bus.dispatch({ kind: 'place-entity', marker: 'crate', position: { x: 0, y: 0 }, elevation: 0 })
    bus.dispatch({ kind: 'place-entity', marker: 'tree', position: { x: 1, y: 1 }, elevation: 0 })
    bus.undo()
    expect(bus.canUndo()).toBe(true)
    expect(bus.canRedo()).toBe(true)
    bus.clearHistory()
    expect(bus.canUndo()).toBe(false)
    expect(bus.canRedo()).toBe(false)
  })

  it('undone place-entity releases its id back to the counter — redo re-mints the same id', () => {
    const world = createWorld()
    const { host, bus, events } = createRig(world)
    bus.dispatch({ kind: 'place-entity', marker: 'crate', position: { x: 0, y: 0 }, elevation: 0 })
    const placed = events[0] as { id: string }
    bus.undo()
    expect(host.doc.nextEntityId).toBe(1) // the inverse patch rewound the counter
    events.length = 0
    bus.dispatch({ kind: 'place-entity', marker: 'tree', position: { x: 1, y: 1 }, elevation: 0 })
    expect((events[0] as { id: string }).id).toBe(placed.id) // same id, freshly minted
  })
})

// --- the pip figurine: one marker kind that carries an extra component -----

describe('the pip figurine', () => {
  it("placing 'pip' attaches figurine: PIP_FIGURINE alongside the usual trio", () => {
    const { host, bus } = createRig(createWorld())
    const result = bus.dispatch({ kind: 'place-entity', marker: 'pip', position: { x: 2, y: 3 }, elevation: 0 })
    expect(result).toEqual({ ok: true, label: 'place pip' })

    const pip = host.doc.entities['e1']
    if (pip === undefined) throw new Error('pip was not placed')
    expect(pip.components).toEqual({
      position: { x: 2, y: 3 },
      elevation: { z: 0 },
      marker: { kind: 'pip' },
      figurine: PIP_FIGURINE,
    })

    // Every OTHER marker kind is unaffected — no figurine component rides
    // along uninvited.
    bus.dispatch({ kind: 'place-entity', marker: 'crate', position: { x: 0, y: 0 }, elevation: 0 })
    const crate = host.doc.entities['e2']
    expect(crate?.components['figurine']).toBeUndefined()
  })

  it('the placed figurine component survives a save/load round trip byte-for-byte', () => {
    const { host, bus } = createRig(createWorld())
    bus.dispatch({ kind: 'place-entity', marker: 'pip', position: { x: 4, y: 4 }, elevation: 0 })

    const text = serializeWorld(host.doc)
    const parsed = parseWorld(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const pip = parsed.world.entities['e1']
    if (pip === undefined) throw new Error('pip did not survive the round trip')
    expect(pip.components['figurine']).toEqual(PIP_FIGURINE)
    // And re-serializing lands on the exact same bytes — the whole point of
    // components being opaque, JSON-serializable data at the file boundary.
    expect(serializeWorld(parsed.world)).toBe(text)
  })
})
