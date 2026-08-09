/**
 * The lesson harness's draft semantics, pinned — plus the cross-check
 * promised to content/lessons/test/lessons.test.ts: that package validates
 * its event predicates against a LOCAL vocabulary list (it cannot import
 * the editor), and THIS file holds the local list's feet to the fire by
 * checking every shipped predicate against the editor's real BuilderEvent
 * union, with a type-level exhaustiveness guard so neither list can rot.
 */

import { describe, expect, it } from 'vitest'
import { createWorld, spawn } from '@engine/core'
import type { World } from '@engine/core'
import { lessons } from '@content/lessons'
import type { LessonDraft } from '@content/lessons'
import { createLessonHarness } from '../src/editor/lesson/harness'
import type { LessonHarnessHost } from '../src/editor/lesson/harness'
import { BUILDER_EVENT_ALIASES } from '../src/editor/events/builder'
import type { BuilderEvent, BuilderEventType, TilePaintedEvent } from '../src/editor/events/builder'
import type { LessonUiState } from '../src/editor/types'

// ---------------------------------------------------------------------------
// Fixtures: a starter-like world and a hand-rolled host
// ---------------------------------------------------------------------------

/** A world shaped like the StarterWorld contract (types.ts): one 32×24
 * 'ground' layer of grass (cell value 1) and a player marker entity. */
function starterLikeWorld(): World {
  const world = createWorld({ name: 'my first world', settings: { seed: 7 } })
  world.tilesets.push({
    id: 'terrain',
    name: 'terrain',
    tiles: [
      { name: 'grass', colors: { top: '#59a648' } },
      { name: 'water', colors: { top: '#3a79c9' } },
      { name: 'sand', colors: { top: '#d8c26a' } },
    ],
  })
  world.layers.push({
    id: 'ground',
    name: 'ground',
    width: 32,
    height: 24,
    elevation: 0,
    layerBand: 0,
    tilesetId: 'terrain',
    cells: new Uint16Array(32 * 24).fill(1),
  })
  spawn(world, { name: 'player', components: { marker: { kind: 'player' }, position: { x: 16, y: 12 } } })
  return world
}

/** The ~15-line host the harness header promises tests can build: a plain
 * listener set, a mutable world, and a publish log. */
function makeHost(world: World) {
  const listeners = new Set<(event: BuilderEvent) => void>()
  const published: Array<LessonUiState | null> = []
  const host: LessonHarnessHost = {
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    doc: () => world,
    publish(state) {
      published.push(state)
    },
  }
  const emit = (event: BuilderEvent): void => {
    for (const listener of [...listeners]) listener(event)
  }
  const last = (): LessonUiState | null => {
    const state = published[published.length - 1]
    if (state === undefined) throw new Error('nothing published yet')
    return state
  }
  return { host, emit, published, last, listeners }
}

const paintEvent = (cells: TilePaintedEvent['cells'] = [{ tx: 0, ty: 0 }]): BuilderEvent => ({
  type: 'builder.tile-painted',
  layerId: 'ground',
  tile: 1,
  cells,
  toolId: 'brush',
})

const saveEvent: BuilderEvent = { type: 'builder.world-saved', worldId: 'w7' }

const selectionClearedEvent: BuilderEvent = { type: 'builder.selection-changed', selection: null }

/** A compact lesson exercising every predicate kind. */
const fixtureLesson: LessonDraft = {
  id: 'fixture',
  title: 'Fixture lesson',
  steps: [
    {
      id: 'paint-anything',
      title: 'Paint',
      instruction: 'Paint any tile.',
      hint: 'Any tile at all.',
      completion: { kind: 'event', type: 'builder.tile-painted' },
    },
    {
      id: 'water-at-5-4',
      title: 'Water',
      instruction: 'Water at (5, 4).',
      hint: 'Watch the coordinates.',
      completion: { kind: 'tile-at', tx: 5, ty: 4, tile: 2, layerId: 'ground' },
    },
    {
      id: 'crate-exists',
      title: 'Crate',
      instruction: 'Place a crate.',
      hint: 'Use the placer.',
      completion: { kind: 'entity-exists', marker: 'crate' },
    },
    {
      id: 'save',
      title: 'Save',
      instruction: 'Save your world.',
      hint: 'The Save button.',
      completion: { kind: 'event', type: 'builder.world-saved' },
    },
  ],
}

function paintWaterAt(world: World, tx: number, ty: number): void {
  const ground = world.layers[0]
  if (ground === undefined) throw new Error('fixture world lost its ground layer')
  ground.cells[ty * ground.width + tx] = 2
}

// ---------------------------------------------------------------------------
// Boot and stepping
// ---------------------------------------------------------------------------

describe('boot', () => {
  it('starts at step 0 on a fresh starter-like world and publishes once', () => {
    const { host, published, last } = makeHost(starterLikeWorld())
    createLessonHarness(host, [fixtureLesson])
    expect(published).toHaveLength(1)
    expect(last()).toEqual({
      lessonId: 'fixture',
      title: 'Fixture lesson',
      stepIndex: 0,
      stepCount: 4,
      instruction: 'Paint any tile.',
      hint: 'Any tile at all.',
      done: false,
    })
  })

  it('publishes null for an empty lesson array (the rail hides)', () => {
    const { host, published } = makeHost(starterLikeWorld())
    createLessonHarness(host, [])
    expect(published).toEqual([null])
  })

  it('shows only the FIRST lesson — v1 semantics', () => {
    const other: LessonDraft = { ...fixtureLesson, id: 'second', title: 'Second' }
    const { host, last } = makeHost(starterLikeWorld())
    createLessonHarness(host, [fixtureLesson, other])
    expect(last()?.lessonId).toBe('fixture')
  })

  it('skips consecutive world-state steps already satisfied at construction, in one go', () => {
    const world = starterLikeWorld()
    paintWaterAt(world, 5, 4)
    spawn(world, { name: 'crate', components: { marker: { kind: 'crate' } } })
    const worldFirstLesson: LessonDraft = {
      ...fixtureLesson,
      // Both world-state steps up front: a reopened half-built world resumes.
      steps: [fixtureLesson.steps[1]!, fixtureLesson.steps[2]!, fixtureLesson.steps[0]!, fixtureLesson.steps[3]!],
    }
    const { host, published, last } = makeHost(world)
    createLessonHarness(host, [worldFirstLesson])
    expect(published).toHaveLength(1) // one publish, not one per skipped step
    expect(last()?.stepIndex).toBe(2)
    expect(last()?.instruction).toBe('Paint any tile.')
  })

  it('event predicates are never pre-satisfied at construction', () => {
    const { host, last } = makeHost(starterLikeWorld())
    createLessonHarness(host, [fixtureLesson])
    expect(last()?.stepIndex).toBe(0)
  })
})

describe('advancing on events', () => {
  it('a tile-painted event advances the event step', () => {
    const { host, emit, last } = makeHost(starterLikeWorld())
    createLessonHarness(host, [fixtureLesson])
    emit(paintEvent())
    expect(last()?.stepIndex).toBe(1)
    expect(last()?.instruction).toBe('Water at (5, 4).')
  })

  it('a non-matching event neither advances nor re-publishes', () => {
    const { host, emit, published } = makeHost(starterLikeWorld())
    createLessonHarness(host, [fixtureLesson])
    emit(saveEvent) // step 0 wants tile-painted
    expect(published).toHaveLength(1)
  })

  it('a tile-at step satisfied by doc mutation advances on ANY next event', () => {
    const world = starterLikeWorld()
    const { host, emit, last } = makeHost(world)
    createLessonHarness(host, [fixtureLesson])
    emit(paintEvent()) // past step 0
    paintWaterAt(world, 5, 4) // the world now proves step 1…
    emit(selectionClearedEvent) // …and any event triggers the re-check
    expect(last()?.stepIndex).toBe(2)
  })

  it('an entity-exists step advances once the marker entity is in the doc', () => {
    const world = starterLikeWorld()
    paintWaterAt(world, 5, 4)
    const { host, emit, last } = makeHost(world)
    createLessonHarness(host, [fixtureLesson])
    emit(paintEvent()) // steps 0 done by event, 1 already true → lands on 2
    expect(last()?.stepIndex).toBe(2)
    spawn(world, { name: 'crate', components: { marker: { kind: 'crate' } } })
    emit(selectionClearedEvent)
    expect(last()?.stepIndex).toBe(3)
  })

  it('one event never satisfies two event steps — two paints for two paint steps', () => {
    const doublePaint: LessonDraft = {
      ...fixtureLesson,
      steps: [fixtureLesson.steps[0]!, { ...fixtureLesson.steps[0]!, id: 'paint-again' }],
    }
    const { host, emit, last } = makeHost(starterLikeWorld())
    createLessonHarness(host, [doublePaint])
    emit(paintEvent())
    expect(last()?.stepIndex).toBe(1)
    expect(last()?.done).toBe(false)
    emit(paintEvent())
    expect(last()?.done).toBe(true)
  })

  it('the save event finishes the lesson: done=true, stepIndex past the end, empty instruction', () => {
    const world = starterLikeWorld()
    paintWaterAt(world, 5, 4)
    spawn(world, { name: 'crate', components: { marker: { kind: 'crate' } } })
    const { host, emit, last } = makeHost(world)
    createLessonHarness(host, [fixtureLesson])
    emit(paintEvent()) // 0 by event; 1 and 2 already true → step 3
    expect(last()?.stepIndex).toBe(3)
    emit(saveEvent)
    expect(last()).toEqual({
      lessonId: 'fixture',
      title: 'Fixture lesson',
      stepIndex: 4,
      stepCount: 4,
      instruction: '',
      hint: null,
      done: true,
    })
  })
})

describe('alias resolution (D4: old names keep working forever)', () => {
  it('an event predicate written with an aliased old name matches the new event type', () => {
    // The real table is empty until the Phase 3 freeze — inject a fake alias
    // through a local cast for this test only, and clean it up.
    const aliases = BUILDER_EVENT_ALIASES as Record<string, BuilderEventType>
    aliases['builder.tiles-painted'] = 'builder.tile-painted'
    try {
      const legacyLesson: LessonDraft = {
        id: 'legacy',
        title: 'Legacy',
        steps: [
          {
            id: 'old-name',
            title: 'Paint',
            instruction: 'Paint.',
            hint: 'Paint.',
            completion: { kind: 'event', type: 'builder.tiles-painted' },
          },
        ],
      }
      const { host, emit, last } = makeHost(starterLikeWorld())
      createLessonHarness(host, [legacyLesson])
      emit(paintEvent())
      expect(last()?.done).toBe(true)
    } finally {
      delete aliases['builder.tiles-painted']
    }
  })
})

describe('reload — the hot-reload path', () => {
  it('re-derives the current step from scratch against the live doc when steps reorder', () => {
    const world = starterLikeWorld()
    paintWaterAt(world, 5, 4)
    const { host, last } = makeHost(world)
    const harness = createLessonHarness(host, [fixtureLesson])
    expect(last()?.stepIndex).toBe(0)
    // The author drags the (already-true) tile-at step to the front and saves.
    const reordered: LessonDraft = {
      ...fixtureLesson,
      steps: [fixtureLesson.steps[1]!, fixtureLesson.steps[0]!, fixtureLesson.steps[2]!, fixtureLesson.steps[3]!],
    }
    harness.reload([reordered])
    expect(last()?.stepIndex).toBe(1)
    expect(last()?.instruction).toBe('Paint any tile.')
  })

  it('forgets event-predicate progress — documented draft semantics', () => {
    const { host, emit, last } = makeHost(starterLikeWorld())
    const harness = createLessonHarness(host, [fixtureLesson])
    emit(paintEvent())
    expect(last()?.stepIndex).toBe(1)
    harness.reload([fixtureLesson]) // same data: the paint moment is gone
    expect(last()?.stepIndex).toBe(0)
  })

  it('reload to an empty array publishes null; a later reload revives the rail', () => {
    const { host, last } = makeHost(starterLikeWorld())
    const harness = createLessonHarness(host, [fixtureLesson])
    harness.reload([])
    expect(last()).toBeNull()
    harness.reload([fixtureLesson])
    expect(last()?.stepIndex).toBe(0)
  })
})

describe('dispose', () => {
  it('unsubscribes and publishes null', () => {
    const { host, emit, published, listeners } = makeHost(starterLikeWorld())
    const harness = createLessonHarness(host, [fixtureLesson])
    harness.dispose()
    expect(published[published.length - 1]).toBeNull()
    expect(listeners.size).toBe(0)
    const count = published.length
    emit(paintEvent())
    expect(published).toHaveLength(count) // deaf after dispose
  })

  it('is idempotent — a second dispose does nothing', () => {
    const { host, published } = makeHost(starterLikeWorld())
    const harness = createLessonHarness(host, [fixtureLesson])
    harness.dispose()
    const count = published.length
    harness.dispose()
    expect(published).toHaveLength(count)
  })
})

// ---------------------------------------------------------------------------
// The cross-check promised to content/lessons/test/lessons.test.ts
// ---------------------------------------------------------------------------

describe('shipped lesson data vs the real builder.* vocabulary', () => {
  // Every member of the BuilderEvent union, as a value list. The `satisfies`
  // clause rejects typos and strangers; the NoMissing check below rejects
  // omissions — add a BuilderEvent variant without listing it here and the
  // app typecheck fails, so this list cannot silently rot.
  const ALL_BUILDER_EVENT_TYPES = [
    'builder.tile-painted',
    'builder.entity-placed',
    'builder.entity-moved',
    'builder.entity-renamed',
    'builder.entity-deleted',
    'builder.selection-changed',
    'builder.command-undone',
    'builder.command-redone',
    'builder.world-saved',
    'builder.world-loaded',
    'builder.world-renamed',
  ] as const satisfies readonly BuilderEventType[]

  type NoMissing = [Exclude<BuilderEventType, (typeof ALL_BUILDER_EVENT_TYPES)[number]>] extends [never]
    ? true
    : false

  it('the literal list is exhaustive (type-level check made visible)', () => {
    const listIsExhaustive: NoMissing = true
    expect(listIsExhaustive).toBe(true)
  })

  it('every event predicate in shipped lessons names a real BuilderEventType', () => {
    const known: readonly string[] = ALL_BUILDER_EVENT_TYPES
    expect(lessons.length).toBeGreaterThan(0)
    for (const lesson of lessons) {
      for (const step of lesson.steps) {
        if (step.completion.kind !== 'event') continue
        expect(known, `${lesson.id}/${step.id}: '${step.completion.type}' is not a builder event`).toContain(
          step.completion.type,
        )
      }
    }
  })

  it('no shipped lesson leans on an alias — pre-freeze, every name is a current name', () => {
    for (const lesson of lessons) {
      for (const step of lesson.steps) {
        if (step.completion.kind !== 'event') continue
        expect(
          BUILDER_EVENT_ALIASES[step.completion.type],
          `${lesson.id}/${step.id}: aliased names may only appear in lesson data after the Phase 3 freeze`,
        ).toBeUndefined()
      }
    }
  })
})
