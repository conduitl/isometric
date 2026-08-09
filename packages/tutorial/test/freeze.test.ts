/**
 * THE GOVERNANCE TRIPWIRE (docs/DECISIONS.md D4) — the frozen builder.*
 * vocabulary, snapshotted as a literal IN THIS FILE. Deliberately not an
 * external JSON: any change to the vocabulary must edit this test, so the
 * PR diff shows the old contract and the new contract side by side — the
 * diff review IS the governance.
 *
 * ## The three layers, and which tool catches what
 *
 * 1. **Names** (runtime asserts below): every frozen name stays live,
 *    growth-only, no duplicates — and BUILDER_EVENT_HISTORY proves alias
 *    permanence: every name EVER registered still resolves, forever.
 * 2. **Field lists** (runtime asserts): each event's top-level payload
 *    field names, pinned as FROZEN_PAYLOADS and asserted against both a
 *    complete sample literal per event and the governed
 *    BUILDER_EVENT_PAYLOAD_FIELDS export the validator keys on. Catches a
 *    field vanishing or appearing unrecorded.
 * 3. **Payload TYPES** (the `expectTypeOf` pins below): each of the 12
 *    payloads is spelled out as a complete literal type and asserted
 *    EXACTLY equal to the interface in events.ts. These pins are enforced
 *    by the package TYPECHECK (`tsc --noEmit`, run in CI), not by the
 *    vitest runtime — `expectTypeOf(...).toEqualTypeOf<...>()` is a no-op
 *    at runtime and a compile ERROR on any inexact match. Verified by
 *    negative testing when the pins were written: widening a field
 *    (`tile: number` → `number | string`), demoting required → optional,
 *    dropping a `readonly`, removing a field, and even ADDING an optional
 *    field each fail tsc — so the one legal payload evolution (a new
 *    optional field) must edit the matching pin in the same PR, which is
 *    exactly the reviewable diff D4 demands.
 *
 * ## How to legally evolve the vocabulary
 *
 * - **Append a new event:** add the interface, the union member, the
 *   BUILDER_EVENT_TYPES entry, the BUILDER_EVENT_HISTORY entry, the
 *   BUILDER_EVENT_PAYLOAD_FIELDS entry — and, in the SAME PR, a sample
 *   event, a snapshot entry, and a type pin below. (The sample map and the
 *   registries are keyed by the full BuilderEventType union, so forgetting
 *   them is a compile error; the snapshot and pin are what the reviewer
 *   reads.)
 * - **Rename an event:** move its snapshot entry, sample, and pin to the
 *   new name (leave a comment naming the old one), add `old → new` to
 *   BUILDER_EVENT_ALIASES, and KEEP the old name in BUILDER_EVENT_HISTORY
 *   — the history test proves the old name still resolves, forever.
 * - **Add an OPTIONAL payload field:** extend the sample, its snapshot
 *   field list, its BUILDER_EVENT_PAYLOAD_FIELDS list, and its type pin in
 *   the same PR, so the diff names exactly which event grew what.
 * - **Anything else** — removing an event, removing a field, changing a
 *   field's type or meaning — has no legal diff. It fails here by design;
 *   the fix is to not do it.
 */

import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  BUILDER_EVENT_ALIASES,
  BUILDER_EVENT_HISTORY,
  BUILDER_EVENT_PAYLOAD_FIELDS,
  BUILDER_EVENT_TYPES,
  createBuilderEmitter,
  isBuilderEventType,
  resolveBuilderEventType,
} from '../src/events'
import type {
  BuilderEvent,
  BuilderEventType,
  CommandRedoneEvent,
  CommandUndoneEvent,
  EntityDeletedEvent,
  EntityMovedEvent,
  EntityPlacedEvent,
  EntityRenamedEvent,
  SelectionChangedEvent,
  TilePaintedEvent,
  ViewProjectionChangedEvent,
  WorldLoadedEvent,
  WorldRenamedEvent,
  WorldSavedEvent,
} from '../src/events'

// ---------------------------------------------------------------------------
// The snapshot: event name → exact sorted payload field names (top level of
// the interface, `type` included). Frozen August 2026, 12 events.
// ---------------------------------------------------------------------------

const FROZEN_PAYLOADS: Readonly<Record<string, readonly string[]>> = {
  'builder.tile-painted': ['cells', 'layerId', 'tile', 'toolId', 'type'],
  'builder.entity-placed': ['elevation', 'id', 'marker', 'name', 'position', 'type'],
  'builder.entity-moved': ['from', 'id', 'to', 'type'],
  'builder.entity-renamed': ['from', 'id', 'to', 'type'],
  'builder.entity-deleted': ['id', 'marker', 'name', 'type'],
  'builder.selection-changed': ['selection', 'type'],
  'builder.command-undone': ['label', 'type'],
  'builder.command-redone': ['label', 'type'],
  'builder.world-saved': ['type', 'worldId'],
  'builder.world-loaded': ['origin', 'type', 'usedBackup', 'worldId'],
  'builder.world-renamed': ['from', 'to', 'type'],
  'builder.view-projection-changed': ['from', 'to', 'type'],
}

// One complete literal per frozen event. Keyed by the FULL union: appending
// an event without a sample here is a compile error, and a payload change in
// events.ts that touches a required field breaks the matching literal.
const SAMPLE_EVENTS: { readonly [K in BuilderEventType]: Extract<BuilderEvent, { readonly type: K }> } = {
  'builder.tile-painted': {
    type: 'builder.tile-painted',
    layerId: 'ground',
    tile: 2,
    cells: [
      { tx: 12, ty: 4 },
      { tx: 13, ty: 4 },
    ],
    toolId: 'brush',
  },
  'builder.entity-placed': {
    type: 'builder.entity-placed',
    id: 'e1',
    marker: 'crate',
    name: 'crate',
    position: { x: 3, y: 4 },
    elevation: 0,
  },
  'builder.entity-moved': {
    type: 'builder.entity-moved',
    id: 'e1',
    from: { x: 3, y: 4, z: 0 },
    to: { x: 6, y: 8, z: 0 },
  },
  'builder.entity-renamed': {
    type: 'builder.entity-renamed',
    id: 'e1',
    from: 'crate',
    to: 'supply crate',
  },
  'builder.entity-deleted': {
    type: 'builder.entity-deleted',
    id: 'e1',
    marker: 'crate',
    name: 'supply crate',
  },
  'builder.selection-changed': {
    type: 'builder.selection-changed',
    selection: { kind: 'tile', tx: 12, ty: 4, layerId: 'ground' },
  },
  'builder.command-undone': {
    type: 'builder.command-undone',
    label: 'paint 2 tiles',
  },
  'builder.command-redone': {
    type: 'builder.command-redone',
    label: 'paint 2 tiles',
  },
  'builder.world-saved': {
    type: 'builder.world-saved',
    worldId: 'w1',
  },
  'builder.world-loaded': {
    type: 'builder.world-loaded',
    worldId: 'w1',
    origin: 'boot',
    usedBackup: false,
  },
  'builder.world-renamed': {
    type: 'builder.world-renamed',
    from: 'my first world',
    to: 'island one',
  },
  'builder.view-projection-changed': {
    type: 'builder.view-projection-changed',
    from: 'topdown',
    to: 'iso',
  },
}

const samplesByName: Readonly<Record<string, BuilderEvent>> = SAMPLE_EVENTS
const liveTypes: readonly string[] = BUILDER_EVENT_TYPES

// ---------------------------------------------------------------------------
// Names: additive-only
// ---------------------------------------------------------------------------

describe('the frozen names', () => {
  it('every snapshot entry is still a live event type (nothing ever removed)', () => {
    for (const name of Object.keys(FROZEN_PAYLOADS)) {
      expect(liveTypes, `'${name}' vanished from BUILDER_EVENT_TYPES — frozen events are forever`).toContain(name)
    }
  })

  it('the live list may only be LONGER than the snapshot — growth is legal, loss is not', () => {
    expect(BUILDER_EVENT_TYPES.length).toBeGreaterThanOrEqual(Object.keys(FROZEN_PAYLOADS).length)
  })

  it('the live list carries no duplicates', () => {
    expect(new Set(liveTypes).size).toBe(liveTypes.length)
  })
})

// ---------------------------------------------------------------------------
// The history: alias permanence, tripwired (D4)
// ---------------------------------------------------------------------------

describe('the event-name history', () => {
  it('every name EVER registered still resolves — live or aliased, never dead', () => {
    // The D4 promise made testable: renaming without an alias would leave
    // the old name in the history unresolvable, and this test names it.
    for (const name of BUILDER_EVENT_HISTORY) {
      expect(
        resolveBuilderEventType(name),
        `historical name '${name}' no longer resolves — a renamed event needs its BUILDER_EVENT_ALIASES entry, forever`,
      ).not.toBeNull()
    }
  })

  it('every live name appears in the history — registration is permanent', () => {
    for (const name of BUILDER_EVENT_TYPES) {
      expect(
        BUILDER_EVENT_HISTORY,
        `live event '${name}' is missing from BUILDER_EVENT_HISTORY — every registered name is recorded, append-only`,
      ).toContain(name)
    }
  })

  it('the history carries no duplicates', () => {
    expect(new Set(BUILDER_EVENT_HISTORY).size).toBe(BUILDER_EVENT_HISTORY.length)
  })
})

// ---------------------------------------------------------------------------
// Payloads: field lists frozen — and the governed registry agrees
// ---------------------------------------------------------------------------

describe('the frozen payload shapes', () => {
  it('every snapshot entry matches its sample event, field for field', () => {
    for (const [name, fields] of Object.entries(FROZEN_PAYLOADS)) {
      const sample = samplesByName[name]
      expect(sample, `no sample event for '${name}'`).toBeDefined()
      expect(sample?.type).toBe(name)
      // Comparing the SORTED keys against the literal list also proves the
      // snapshot itself is written sorted — one canonical spelling to diff.
      expect(
        [...Object.keys(sample ?? {})].sort(),
        `payload fields of '${name}' drifted from the frozen snapshot`,
      ).toEqual(fields)
    }
  })

  it('BUILDER_EVENT_PAYLOAD_FIELDS matches the snapshot exactly — the export is governed surface', () => {
    // The validator rejects lesson `where` fields against this export, so
    // it must carry precisely the frozen field lists: an entry drifting
    // from the snapshot would let the validator bless a field that does
    // not exist — or reject one that does.
    expect({ ...BUILDER_EVENT_PAYLOAD_FIELDS }).toEqual(FROZEN_PAYLOADS)
  })
})

// ---------------------------------------------------------------------------
// Payload TYPES: pinned as literal types, enforced by the package typecheck.
// `expectTypeOf(...).toEqualTypeOf<...>()` demands EXACT equality — field
// set, each field's type, optionality, and readonly all included — so any
// inexact drift in events.ts is a compile error on `tsc --noEmit` (CI),
// pointing at the pin whose contract broke. Runtime sees a no-op.
// ---------------------------------------------------------------------------

describe('the frozen payload types (compile-time pins)', () => {
  it('builder.tile-painted', () => {
    expectTypeOf<TilePaintedEvent>().toEqualTypeOf<{
      readonly type: 'builder.tile-painted'
      readonly layerId: string
      readonly tile: number
      readonly cells: ReadonlyArray<{ readonly tx: number; readonly ty: number }>
      readonly toolId: string
    }>()
  })

  it('builder.entity-placed', () => {
    expectTypeOf<EntityPlacedEvent>().toEqualTypeOf<{
      readonly type: 'builder.entity-placed'
      readonly id: string
      readonly marker: string
      readonly name: string
      readonly position: { readonly x: number; readonly y: number }
      readonly elevation: number
    }>()
  })

  it('builder.entity-moved', () => {
    expectTypeOf<EntityMovedEvent>().toEqualTypeOf<{
      readonly type: 'builder.entity-moved'
      readonly id: string
      readonly from: { readonly x: number; readonly y: number; readonly z: number }
      readonly to: { readonly x: number; readonly y: number; readonly z: number }
    }>()
  })

  it('builder.entity-renamed', () => {
    expectTypeOf<EntityRenamedEvent>().toEqualTypeOf<{
      readonly type: 'builder.entity-renamed'
      readonly id: string
      readonly from: string
      readonly to: string
    }>()
  })

  it('builder.entity-deleted', () => {
    expectTypeOf<EntityDeletedEvent>().toEqualTypeOf<{
      readonly type: 'builder.entity-deleted'
      readonly id: string
      readonly marker: string | null
      readonly name: string
    }>()
  })

  it('builder.selection-changed', () => {
    expectTypeOf<SelectionChangedEvent>().toEqualTypeOf<{
      readonly type: 'builder.selection-changed'
      readonly selection:
        | { readonly kind: 'entity'; readonly id: string }
        | { readonly kind: 'tile'; readonly tx: number; readonly ty: number; readonly layerId: string | null }
        | null
    }>()
  })

  it('builder.command-undone', () => {
    expectTypeOf<CommandUndoneEvent>().toEqualTypeOf<{
      readonly type: 'builder.command-undone'
      readonly label: string
    }>()
  })

  it('builder.command-redone', () => {
    expectTypeOf<CommandRedoneEvent>().toEqualTypeOf<{
      readonly type: 'builder.command-redone'
      readonly label: string
    }>()
  })

  it('builder.world-saved', () => {
    expectTypeOf<WorldSavedEvent>().toEqualTypeOf<{
      readonly type: 'builder.world-saved'
      readonly worldId: string
    }>()
  })

  it('builder.world-loaded', () => {
    expectTypeOf<WorldLoadedEvent>().toEqualTypeOf<{
      readonly type: 'builder.world-loaded'
      readonly worldId: string
      readonly origin: 'boot' | 'load' | 'import' | 'restore' | 'new'
      readonly usedBackup: boolean
    }>()
  })

  it('builder.world-renamed', () => {
    expectTypeOf<WorldRenamedEvent>().toEqualTypeOf<{
      readonly type: 'builder.world-renamed'
      readonly from: string
      readonly to: string
    }>()
  })

  it('builder.view-projection-changed', () => {
    expectTypeOf<ViewProjectionChangedEvent>().toEqualTypeOf<{
      readonly type: 'builder.view-projection-changed'
      readonly from: 'profile' | 'topdown' | 'iso'
      readonly to: 'profile' | 'topdown' | 'iso'
    }>()
  })
})

// ---------------------------------------------------------------------------
// Aliases: forwarding without shadowing
// ---------------------------------------------------------------------------

describe('the alias table', () => {
  it('every alias key resolves to a live type and never shadows one', () => {
    for (const [oldName, target] of Object.entries(BUILDER_EVENT_ALIASES)) {
      expect(liveTypes, `alias '${oldName}' points at dead type '${target}'`).toContain(target)
      expect(liveTypes, `alias '${oldName}' shadows a live type — a name is live or aliased, never both`).not.toContain(
        oldName,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// Resolution: live names, aliases, junk
// ---------------------------------------------------------------------------

describe('resolveBuilderEventType', () => {
  it('resolves every live name to itself', () => {
    for (const name of BUILDER_EVENT_TYPES) {
      expect(isBuilderEventType(name)).toBe(true)
      expect(resolveBuilderEventType(name)).toBe(name)
    }
  })

  it('resolves every alias to its live target', () => {
    for (const [oldName, target] of Object.entries(BUILDER_EVENT_ALIASES)) {
      expect(resolveBuilderEventType(oldName)).toBe(target)
    }
    // The table is empty at the freeze, so also prove the mechanism with an
    // injected entry (type-level readonly, so a local cast; cleaned up).
    const aliases = BUILDER_EVENT_ALIASES as Record<string, BuilderEventType>
    aliases['builder.tiles-painted'] = 'builder.tile-painted'
    try {
      expect(resolveBuilderEventType('builder.tiles-painted')).toBe('builder.tile-painted')
      expect(isBuilderEventType('builder.tiles-painted')).toBe(false)
    } finally {
      delete aliases['builder.tiles-painted']
    }
  })

  it('returns null for anything else', () => {
    expect(resolveBuilderEventType('builder.panel-opened')).toBeNull()
    expect(resolveBuilderEventType('tinkerer.vector-dragged')).toBeNull()
    expect(resolveBuilderEventType('')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The emitter's containment promise
// ---------------------------------------------------------------------------

describe('createBuilderEmitter containment', () => {
  it('a throwing listener does not starve the others, and the emit survives', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const emitter = createBuilderEmitter()
      const received: string[] = []
      emitter.on(() => {
        throw new Error('broken lesson panel')
      })
      emitter.on((event) => received.push(event.type))
      expect(() => emitter.emit(SAMPLE_EVENTS['builder.world-saved'])).not.toThrow()
      expect(received).toEqual(['builder.world-saved'])
      // Reported, not swallowed silently — and never rethrown into the app.
      expect(errorSpy).toHaveBeenCalledTimes(1)
    } finally {
      errorSpy.mockRestore()
    }
  })
})
