import { describe, expect, it } from 'vitest'
import { createWorld } from '@engine/core'
import type { TileLayer, World } from '@engine/core'
import type { BuilderEvent } from '../src/events'
import { createTutorialEngine } from '../src/machine'
import type {
  Lesson,
  LessonStep,
  StepEffect,
  StepPredicate,
  TutorialHost,
  TutorialProgress,
  TutorialUiState,
} from '../src/types'

// --------------------------------------------------------------------------
// Rig: an in-memory TutorialHost that records everything the engine does.
// Layers are hand-rolled literals — no @engine/tilemap in this package.
// --------------------------------------------------------------------------

function makeLayer(set: ReadonlyArray<readonly [number, number, number]> = []): TileLayer {
  const width = 8
  const height = 8
  const cells = new Uint16Array(width * height)
  for (const [tx, ty, tile] of set) cells[ty * width + tx] = tile
  return { id: 'ground', name: 'ground', width, height, elevation: 0, layerBand: 0, tilesetId: 'ts', cells }
}

function docWithLayer(set: ReadonlyArray<readonly [number, number, number]> = []): World {
  const world = createWorld()
  world.layers.push(makeLayer(set))
  return world
}

interface Rig {
  host: TutorialHost
  emit(event: BuilderEvent): void
  published: Array<TutorialUiState | null>
  effects: StepEffect[]
  fixturesLoaded: string[]
  store: { value: TutorialProgress | null }
  listenerCount(): number
}

function makeRig(doc: World, opts: { knownFixtures?: string[]; progress?: TutorialProgress | null } = {}): Rig {
  const listeners = new Set<(event: BuilderEvent) => void>()
  const store = { value: opts.progress ?? null }
  const published: Array<TutorialUiState | null> = []
  const effects: StepEffect[] = []
  const fixturesLoaded: string[] = []
  const known = new Set(opts.knownFixtures ?? [])
  const host: TutorialHost = {
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    doc: () => doc,
    applyEffect(effect) {
      effects.push(effect)
    },
    loadFixture(fixtureId) {
      fixturesLoaded.push(fixtureId)
      return known.has(fixtureId)
    },
    progress: {
      read: () => store.value,
      write(progress) {
        store.value = progress
      },
      clear() {
        store.value = null
      },
    },
    publish(state) {
      published.push(state)
    },
  }
  return {
    host,
    emit(event) {
      for (const listener of [...listeners]) listener(event)
    },
    published,
    effects,
    fixturesLoaded,
    store,
    listenerCount: () => listeners.size,
  }
}

function lastState(rig: Rig): TutorialUiState {
  const last = rig.published.at(-1)
  if (last === undefined || last === null) throw new Error('expected a published TutorialUiState')
  return last
}

// Step/lesson builders. Every step ships two hints (the contract demands at
// least one; two lets the reveal ladder be observed).
function step(id: string, completion: StepPredicate, extra: Partial<LessonStep> = {}): LessonStep {
  return {
    id,
    title: `title of ${id}`,
    instruction: `do ${id}`,
    hints: [`${id} hint one`, `${id} hint two`],
    completion,
    ...extra,
  }
}

function makeLesson(id: string, steps: LessonStep[], extra: Partial<Lesson> = {}): Lesson {
  return { id, title: `Lesson ${id}`, arc: 'coordinates', steps, ...extra }
}

// Handy predicates and events.
const tileAt = (tx: number, ty: number): StepPredicate => ({ kind: 'tile-at', tx, ty })
const onSaved: StepPredicate = { kind: 'event', type: 'builder.world-saved' }
const savedEvent: BuilderEvent = { type: 'builder.world-saved', worldId: 'w1' }
const paintedEvent = (tile: number): BuilderEvent => ({
  type: 'builder.tile-painted',
  layerId: 'ground',
  tile,
  cells: [{ tx: 0, ty: 0 }],
  toolId: 'brush',
})
const overlayEffect = (label: string): StepEffect => ({
  kind: 'show-overlays',
  overlays: [{ kind: 'cell-highlight', tx: 0, ty: 0, label }],
})

/** The machine's clean-stage pair (machine.ts CLEAN_STAGE): applied at
 * start (before fixture/step effects) and on reaching done. */
const cleanStage: readonly StepEffect[] = [
  { kind: 'show-overlays', overlays: [] },
  { kind: 'set-view-projection', projection: null },
]

describe('start', () => {
  it('publishes step 0 with the full UI state and persists the position', () => {
    const rig = makeRig(docWithLayer())
    const lesson = makeLesson('first', [step('paint', onSaved)])
    createTutorialEngine(rig.host, [lesson]).start('first')

    expect(rig.published).toHaveLength(1)
    expect(lastState(rig)).toEqual({
      lessonId: 'first',
      arc: 'coordinates',
      title: 'Lesson first',
      stepId: 'paint',
      stepIndex: 0,
      stepCount: 1,
      stepTitle: 'title of paint',
      instruction: 'do paint',
      hints: [],
      hintsRemaining: 2,
      target: null,
      done: false,
    })
    expect(rig.store.value).toEqual({ lessonId: 'first', stepIndex: 0, stepId: 'paint', revealedHints: 0 })
  })

  it('applies the entered step onEnter effects in authored order, after the clean stage', () => {
    const rig = makeRig(docWithLayer())
    const effects: StepEffect[] = [{ kind: 'set-view-projection', projection: 'topdown' }, overlayEffect('here')]
    const lesson = makeLesson('fx', [step('setup', onSaved, { onEnter: effects })])
    createTutorialEngine(rig.host, [lesson]).start('fx')
    expect(rig.effects).toEqual([...cleanStage, ...effects])
  })

  it('begins on a CLEAN stage: clears overlays and the lens before the fixture and the step effects', () => {
    // The interleaving is the point: the sweep must land before the fixture
    // swap and before the entered step paints, so the trace records both
    // channels in one stream.
    const rig = makeRig(docWithLayer(), { knownFixtures: ['isle'] })
    const trace: string[] = []
    const tracingHost: TutorialHost = {
      ...rig.host,
      applyEffect(effect) {
        trace.push(`effect:${effect.kind}`)
        rig.host.applyEffect(effect)
      },
      loadFixture(fixtureId) {
        trace.push(`fixture:${fixtureId}`)
        return rig.host.loadFixture(fixtureId)
      },
    }
    const lesson = makeLesson('staged', [step('look', onSaved, { onEnter: [overlayEffect('look')] })], {
      fixture: 'isle',
    })
    createTutorialEngine(tracingHost, [lesson]).start('staged')
    expect(trace).toEqual([
      'effect:show-overlays', // clean stage: overlays cleared…
      'effect:set-view-projection', // …and the lens returned to primary…
      'fixture:isle', // …BEFORE the fixture swaps the document…
      'effect:show-overlays', // …and the entered step paints its own picture
    ])
    expect(rig.effects).toEqual([...cleanStage, overlayEffect('look')])
  })

  it('loads the lesson fixture through the host', () => {
    const rig = makeRig(docWithLayer(), { knownFixtures: ['showcase-island'] })
    const lesson = makeLesson('reveal', [step('look', onSaved)], { fixture: 'showcase-island' })
    createTutorialEngine(rig.host, [lesson]).start('reveal')
    expect(rig.fixturesLoaded).toEqual(['showcase-island'])
    expect(lastState(rig).stepId).toBe('look')
  })

  it('proceeds on the current world when the fixture id is unknown to the host', () => {
    const rig = makeRig(docWithLayer()) // knows no fixtures: loadFixture returns false
    const lesson = makeLesson('reveal', [step('look', onSaved)], { fixture: 'missing-island' })
    createTutorialEngine(rig.host, [lesson]).start('reveal')
    expect(rig.fixturesLoaded).toEqual(['missing-island'])
    expect(lastState(rig).stepId).toBe('look') // lesson runs anyway
  })

  it('publishes null and idles for an unknown lesson id', () => {
    const rig = makeRig(docWithLayer())
    createTutorialEngine(rig.host, [makeLesson('real', [step('s', onSaved)])]).start('imaginary')
    expect(rig.published).toEqual([null])
    rig.emit(savedEvent)
    expect(rig.published).toEqual([null]) // still idle — events fall through
  })

  it('sweeps the stage before idling on an unknown lesson id — the rail shows nothing, and so does the stage', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [
      makeLesson('real', [step('s', onSaved, { onEnter: [overlayEffect('s')] })]),
    ])
    engine.start('real') // paints the step's overlay
    const before = rig.effects.length
    engine.start('imaginary')
    expect(rig.published.at(-1)).toBeNull()
    // The abandoned lesson's decorations went with it.
    expect(rig.effects.slice(before)).toEqual([...cleanStage])
  })

  it('publishes the current step target, and null when the step declares none', () => {
    const rig = makeRig(docWithLayer())
    const lesson = makeLesson('t', [
      step('point-at-save', onSaved, { target: { kind: 'anchor', anchor: 'toolbar.save' } }),
      step('no-target', onSaved),
    ])
    createTutorialEngine(rig.host, [lesson]).start('t')
    expect(lastState(rig).target).toEqual({ kind: 'anchor', anchor: 'toolbar.save' })
    rig.emit(savedEvent)
    expect(lastState(rig).target).toBeNull() // the step declares none
    rig.emit(savedEvent)
    expect(lastState(rig).done).toBe(true)
    expect(lastState(rig).target).toBeNull() // done points at nothing
  })

  it('starting another lesson replaces the running one (one lesson at a time)', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [
      makeLesson('a', [step('a-one', onSaved)]),
      makeLesson('b', [step('b-one', onSaved)]),
    ])
    engine.start('a')
    engine.start('b')
    expect(lastState(rig).lessonId).toBe('b')
    expect(rig.store.value?.lessonId).toBe('b')
  })
})

describe('resume from stored progress', () => {
  it('a fresh engine over a prefilled ProgressStore lands on the stored step with its hints', () => {
    const rig = makeRig(docWithLayer(), {
      progress: { lessonId: 'lesson', stepIndex: 1, revealedHints: 1 },
    })
    const lesson = makeLesson('lesson', [
      step('one', onSaved),
      step('two', onSaved, { onEnter: [overlayEffect('two')] }),
      step('three', onSaved),
    ])
    createTutorialEngine(rig.host, [lesson]).start('lesson')

    const state = lastState(rig)
    expect(state.stepId).toBe('two')
    expect(state.stepIndex).toBe(1)
    expect(state.hints).toEqual(['two hint one']) // revealed prefix survives reload
    expect(state.hintsRemaining).toBe(1)
    // Resuming ENTERS the stored step: its effects are re-applied (the view
    // lens and overlays did not survive the page reload) — after the
    // clean-stage sweep every start performs.
    expect(rig.effects).toEqual([...cleanStage, overlayEffect('two')])
  })

  it('clamps a stored stepIndex past the end to done, and stored hints into the step range', () => {
    const rig = makeRig(docWithLayer(), {
      progress: { lessonId: 'lesson', stepIndex: 99, revealedHints: 5 },
    })
    const lesson = makeLesson('lesson', [step('only', onSaved)])
    createTutorialEngine(rig.host, [lesson]).start('lesson')
    expect(lastState(rig).done).toBe(true)
    expect(rig.store.value).toEqual({ lessonId: 'lesson', stepIndex: 1, revealedHints: 0 })

    const rig2 = makeRig(docWithLayer(), {
      progress: { lessonId: 'lesson', stepIndex: 0, revealedHints: 99 },
    })
    createTutorialEngine(rig2.host, [lesson]).start('lesson')
    expect(lastState(rig2).hints).toEqual(['only hint one', 'only hint two']) // clamped to what exists
  })

  it('resumes by stored step ID first: an inserted step shifts indices, never the student', () => {
    // The student left on 'two' (then index 1); the catalogue update
    // inserted a step before it. Index-only resume would strand them on
    // 'one' — the id lands them back on the SAME step.
    const rig = makeRig(docWithLayer(), {
      progress: { lessonId: 'lesson', stepIndex: 1, stepId: 'two', revealedHints: 1 },
    })
    const edited = makeLesson('lesson', [
      step('zero', onSaved), // inserted since the student left
      step('one', onSaved),
      step('two', onSaved),
    ])
    createTutorialEngine(rig.host, [edited]).start('lesson')
    const state = lastState(rig)
    expect(state.stepId).toBe('two') // same step, NEW index
    expect(state.stepIndex).toBe(2)
    expect(state.hints).toEqual(['two hint one'])
    expect(rig.store.value).toEqual({ lessonId: 'lesson', stepIndex: 2, stepId: 'two', revealedHints: 1 })
  })

  it('legacy bytes without a stepId still resume by clamped index', () => {
    const rig = makeRig(docWithLayer(), {
      progress: { lessonId: 'lesson', stepIndex: 1, revealedHints: 0 }, // pre-stepId bytes
    })
    const lesson = makeLesson('lesson', [step('one', onSaved), step('two', onSaved)])
    createTutorialEngine(rig.host, [lesson]).start('lesson')
    expect(lastState(rig).stepId).toBe('two')
    expect(lastState(rig).stepIndex).toBe(1)
  })

  it('falls back to the clamped index when the stored stepId vanished from the lesson', () => {
    const rig = makeRig(docWithLayer(), {
      progress: { lessonId: 'lesson', stepIndex: 1, stepId: 'gone', revealedHints: 0 },
    })
    const lesson = makeLesson('lesson', [step('one', onSaved), step('two', onSaved)])
    createTutorialEngine(rig.host, [lesson]).start('lesson')
    expect(lastState(rig).stepId).toBe('two') // index 1 of the current steps
  })

  it('ignores and clears progress stored for a DIFFERENT lesson', () => {
    const rig = makeRig(docWithLayer(), {
      progress: { lessonId: 'other-lesson', stepIndex: 2, revealedHints: 1 },
    })
    const lesson = makeLesson('lesson', [step('one', onSaved), step('two', onSaved), step('three', onSaved)])
    createTutorialEngine(rig.host, [lesson]).start('lesson')
    expect(lastState(rig).stepIndex).toBe(0)
    expect(rig.store.value).toEqual({ lessonId: 'lesson', stepIndex: 0, stepId: 'one', revealedHints: 0 })
  })
})

describe('auto-advance', () => {
  it('skips consecutive already-satisfied world-predicate steps in ONE publish, applying each onEnter in order', () => {
    const doc = docWithLayer([
      [1, 1, 2],
      [2, 2, 3],
      [3, 3, 4],
    ])
    const rig = makeRig(doc)
    const lesson = makeLesson('advance', [
      step('a', tileAt(1, 1), { onEnter: [overlayEffect('a')] }),
      step('b', tileAt(2, 2), { onEnter: [overlayEffect('b')] }),
      step('c', tileAt(3, 3), { onEnter: [overlayEffect('c')] }),
      step('d', onSaved, { onEnter: [overlayEffect('d')] }),
    ])
    createTutorialEngine(rig.host, [lesson]).start('advance')

    expect(rig.published).toHaveLength(1) // one settle, one publish
    const state = lastState(rig)
    expect(state.stepId).toBe('d')
    expect(state.stepIndex).toBe(3)
    // Every step entered on the way through got its effects, in order —
    // one deterministic effect stream: the start's clean stage first, the
    // landing step's picture last.
    expect(rig.effects).toEqual([
      ...cleanStage,
      overlayEffect('a'),
      overlayEffect('b'),
      overlayEffect('c'),
      overlayEffect('d'),
    ])
    expect(rig.store.value).toEqual({ lessonId: 'advance', stepIndex: 3, stepId: 'd', revealedHints: 0 })
  })

  it('event-predicate steps NEVER auto-advance — a moment must actually happen', () => {
    const rig = makeRig(docWithLayer([[1, 1, 2]]))
    const lesson = makeLesson('gate', [step('press-save', onSaved), step('painted', tileAt(1, 1))])
    createTutorialEngine(rig.host, [lesson]).start('gate')
    // Step 1 is already satisfied by the doc, but step 0 is an event gate:
    // the machine must wait at 0.
    expect(lastState(rig).stepId).toBe('press-save')
  })

  it('a composition with an event leaf never auto-advances (it is not a world predicate)', () => {
    const doc = docWithLayer([[1, 1, 2]])
    const rig = makeRig(doc)
    const mixed: StepPredicate = { kind: 'all', of: [tileAt(1, 1), onSaved] }
    const lesson = makeLesson('mixed', [step('impossible', mixed)])
    createTutorialEngine(rig.host, [lesson]).start('mixed')
    expect(lastState(rig).stepId).toBe('impossible')
  })

  it('a lesson whose every step is already satisfied completes on start', () => {
    const rig = makeRig(docWithLayer([[1, 1, 2]]))
    const lesson = makeLesson('instant', [step('already', tileAt(1, 1))])
    createTutorialEngine(rig.host, [lesson]).start('instant')
    expect(lastState(rig).done).toBe(true)
  })
})

describe('builder events', () => {
  it('advances when the current step completion is an event predicate matching the event', () => {
    const rig = makeRig(docWithLayer())
    const lesson = makeLesson('two-step', [step('save-it', onSaved), step('then', onSaved)])
    createTutorialEngine(rig.host, [lesson]).start('two-step')
    rig.emit(savedEvent)
    expect(rig.published).toHaveLength(2)
    expect(lastState(rig).stepId).toBe('then')
    expect(rig.store.value).toEqual({ lessonId: 'two-step', stepIndex: 1, stepId: 'then', revealedHints: 0 })
  })

  it('a non-matching event changes nothing — no publish, no progress write', () => {
    const rig = makeRig(docWithLayer())
    const lesson = makeLesson('waiting', [step('save-it', onSaved)])
    createTutorialEngine(rig.host, [lesson]).start('waiting')
    rig.emit(paintedEvent(2))
    expect(rig.published).toHaveLength(1) // only the start publish
    expect(rig.store.value).toEqual({ lessonId: 'waiting', stepIndex: 0, stepId: 'save-it', revealedHints: 0 })
  })

  it('matches where fields against the event payload', () => {
    const rig = makeRig(docWithLayer())
    const wantsWater: StepPredicate = { kind: 'event', type: 'builder.tile-painted', where: { tile: 2 } }
    const lesson = makeLesson('water', [step('paint-water', wantsWater), step('after', onSaved)])
    createTutorialEngine(rig.host, [lesson]).start('water')
    rig.emit(paintedEvent(3)) // wrong tile
    expect(lastState(rig).stepId).toBe('paint-water')
    rig.emit(paintedEvent(2))
    expect(lastState(rig).stepId).toBe('after')
  })

  it('cascades: an event completes step N and the doc already satisfies N+1 — both advance in one publish', () => {
    const rig = makeRig(docWithLayer([[4, 4, 2]]))
    const lesson = makeLesson('cascade', [
      step('save-it', onSaved),
      step('tile-there', tileAt(4, 4)),
      step('finally', onSaved),
    ])
    createTutorialEngine(rig.host, [lesson]).start('cascade')
    expect(rig.published).toHaveLength(1)
    rig.emit(savedEvent)
    expect(rig.published).toHaveLength(2) // one settle for the whole run
    expect(lastState(rig).stepId).toBe('finally')
    expect(lastState(rig).stepIndex).toBe(2)
  })

  it('re-checks world predicates even when the event itself does not match (mutate-then-announce)', () => {
    const doc = docWithLayer()
    const rig = makeRig(doc)
    const lesson = makeLesson('world-gate', [step('tile-there', tileAt(5, 5))])
    createTutorialEngine(rig.host, [lesson]).start('world-gate')
    expect(lastState(rig).done).toBe(false)
    // The editor paints (mutates the doc), THEN announces the gesture.
    const layer = doc.layers[0]
    if (layer === undefined) throw new Error('doc has no layer')
    layer.cells[5 * layer.width + 5] = 2
    rig.emit(paintedEvent(2))
    expect(lastState(rig).done).toBe(true)
  })
})

describe('hints', () => {
  it('reveals hints one at a time, publishing and persisting each reveal', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [makeLesson('h', [step('s', onSaved)])])
    engine.start('h')
    engine.requestHint()
    expect(lastState(rig).hints).toEqual(['s hint one'])
    expect(lastState(rig).hintsRemaining).toBe(1)
    expect(rig.store.value).toEqual({ lessonId: 'h', stepIndex: 0, stepId: 's', revealedHints: 1 })
    engine.requestHint()
    expect(lastState(rig).hints).toEqual(['s hint one', 's hint two'])
    expect(lastState(rig).hintsRemaining).toBe(0)
  })

  it('does nothing when every hint is already revealed — no extra publish, no write', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [makeLesson('h', [step('s', onSaved)])])
    engine.start('h')
    engine.requestHint()
    engine.requestHint()
    const publishes = rig.published.length
    engine.requestHint() // clamped
    expect(rig.published).toHaveLength(publishes)
  })

  it('advancing to a new step starts its hints from zero', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [makeLesson('h', [step('one', onSaved), step('two', onSaved)])])
    engine.start('h')
    engine.requestHint()
    rig.emit(savedEvent)
    expect(lastState(rig).stepId).toBe('two')
    expect(lastState(rig).hints).toEqual([])
    expect(rig.store.value).toEqual({ lessonId: 'h', stepIndex: 1, stepId: 'two', revealedHints: 0 })
  })
})

describe('reset', () => {
  it('re-applies the CURRENT step onEnter, zeroes revealed hints, publishes and persists — without rewinding', () => {
    const rig = makeRig(docWithLayer())
    const lesson = makeLesson('r', [
      step('one', onSaved),
      step('two', onSaved, { onEnter: [overlayEffect('two')] }),
    ])
    const engine = createTutorialEngine(rig.host, [lesson])
    engine.start('r')
    rig.emit(savedEvent) // advance to 'two' (applies its onEnter)
    engine.requestHint()
    expect(rig.effects).toEqual([...cleanStage, overlayEffect('two')])

    engine.reset()
    const state = lastState(rig)
    expect(state.stepId).toBe('two') // never rewinds
    expect(state.hints).toEqual([]) // hints cleared
    // onEnter re-applied — and no clean-stage: reset re-enters, it does not
    // begin a lesson or finish one.
    expect(rig.effects).toEqual([...cleanStage, overlayEffect('two'), overlayEffect('two')])
    expect(rig.store.value).toEqual({ lessonId: 'r', stepIndex: 1, stepId: 'two', revealedHints: 0 })
  })

  it('never touches the document', () => {
    const doc = docWithLayer([[1, 1, 2]])
    const before = new Uint16Array(doc.layers[0]?.cells ?? [])
    const rig = makeRig(doc)
    const engine = createTutorialEngine(rig.host, [makeLesson('r', [step('s', onSaved)])])
    engine.start('r')
    engine.reset()
    expect(doc.layers[0]?.cells).toEqual(before)
    expect(Object.keys(doc.entities)).toEqual([])
  })

  it('is a no-op when the lesson is done — there is no current step to re-enter', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [makeLesson('r', [step('s', onSaved)])])
    engine.start('r')
    rig.emit(savedEvent) // done
    const publishes = rig.published.length
    engine.reset()
    expect(rig.published).toHaveLength(publishes)
  })
})

describe('done', () => {
  it('publishes done: true with empty instruction and a null stepId', () => {
    const rig = makeRig(docWithLayer())
    createTutorialEngine(rig.host, [makeLesson('end', [step('s', onSaved)])]).start('end')
    rig.emit(savedEvent)
    expect(lastState(rig)).toEqual({
      lessonId: 'end',
      arc: 'coordinates',
      title: 'Lesson end',
      stepId: null,
      stepIndex: 1,
      stepCount: 1,
      stepTitle: '',
      instruction: '',
      hints: [],
      hintsRemaining: 0,
      target: null,
      done: true,
    })
  })

  it('reaching done cleans the stage — a finished lesson takes its picture with it', () => {
    const rig = makeRig(docWithLayer())
    const lesson = makeLesson('end', [
      step('s', onSaved, {
        onEnter: [{ kind: 'set-view-projection', projection: 'iso' }, overlayEffect('s')],
      }),
    ])
    createTutorialEngine(rig.host, [lesson]).start('end')
    const beforeDone = rig.effects.length
    rig.emit(savedEvent)
    expect(lastState(rig).done).toBe(true)
    // The finish swept its own decorations: overlays cleared, lens home.
    expect(rig.effects.slice(beforeDone)).toEqual([...cleanStage])
  })

  it('KEEPS progress stored — a reloaded finished lesson stays finished', () => {
    const rig = makeRig(docWithLayer())
    createTutorialEngine(rig.host, [makeLesson('end', [step('s', onSaved)])]).start('end')
    rig.emit(savedEvent)
    expect(rig.store.value).toEqual({ lessonId: 'end', stepIndex: 1, revealedHints: 0 })

    // Simulate the reload: a brand-new engine over the same store.
    const rig2 = makeRig(docWithLayer(), { progress: rig.store.value })
    createTutorialEngine(rig2.host, [makeLesson('end', [step('s', onSaved)])]).start('end')
    expect(lastState(rig2).done).toBe(true)
  })

  it('ignores further events after done', () => {
    const rig = makeRig(docWithLayer())
    createTutorialEngine(rig.host, [makeLesson('end', [step('s', onSaved)])]).start('end')
    rig.emit(savedEvent)
    const publishes = rig.published.length
    rig.emit(savedEvent)
    expect(rig.published).toHaveLength(publishes)
    expect(rig.store.value?.stepIndex).toBe(1)
  })
})

describe('reload', () => {
  const original = (): Lesson =>
    makeLesson('les', [step('one', onSaved), step('two', onSaved), step('three', onSaved)])

  it('keeps the student on the same step ID when it still exists, at its NEW index', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [original()])
    engine.start('les')
    rig.emit(savedEvent) // now on 'two' (index 1)
    engine.requestHint()

    const edited = makeLesson('les', [
      step('zero', onSaved), // inserted before
      step('one', onSaved),
      step('two', onSaved),
      step('three', onSaved),
    ])
    engine.reload([edited])
    const state = lastState(rig)
    expect(state.stepId).toBe('two')
    expect(state.stepIndex).toBe(2) // shifted by the insertion
    expect(state.hints).toEqual(['two hint one']) // revealed hints survive an id-stable reload
    expect(rig.store.value).toEqual({ lessonId: 'les', stepIndex: 2, stepId: 'two', revealedHints: 1 })
  })

  it('clamps by index when the current step id vanished, forgetting revealed hints', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [original()])
    engine.start('les')
    rig.emit(savedEvent) // on 'two' (index 1)
    engine.requestHint()

    const edited = makeLesson('les', [step('alpha', onSaved), step('beta', onSaved)])
    engine.reload([edited])
    const state = lastState(rig)
    expect(state.stepId).toBe('beta') // index 1 of the new steps
    expect(state.hints).toEqual([])
  })

  it('clamps a shrunken lesson to done, and a grown one past a finish onto the first new step', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [makeLesson('les', [step('one', onSaved)])])
    engine.start('les')
    rig.emit(savedEvent) // done at stepIndex 1
    engine.reload([makeLesson('les', [step('one', onSaved), step('two', onSaved)])])
    expect(lastState(rig).stepId).toBe('two') // hot-reload favors the author
    expect(lastState(rig).done).toBe(false)
  })

  it('publishes null and idles when the running lesson vanished from the catalogue', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [original()])
    engine.start('les')
    engine.reload([makeLesson('unrelated', [step('s', onSaved)])])
    expect(rig.published.at(-1)).toBeNull()
    const publishes = rig.published.length
    rig.emit(savedEvent)
    expect(rig.published).toHaveLength(publishes) // idle
  })

  it('sweeps the stage before idling when the running lesson vanished — null must not leave its picture painted', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [
      makeLesson('les', [step('s', onSaved, { onEnter: [overlayEffect('s')] })]),
    ])
    engine.start('les')
    const before = rig.effects.length
    engine.reload([makeLesson('unrelated', [step('s', onSaved)])])
    expect(rig.published.at(-1)).toBeNull()
    expect(rig.effects.slice(before)).toEqual([...cleanStage])
  })

  it('sweeps the stage when the re-derivation clamps a live step straight to done', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [
      makeLesson('les', [step('one', onSaved), step('two', onSaved, { onEnter: [overlayEffect('two')] })]),
    ])
    engine.start('les')
    rig.emit(savedEvent) // live on 'two' (index 1), its overlay painted
    const before = rig.effects.length
    // The author shrank the lesson out from under the student: 'two'
    // vanished, the index clamps to steps.length — done, without passing
    // through auto-advance. The done-time sweep must still happen.
    engine.reload([makeLesson('les', [step('zero', onSaved)])])
    expect(lastState(rig).done).toBe(true)
    expect(rig.effects.slice(before)).toEqual([...cleanStage])
  })

  it('does NOT sweep again when reloading a lesson that was already done', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [makeLesson('les', [step('one', onSaved)])])
    engine.start('les')
    rig.emit(savedEvent) // done — the finish swept once, then
    const before = rig.effects.length
    engine.reload([makeLesson('les', [step('one', onSaved)])])
    expect(lastState(rig).done).toBe(true)
    // Its done-time sweep already ran; a second would repaint a stage the
    // student may have since arranged themselves.
    expect(rig.effects.slice(before)).toEqual([])
  })

  it('re-applies the derived step onEnter and re-runs world auto-advance against the live doc', () => {
    const doc = docWithLayer([[6, 6, 2]])
    const rig = makeRig(doc)
    const engine = createTutorialEngine(rig.host, [makeLesson('les', [step('wait', onSaved)])])
    engine.start('les')
    // The author edits the step: it now gates on a tile the doc already has.
    const edited = makeLesson('les', [
      step('wait', tileAt(6, 6), { onEnter: [overlayEffect('edited')] }),
      step('after', onSaved),
    ])
    engine.reload([edited])
    const state = lastState(rig)
    expect(state.stepId).toBe('after') // auto-advanced through the satisfied edit
    // Start's clean stage, then the re-entered step's effect — reload
    // itself sweeps nothing (the author's live picture survives the edit).
    expect(rig.effects).toEqual([...cleanStage, overlayEffect('edited')])
  })
})

describe('dispose', () => {
  it('unsubscribes from the host and publishes null', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [makeLesson('les', [step('s', onSaved)])])
    engine.start('les')
    expect(rig.listenerCount()).toBe(1)
    engine.dispose()
    expect(rig.listenerCount()).toBe(0)
    expect(rig.published.at(-1)).toBeNull()
    // Everything after dispose is inert.
    const publishes = rig.published.length
    rig.emit(savedEvent)
    engine.requestHint()
    engine.reset()
    engine.start('les')
    expect(rig.published).toHaveLength(publishes)
  })

  it('deliberately leaves the stage — dispose is teardown, not navigation', () => {
    const rig = makeRig(docWithLayer())
    const engine = createTutorialEngine(rig.host, [
      makeLesson('les', [step('s', onSaved, { onEnter: [overlayEffect('s')] })]),
    ])
    engine.start('les')
    const before = rig.effects.length
    engine.dispose()
    // No sweep into a dying host: navigation paths (unknown start, vanished
    // reload, reaching done) clean the stage; teardown leaves it as-is.
    expect(rig.effects.slice(before)).toEqual([])
    expect(rig.published.at(-1)).toBeNull()
  })
})

// --------------------------------------------------------------------------
// The reentrancy latch — only student actions advance steps (machine.ts
// header). The editor's own host calls EMIT synchronously: setViewProjection
// announces the lens change an onEnter effect just requested, loadFixture
// announces the world it just swapped in. Those machine-caused events must
// be discarded, never treated as the student acting.
// --------------------------------------------------------------------------

describe('the reentrancy latch', () => {
  const viewChanged: BuilderEvent = { type: 'builder.view-projection-changed', from: 'topdown', to: 'iso' }
  const onViewChanged: StepPredicate = { kind: 'event', type: 'builder.view-projection-changed' }
  const isoEffect: StepEffect = { kind: 'set-view-projection', projection: 'iso' }

  /** A host that behaves like the real editor: applying set-view-projection
   * iso synchronously re-emits the matching builder event. */
  function reEmittingHost(rig: Rig): TutorialHost {
    return {
      ...rig.host,
      applyEffect(effect) {
        rig.host.applyEffect(effect)
        if (effect.kind === 'set-view-projection' && effect.projection === 'iso') {
          rig.emit(viewChanged)
        }
      },
    }
  }

  it('a step landed on by an event advance whose onEnter emits its own gate event does NOT self-complete, and its effects apply LAST', () => {
    const rig = makeRig(docWithLayer())
    const lesson = makeLesson('reentrant', [
      step('save-first', onSaved),
      step('switch-view', onViewChanged, { onEnter: [isoEffect, overlayEffect('landing')] }),
    ])
    createTutorialEngine(reEmittingHost(rig), [lesson]).start('reentrant')

    rig.emit(savedEvent) // the STUDENT saves; entering 'switch-view' re-emits its own gate
    const state = lastState(rig)
    expect(state.stepId).toBe('switch-view') // the machine-caused echo was discarded
    expect(state.done).toBe(false)
    // One clean stream, the landing step's effects last and contiguous — no
    // scrambled interleave from a mid-enter advance.
    expect(rig.effects).toEqual([...cleanStage, isoEffect, overlayEffect('landing')])
    expect(rig.store.value).toEqual({ lessonId: 'reentrant', stepIndex: 1, stepId: 'switch-view', revealedHints: 0 })

    // The latch is DOWN between events: the student really switching still
    // completes the step.
    rig.emit(viewChanged)
    expect(lastState(rig).done).toBe(true)
  })

  it('a step entered by start() whose onEnter emits its own gate event does not self-complete either', () => {
    const rig = makeRig(docWithLayer())
    const lesson = makeLesson('opening', [
      step('switch-view', onViewChanged, { onEnter: [isoEffect, overlayEffect('opening')] }),
      step('after', onSaved, { onEnter: [overlayEffect('after')] }),
    ])
    createTutorialEngine(reEmittingHost(rig), [lesson]).start('opening')

    expect(rig.published).toHaveLength(1) // one settle — no mid-start extra publish
    expect(lastState(rig).stepId).toBe('switch-view')
    expect(rig.effects).toEqual([...cleanStage, isoEffect, overlayEffect('opening')])

    rig.emit(viewChanged) // the student's own switch
    expect(lastState(rig).stepId).toBe('after')
    expect(rig.effects).toEqual([...cleanStage, isoEffect, overlayEffect('opening'), overlayEffect('after')])
  })

  it('a fixture load that emits world-loaded neither advances the outgoing lesson nor publishes or persists progress for it', () => {
    const worldLoaded: BuilderEvent = { type: 'builder.world-loaded', worldId: 'w1', origin: 'load', usedBackup: false }
    const onWorldLoaded: StepPredicate = { kind: 'event', type: 'builder.world-loaded' }
    const rig = makeRig(docWithLayer(), { knownFixtures: ['isle'] })
    const writes: TutorialProgress[] = []
    const host: TutorialHost = {
      ...rig.host,
      loadFixture(fixtureId) {
        const known = rig.host.loadFixture(fixtureId)
        rig.emit(worldLoaded) // the editor announces the document swap
        return known
      },
      progress: {
        read: () => rig.host.progress.read(),
        write(progress) {
          writes.push(progress)
          rig.host.progress.write(progress)
        },
        clear: () => rig.host.progress.clear(),
      },
    }
    const engine = createTutorialEngine(host, [
      makeLesson('outgoing', [step('waiting', onWorldLoaded), step('later', onSaved)]),
      makeLesson('incoming', [step('arrive', onWorldLoaded), step('then', onSaved)], { fixture: 'isle' }),
    ])
    engine.start('outgoing') // parked on its world-loaded gate
    engine.start('incoming') // loadFixture fires world-loaded MID-start

    // The outgoing lesson never advanced on fixture scenery: its only
    // persisted progress is its own step 0, and nothing past step 0 was
    // ever published for it.
    expect(writes.filter((w) => w.lessonId === 'outgoing')).toEqual([
      { lessonId: 'outgoing', stepIndex: 0, stepId: 'waiting', revealedHints: 0 },
    ])
    const outgoingStates = rig.published.filter(
      (state): state is TutorialUiState => state !== null && state.lessonId === 'outgoing',
    )
    expect(outgoingStates.map((state) => state.stepIndex)).toEqual([0])

    // And the incoming lesson did not swallow its own fixture load: the
    // machine caused that world-loaded, so the gate still waits.
    expect(lastState(rig).lessonId).toBe('incoming')
    expect(lastState(rig).stepId).toBe('arrive')

    // A real, student-caused load afterwards still advances it.
    rig.emit(worldLoaded)
    expect(lastState(rig).stepId).toBe('then')
  })
})
