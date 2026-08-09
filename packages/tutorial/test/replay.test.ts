import { describe, expect, it } from 'vitest'
import { createWorld, spawn } from '@engine/core'
import type { TileLayer, World } from '@engine/core'
import type { BuilderEvent } from '../src/events'
import { replayLesson } from '../src/replay'
import type { ReplayAction, ReplayHost } from '../src/replay'
import type { Lesson, StepEffect } from '../src/types'

// Layers are hand-rolled literals — no @engine/tilemap in this package.
function makeLayer(): TileLayer {
  const width = 8
  const height = 8
  return {
    id: 'ground',
    name: 'ground',
    width,
    height,
    elevation: 0,
    layerBand: 0,
    tilesetId: 'ts',
    cells: new Uint16Array(width * height),
  }
}

function makeDoc(): World {
  const world = createWorld()
  world.layers.push(makeLayer())
  return world
}

function groundLayer(doc: World): TileLayer {
  const layer = doc.layers[0]
  if (layer === undefined) throw new Error('replay doc has no ground layer')
  return layer
}

function makeHost(doc: World): { host: ReplayHost; effects: StepEffect[]; fixturesLoaded: string[] } {
  const effects: StepEffect[] = []
  const fixturesLoaded: string[] = []
  const host: ReplayHost = {
    doc: () => doc,
    applyEffect(effect) {
      effects.push(effect)
    },
    loadFixture(fixtureId) {
      fixturesLoaded.push(fixtureId)
      return true
    },
  }
  return { host, effects, fixturesLoaded }
}

// The lesson under replay: a world-predicate step, an event step, another
// world-predicate step — the three shapes a corpus script must drive.
const lesson: Lesson = {
  id: 'replay-me',
  title: 'Replay me',
  arc: 'coordinates',
  steps: [
    {
      id: 'paint-water',
      title: 'Paint water at (2, 3)',
      instruction: 'Paint the cell.',
      hints: ['Use the brush.'],
      completion: { kind: 'tile-at', tx: 2, ty: 3, tile: 2 },
    },
    {
      id: 'save-world',
      title: 'Save',
      instruction: 'Save your world.',
      hints: ['The save button.'],
      completion: { kind: 'event', type: 'builder.world-saved' },
    },
    {
      id: 'place-crate',
      title: 'Place a crate',
      instruction: 'Add a crate marker.',
      hints: ['Entity palette.'],
      completion: { kind: 'entity-exists', marker: 'crate' },
    },
  ],
}

// Corpus convention: mutate first (what the editor DID), then the event
// announcing it (what the editor SAID) — the editor's own order.
const paintThenAnnounce: ReplayAction[] = [
  {
    kind: 'mutate',
    mutate(doc) {
      const layer = groundLayer(doc)
      layer.cells[3 * layer.width + 2] = 2
    },
  },
  {
    kind: 'event',
    event: {
      type: 'builder.tile-painted',
      layerId: 'ground',
      tile: 2,
      cells: [{ tx: 2, ty: 3 }],
      toolId: 'brush',
    },
  },
]

const saveAction: ReplayAction = {
  kind: 'event',
  event: { type: 'builder.world-saved', worldId: 'w1' },
}

const placeCrateActions: ReplayAction[] = [
  {
    kind: 'mutate',
    mutate(doc) {
      spawn(doc, { components: { marker: { kind: 'crate' }, position: { x: 1, y: 1 } } })
    },
  },
  {
    kind: 'event',
    event: {
      type: 'builder.entity-placed',
      id: 'e1',
      marker: 'crate',
      name: 'crate',
      position: { x: 1, y: 1 },
      elevation: 0,
    } satisfies BuilderEvent,
  },
]

describe('replayLesson', () => {
  it('completes the lesson under a correct script', () => {
    const { host } = makeHost(makeDoc())
    const result = replayLesson({
      lesson,
      host,
      script: [...paintThenAnnounce, saveAction, ...placeCrateActions],
    })
    expect(result).toEqual({ completed: true, stepsCompleted: 3, stuckAt: null })
  })

  it('reports stuckAt honestly under an incomplete script', () => {
    const { host } = makeHost(makeDoc())
    const result = replayLesson({ lesson, host, script: paintThenAnnounce })
    expect(result).toEqual({ completed: false, stepsCompleted: 1, stuckAt: 'save-world' })
  })

  it('reports the first step under an empty script', () => {
    const { host } = makeHost(makeDoc())
    const result = replayLesson({ lesson, host, script: [] })
    expect(result).toEqual({ completed: false, stepsCompleted: 0, stuckAt: 'paint-water' })
  })

  it('a mutation without its announcing event does not advance a world-predicate step — the corpus must pair them', () => {
    const { host } = makeHost(makeDoc())
    const [paintOnly] = paintThenAnnounce
    if (paintOnly === undefined) throw new Error('script fixture is empty')
    const result = replayLesson({ lesson, host, script: [paintOnly] })
    expect(result).toEqual({ completed: false, stepsCompleted: 0, stuckAt: 'paint-water' })
  })

  it('a wrong event does not advance an event step', () => {
    const { host } = makeHost(makeDoc())
    const result = replayLesson({
      lesson,
      host,
      script: [
        ...paintThenAnnounce,
        { kind: 'event', event: { type: 'builder.world-renamed', from: 'a', to: 'b' } },
      ],
    })
    expect(result).toEqual({ completed: false, stepsCompleted: 1, stuckAt: 'save-world' })
  })

  it('counts steps the document already satisfies (auto-advance runs inside the real engine)', () => {
    const doc = makeDoc()
    const layer = groundLayer(doc)
    layer.cells[3 * layer.width + 2] = 2 // pre-satisfy step 0
    const { host } = makeHost(doc)
    const result = replayLesson({ lesson, host, script: [saveAction, ...placeCrateActions] })
    expect(result).toEqual({ completed: true, stepsCompleted: 3, stuckAt: null })
  })

  it('loads a declared fixture through the provided host', () => {
    const { host, fixturesLoaded } = makeHost(makeDoc())
    const withFixture: Lesson = { ...lesson, fixture: 'showcase-island' }
    replayLesson({ lesson: withFixture, host, script: [] })
    expect(fixturesLoaded).toEqual(['showcase-island'])
  })

  it('applies step effects through the provided host as the lesson advances', () => {
    const { host, effects } = makeHost(makeDoc())
    const overlay: StepEffect = {
      kind: 'show-overlays',
      overlays: [{ kind: 'cell-highlight', tx: 2, ty: 3 }],
    }
    const withEffects: Lesson = {
      ...lesson,
      steps: lesson.steps.map((step, index) => (index === 0 ? { ...step, onEnter: [overlay] } : step)),
    }
    replayLesson({ lesson: withEffects, host, script: [] })
    // The machine's start-time clean stage (overlays cleared, lens home)
    // arrives first; the entered step's own effect follows.
    expect(effects).toEqual([
      { kind: 'show-overlays', overlays: [] },
      { kind: 'set-view-projection', projection: null },
      overlay,
    ])
  })

  it('every replay is a fresh student — progress never bleeds between runs', () => {
    const firstDoc = makeDoc()
    const first = replayLesson({ lesson, host: makeHost(firstDoc).host, script: paintThenAnnounce })
    expect(first.stepsCompleted).toBe(1)
    // A second run over a fresh doc starts from nothing — were progress
    // shared, it would resume at 'save-world' and report differently.
    const second = replayLesson({ lesson, host: makeHost(makeDoc()).host, script: [] })
    expect(second).toEqual({ completed: false, stepsCompleted: 0, stuckAt: 'paint-water' })
  })

  it('is deterministic: the same lesson, doc, and script report identically on every run', () => {
    const script = [...paintThenAnnounce, saveAction, ...placeCrateActions]
    const a = replayLesson({ lesson, host: makeHost(makeDoc()).host, script })
    const b = replayLesson({ lesson, host: makeHost(makeDoc()).host, script })
    expect(a).toEqual(b)
  })
})
