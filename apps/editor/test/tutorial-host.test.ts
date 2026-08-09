/**
 * The editor's TutorialHost, proven over the REAL session — plus the full
 * engine-over-editor integration: lesson-01 driven to done through actual
 * session mutations, the in-process twin of the e2e gate.
 *
 * Everything runs the real factory with the two edge fakes session.test.ts
 * established (in-memory SlotStorage, pixel-less raster). The one new fake
 * is a recording 2d context for the show-overlays render-path proof: the
 * session's render loop only speaks through the canvas2d backend, so the
 * test hands it a context that logs every state set and call — lesson ink
 * is then visible as the lens layer's unmistakable 2.5-wide stroke.
 *
 * The bottom section is the app-side echo of the frozen-vocabulary
 * governance (moved here from the retired lesson-harness test): every
 * event predicate in shipped lesson data must name a real BuilderEventType,
 * with a type-level exhaustiveness guard so the literal list cannot rot.
 */

import { getCell } from '@engine/tilemap'
import type { RasterFactory } from '@engine/tilemap'
import { createTutorialEngine } from '@engine/tutorial'
import type { TutorialUiState } from '@engine/tutorial'
import { parseWorld, serializeWorld } from '@engine/world-format'
import type { SlotStorage } from '@engine/world-format'
import { Vec2 } from '@engine/math'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lessons } from '@content/lessons'
import { BUILDER_EVENT_ALIASES } from '../src/editor/events/builder'
import type { BuilderEvent, BuilderEventType } from '../src/editor/events/builder'
import { createShowcaseIsland, FIXTURES } from '../src/editor/fixtures'
import { createEditorSession } from '../src/editor/session'
import { createBrushTool, createPlacerTool, createSelectTool } from '../src/editor/tools'
import { createEditorTutorialHost, PARKED_WORLD_KEY, TUTORIAL_PROGRESS_KEY } from '../src/editor/tutorial-host'
import type { TutorialProgressStorage } from '../src/editor/tutorial-host'
import type { ToolPointerEvent } from '../src/editor/types'

// --- the edge fakes (session.test.ts's patterns) ----------------------------

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

/** A TutorialProgressStorage over a Map — three lines, as promised. */
function mapProgressStorage(): TutorialProgressStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) {
      map.set(key, value)
    },
    removeItem(key) {
      map.delete(key)
    },
  }
}

/** Hand-built ToolPointerEvent for driving a held tool instance directly. */
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
 * A recording 2d context: every method resolves to a logger, every property
 * set is logged with its value. The canvas2d backend runs happily on it,
 * and lesson ink becomes assertable data — the lens layer's 2.5 lineWidth
 * (its STROKE_WIDTH) appears in no other part of the editor's frame.
 */
function recordingContext() {
  const log: Array<{ readonly op: string; readonly value?: unknown }> = []
  const target: Record<PropertyKey, unknown> = {}
  const ctx = new Proxy(target, {
    get(t, prop) {
      if (!(prop in t)) {
        t[prop] = (): void => {
          log.push({ op: `call:${String(prop)}` })
        }
      }
      return t[prop]
    },
    set(t, prop, value) {
      log.push({ op: `set:${String(prop)}`, value })
      t[prop] = value
      return true
    },
  })
  return { ctx, log }
}

/** The minimal canvas attach() touches, wired to a given 2d context. */
function fakeCanvas(ctx: unknown, width = 640, height = 420): HTMLCanvasElement {
  const canvas = {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    addEventListener(): void {},
    removeEventListener(): void {},
    setPointerCapture(): void {},
    getContext: () => ctx,
  }
  return canvas as unknown as HTMLCanvasElement
}

/** Capture animation-frame callbacks; flush() runs them by hand — the
 * viewport's dirty flag stays honest because the callback runs OUTSIDE the
 * requestAnimationFrame call, exactly like a real frame. */
function manualFrames() {
  const pending: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    pending.push(cb)
    return pending.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  return {
    flush(): void {
      for (const cb of pending.splice(0)) cb(0)
    },
  }
}

const railOf = (session: ReturnType<typeof makeSession>): TutorialUiState | null =>
  session.store.getState().tutorial

// ---------------------------------------------------------------------------
// Effect routing
// ---------------------------------------------------------------------------

describe('applyEffect', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('set-view-projection routes to the session and the event carries honest effective names', () => {
    const session = makeSession()
    const host = createEditorTutorialHost(session, { storage: mapProgressStorage() })
    const events: BuilderEvent[] = []
    session.onEvent((event) => {
      if (event.type === 'builder.view-projection-changed') events.push(event)
    })

    host.applyEffect({ kind: 'set-view-projection', projection: 'iso' })
    expect(session.viewProjection).toBe('iso')
    expect(events).toEqual([{ type: 'builder.view-projection-changed', from: 'topdown', to: 'iso' }])

    // null returns to the primary — and says so by its real name.
    host.applyEffect({ kind: 'set-view-projection', projection: null })
    expect(session.viewProjection).toBeNull()
    expect(events[1]).toEqual({ type: 'builder.view-projection-changed', from: 'iso', to: 'topdown' })
  })

  it('show-overlays reaches the live render path: lesson ink appears in the next frame', () => {
    const { flush } = manualFrames()
    const session = makeSession()
    const host = createEditorTutorialHost(session, { storage: mapProgressStorage() })
    const { ctx, log } = recordingContext()
    const detach = session.attach(fakeCanvas(ctx))

    flush() // the attach frame: the scene, no lesson ink
    const lensInk = () => log.filter((entry) => entry.op === 'set:lineWidth' && entry.value === 2.5)
    expect(lensInk()).toHaveLength(0)

    host.applyEffect({
      kind: 'show-overlays',
      overlays: [{ kind: 'cell-highlight', tx: 2, ty: 3, label: 'here' }],
    })
    flush() // the effect requested a render; the highlight is in this frame
    expect(lensInk().length).toBeGreaterThan(0)

    // An empty set clears: the NEXT frame carries no lesson ink again.
    log.length = 0
    host.applyEffect({ kind: 'show-overlays', overlays: [] })
    flush()
    expect(lensInk()).toHaveLength(0)
    detach()
  })
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe('the showcase island fixture', () => {
  it('is deterministic and round-trips the world format', () => {
    const first = serializeWorld(createShowcaseIsland())
    const second = serializeWorld(createShowcaseIsland())
    expect(second).toBe(first) // same bytes on every call — no hidden clocks

    const parsed = parseWorld(first)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.warnings).toEqual([])
      expect(serializeWorld(parsed.world)).toBe(first)
    }
  })

  it('carries the perspective-reveal stage: two storeys, rings, and the marker cast', () => {
    const world = createShowcaseIsland()
    expect(world.settings.primaryProjection).toBe('topdown')

    const [ground, plateau] = world.layers
    expect(ground?.id).toBe('ground')
    expect(ground?.elevation).toBe(0)
    expect(ground?.layerBand).toBe(0)
    expect(plateau?.id).toBe('plateau')
    expect(plateau?.elevation).toBe(1)
    expect(plateau?.layerBand).toBe(1)
    if (ground === undefined || plateau === undefined) throw new Error('island lost a storey')

    // The rings, spot-checked where the arithmetic pins them: water at the
    // map edge, sand exactly two cells in, grass inside.
    expect(getCell(ground, 0, 0)).toBe(2) // water
    expect(getCell(ground, 2, 9)).toBe(3) // sand rim
    expect(getCell(ground, 8, 9)).toBe(1) // grass interior
    // The plateau box is stone on the SECOND storey, empty ground its own.
    expect(getCell(plateau, 16, 9)).toBe(4)
    expect(getCell(plateau, 0, 0)).toBe(0)

    // The cast: player, two crates at the plateau's east wall base, a tree.
    const markers = Object.values(world.entities).map((entity) => {
      const marker = entity.components['marker'] as { kind?: string }
      return marker.kind
    })
    expect(markers.sort()).toEqual(['crate', 'crate', 'player', 'tree'])
  })

  it('loadFixture: a known id swaps the document through loadWorld, an unknown id declines', () => {
    const session = makeSession()
    const host = createEditorTutorialHost(session, { storage: mapProgressStorage() })
    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))

    expect(host.loadFixture('showcase-island')).toBe(true)
    expect(session.doc.meta.name).toBe('showcase island')
    // Through the ONE public door, as origin 'fixture': the session raises
    // the borrowed-backdrop flag and tells the parked-world story. The
    // world-loaded EVENT still says 'new' — the frozen vocabulary (D4)
    // predates the app-side origin, and to lesson data a fixture arrival
    // is a fresh unsaved stage.
    expect(session.fixtureActive).toBe(true)
    expect(session.store.getState().persistence).toEqual({
      state: 'unsaved',
      message: 'lesson world — your own world is parked and safe',
    })
    expect(
      events.filter((event) => event.type === 'builder.world-loaded').map((event) => event.origin),
    ).toEqual(['new'])

    const before = serializeWorld(session.doc)
    expect(host.loadFixture('atlantis')).toBe(false)
    expect(serializeWorld(session.doc)).toBe(before) // unknown id: current world, untouched
  })

  it('the catalogue names the showcase island', () => {
    expect(Object.keys(FIXTURES)).toContain('showcase-island')
    expect(FIXTURES['showcase-island']).toBe(createShowcaseIsland)
  })
})

// ---------------------------------------------------------------------------
// The parked world — the fixture-save hazard, closed (see tutorial-host.ts)
// ---------------------------------------------------------------------------

describe('the parked world', () => {
  it('loadFixture parks the student world — byte-exact — before the swap', () => {
    const session = makeSession()
    const progressStorage = mapProgressStorage()
    const host = createEditorTutorialHost(session, { storage: progressStorage })
    // Give the student a recognizable world: an edit the starter lacks.
    session.bus.dispatch({ kind: 'place-entity', marker: 'crate', position: { x: 2.5, y: 2.5 }, elevation: 0 })
    const studentBytes = serializeWorld(session.doc)

    expect(host.hasParked()).toBe(false)
    expect(host.loadFixture('showcase-island')).toBe(true)
    expect(progressStorage.map.get(PARKED_WORLD_KEY)).toBe(studentBytes)
    expect(host.hasParked()).toBe(true)
    expect(session.doc.meta.name).toBe('showcase island')
    expect(session.fixtureActive).toBe(true)
  })

  it('fixture→fixture keeps the ORIGINAL park — borrowed scenery never overwrites it', () => {
    const session = makeSession()
    const progressStorage = mapProgressStorage()
    const host = createEditorTutorialHost(session, { storage: progressStorage })
    const studentBytes = serializeWorld(session.doc)

    host.loadFixture('showcase-island')
    expect(progressStorage.map.get(PARKED_WORLD_KEY)).toBe(studentBytes)
    // A second fixture load (one fixture lesson to another): re-parking
    // would write the ISLAND over the student's world — the exact loss the
    // park exists to prevent.
    host.loadFixture('showcase-island')
    expect(progressStorage.map.get(PARKED_WORLD_KEY)).toBe(studentBytes)
  })

  it('restoreParkedIfAny round-trips byte-exactly, spends the park, and arrives as origin load', () => {
    const session = makeSession()
    const progressStorage = mapProgressStorage()
    const host = createEditorTutorialHost(session, { storage: progressStorage })
    session.bus.dispatch({ kind: 'place-entity', marker: 'tree', position: { x: 4.5, y: 4.5 }, elevation: 0 })
    const studentBytes = serializeWorld(session.doc)
    host.loadFixture('showcase-island')

    const events: BuilderEvent[] = []
    session.onEvent((event) => events.push(event))
    expect(host.restoreParkedIfAny()).toBe(true)
    expect(serializeWorld(session.doc)).toBe(studentBytes) // byte-exact round trip
    expect(progressStorage.map.has(PARKED_WORLD_KEY)).toBe(false) // the park is spent
    expect(host.hasParked()).toBe(false)
    expect(session.fixtureActive).toBe(false) // origin 'park-restore' lowered the flag
    // The frozen vocabulary knows no 'park-restore': to lesson data this IS
    // a load, and the event says so.
    expect(
      events.filter((event) => event.type === 'builder.world-loaded').map((event) => event.origin),
    ).toEqual(['load'])
    // But the badge does NOT say 'saved' — the restored bytes sit in no
    // save slot (the park was just spent), and pretending otherwise would
    // open a silent data-loss window. The message names the way out.
    expect(session.store.getState().persistence).toEqual({
      state: 'unsaved',
      message: 'back from the lesson — press Ctrl+S to keep your world',
    })
  })

  it('a corrupt park reports false AND clears the key — it must not wedge the flow forever', () => {
    const session = makeSession()
    const progressStorage = mapProgressStorage()
    const host = createEditorTutorialHost(session, { storage: progressStorage })
    progressStorage.map.set(PARKED_WORLD_KEY, '{ these bytes are not a world')
    const before = serializeWorld(session.doc)

    expect(host.hasParked()).toBe(true) // bytes exist…
    expect(host.restoreParkedIfAny()).toBe(false) // …but cannot come back
    expect(progressStorage.map.has(PARKED_WORLD_KEY)).toBe(false) // cleared, not kept to re-fail
    expect(host.hasParked()).toBe(false)
    expect(serializeWorld(session.doc)).toBe(before) // the live document is untouched
  })

  it('a missing park reports false and removes nothing', () => {
    const removed: string[] = []
    const backing = mapProgressStorage()
    const storage: TutorialProgressStorage = {
      getItem: (key) => backing.getItem(key),
      setItem: (key, value) => {
        backing.setItem(key, value)
      },
      removeItem: (key) => {
        removed.push(key)
        backing.removeItem(key)
      },
    }
    const session = makeSession()
    const host = createEditorTutorialHost(session, { storage })
    const before = serializeWorld(session.doc)

    expect(host.hasParked()).toBe(false)
    expect(host.restoreParkedIfAny()).toBe(false)
    expect(removed).toEqual([]) // nothing to remove, nothing removed
    expect(serializeWorld(session.doc)).toBe(before)
  })

  it('an import mid-fixture KILLS the park — a stale park must not clobber newer work', () => {
    const session = makeSession()
    const progressStorage = mapProgressStorage()
    const host = createEditorTutorialHost(session, { storage: progressStorage })
    const studentBytes = serializeWorld(session.doc)
    host.loadFixture('showcase-island')
    expect(host.hasParked()).toBe(true)

    // The student chooses a NEW live world while the fixture holds the
    // stage: they walked away from the detour, and the parked copy is now
    // STALE — a later "back to my world" restoring it would silently
    // clobber the world they just chose.
    expect(session.importText(studentBytes).ok).toBe(true)
    expect(session.fixtureActive).toBe(false)
    expect(host.hasParked()).toBe(false)
    expect(progressStorage.map.has(PARKED_WORLD_KEY)).toBe(false)
  })

  it("every non-fixture, non-restore arrival kills the park: 'load' and 'new' walked", () => {
    const session = makeSession()
    const progressStorage = mapProgressStorage()
    const host = createEditorTutorialHost(session, { storage: progressStorage })

    host.loadFixture('showcase-island')
    expect(host.hasParked()).toBe(true)
    session.loadWorld(createShowcaseIsland(), 'load')
    expect(host.hasParked()).toBe(false)

    host.loadFixture('showcase-island')
    expect(host.hasParked()).toBe(true)
    session.loadWorld(createShowcaseIsland(), 'new')
    expect(host.hasParked()).toBe(false)

    // And the fixture arrival itself never kills what it just wrote — the
    // park is exactly what a fixture load exists to protect.
    host.loadFixture('showcase-island')
    expect(host.hasParked()).toBe(true)
  })

  it('the mid-fixture reload cycle: boot-restore spends the park, the re-park refills it — student bytes both times', () => {
    // Tab 1: the student edits, starts the fixture lesson (parks), closes
    // the tab mid-lesson.
    const progressStorage = mapProgressStorage()
    const session1 = makeSession()
    const host1 = createEditorTutorialHost(session1, { storage: progressStorage })
    session1.bus.dispatch({ kind: 'place-entity', marker: 'tree', position: { x: 3.5, y: 3.5 }, elevation: 0 })
    const studentBytes = serializeWorld(session1.doc)
    host1.loadFixture('showcase-island')
    expect(progressStorage.map.get(PARKED_WORLD_KEY)).toBe(studentBytes)

    // Tab 2 (the reload): a fresh session BOOTS before the fresh host
    // exists (main.tsx's order — makeSession here, host after), so the
    // boot's world-loaded predates the stale-park listener and the park
    // SURVIVES boot to be restored.
    const session2 = makeSession()
    const host2 = createEditorTutorialHost(session2, { storage: progressStorage })
    expect(host2.hasParked()).toBe(true) // boot did not kill it
    expect(host2.restoreParkedIfAny()).toBe(true)
    expect(serializeWorld(session2.doc)).toBe(studentBytes)
    // Spent by the restore itself — NOT stale-killed mid-restore (the
    // restore's own world-loaded is bracketed out of the listener).
    expect(host2.hasParked()).toBe(false)

    // The resume-aware start re-parks and re-loads the island: the park
    // holds the student's bytes again, and the fixture is live.
    expect(host2.loadFixture('showcase-island')).toBe(true)
    expect(progressStorage.map.get(PARKED_WORLD_KEY)).toBe(studentBytes)
    expect(session2.fixtureActive).toBe(true)
  })

  it('the full story: edits → three-views parks → save refused → back home → save succeeds', () => {
    const slots = memoryStorage()
    const session = makeSession(slots)
    const progressStorage = mapProgressStorage()
    const host = createEditorTutorialHost(session, { storage: progressStorage })
    const engine = createTutorialEngine(host, lessons)

    // The student EDITS their world (never saved — the park is all that
    // protects these edits through the lesson detour)…
    session.bus.dispatch({ kind: 'place-entity', marker: 'tree', position: { x: 3.5, y: 3.5 }, elevation: 0 })
    const editedBytes = serializeWorld(session.doc)

    // …and starts the fixture lesson: parked, fixture live.
    engine.start('three-views')
    expect(session.doc.meta.name).toBe('showcase island')
    expect(session.fixtureActive).toBe(true)
    expect(progressStorage.map.get(PARKED_WORLD_KEY)).toBe(editedBytes)

    // Ctrl+S on the island: refused, and the save slots never hear of it.
    const refused = session.save()
    expect(refused.ok).toBe(false)
    expect(slots.map.size).toBe(0) // not one write — not even a tmp slot

    // Back to my world: the edits are back — honestly UNSAVED (they sit in
    // no save slot yet; the badge says so and names the fix)…
    expect(host.restoreParkedIfAny()).toBe(true)
    expect(serializeWorld(session.doc)).toBe(editedBytes)
    expect(session.fixtureActive).toBe(false)
    expect(session.store.getState().persistence).toEqual({
      state: 'unsaved',
      message: 'back from the lesson — press Ctrl+S to keep your world',
    })
    // …and save works again, closing the window.
    expect(session.save()).toEqual({ ok: true })
    expect(slots.map.get('world')).toBe(editedBytes)
    expect(session.store.getState().persistence).toEqual({ state: 'saved', message: null })

    engine.dispose()
  })
})

// ---------------------------------------------------------------------------
// The progress store
// ---------------------------------------------------------------------------

describe('the progress store', () => {
  it('round-trips progress as JSON under the one key', () => {
    const storage = mapProgressStorage()
    const host = createEditorTutorialHost(makeSession(), { storage })
    const progress = { lessonId: 'first-tiles', stepIndex: 2, revealedHints: 1 }

    host.progress.write(progress)
    expect(storage.map.has(TUTORIAL_PROGRESS_KEY)).toBe(true)
    expect(host.progress.read()).toEqual(progress)

    host.progress.clear()
    expect(host.progress.read()).toBeNull()
    expect(storage.map.has(TUTORIAL_PROGRESS_KEY)).toBe(false)
  })

  it('corrupt or mis-shaped stored bytes read as null, never as a crash', () => {
    const storage = mapProgressStorage()
    const host = createEditorTutorialHost(makeSession(), { storage })

    storage.map.set(TUTORIAL_PROGRESS_KEY, '{ not even json')
    expect(host.progress.read()).toBeNull()

    storage.map.set(TUTORIAL_PROGRESS_KEY, JSON.stringify({ lessonId: 42, stepIndex: 'two' }))
    expect(host.progress.read()).toBeNull()

    storage.map.set(TUTORIAL_PROGRESS_KEY, JSON.stringify(null))
    expect(host.progress.read()).toBeNull()
  })

  it('is node-safe by default: no localStorage in sight, every operation stays quiet', () => {
    // No injected storage, and this test file runs in node where
    // localStorage does not exist — the default resolves to "nothing".
    const host = createEditorTutorialHost(makeSession())
    expect(host.progress.read()).toBeNull()
    expect(() => host.progress.write({ lessonId: 'x', stepIndex: 0, revealedHints: 0 })).not.toThrow()
    expect(() => host.progress.clear()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

describe('publish', () => {
  it('lands in the snapshot tutorial slice, and refreshSnapshot PRESERVES it', () => {
    const session = makeSession()
    const host = createEditorTutorialHost(session, { storage: mapProgressStorage() })

    const state: TutorialUiState = {
      lessonId: 'first-tiles',
      arc: 'coordinates',
      title: 'First tiles',
      stepId: 'paint-a-tile',
      stepIndex: 0,
      stepCount: 5,
      stepTitle: 'Paint a tile',
      instruction: 'Paint one square.',
      hints: [],
      hintsRemaining: 2,
      target: { kind: 'anchor', anchor: 'palette.tiles' },
      done: false,
    }
    host.publish(state)
    expect(session.store.getState().tutorial).toBe(state)

    // A real session mutation rebuilds the WHOLE snapshot — the tutorial
    // slice must survive it by reference (session.ts's deliberate omission).
    session.bus.dispatch({ kind: 'place-entity', marker: 'crate', position: { x: 2.5, y: 2.5 }, elevation: 0 })
    expect(session.store.getState().lastAction).toBe('placed crate') // the refresh really happened
    expect(session.store.getState().tutorial).toBe(state)

    host.publish(null)
    expect(session.store.getState().tutorial).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Publish announces rail changes through the one voice (session.announce)
// ---------------------------------------------------------------------------

describe('publish → announce (screen readers hear the rail move)', () => {
  /** A lesson-01-shaped TutorialUiState with overridable fields. */
  function uiState(over: Partial<TutorialUiState>): TutorialUiState {
    return {
      lessonId: 'first-tiles',
      arc: 'coordinates',
      title: 'First tiles',
      stepId: 'paint-a-tile',
      stepIndex: 0,
      stepCount: 5,
      stepTitle: 'Paint a tile',
      instruction: 'Paint one square.',
      hints: [],
      hintsRemaining: 2,
      target: null,
      done: false,
      ...over,
    }
  }

  it('first publish is silent; each subsequent change announces exactly once, with the pinned strings', () => {
    const session = makeSession()
    const host = createEditorTutorialHost(session, { storage: mapProgressStorage() })
    const seq0 = session.store.getState().lastActionSeq
    const action0 = session.store.getState().lastAction

    // The FIRST publish after a start: the rail rendering is its own
    // announcement — a resume must not speak.
    host.publish(uiState({}))
    expect(session.store.getState().lastAction).toBe(action0)
    expect(session.store.getState().lastActionSeq).toBe(seq0)

    // A step change: 'step N of M: {stepTitle}' — exactly one bump.
    host.publish(
      uiState({ stepId: 'find-the-address', stepIndex: 1, stepTitle: 'Find the address (12, 4)' }),
    )
    expect(session.store.getState().lastAction).toBe('step 2 of 5: Find the address (12, 4)')
    expect(session.store.getState().lastActionSeq).toBe(seq0 + 1)

    // The same position republished: nothing changed, nothing said.
    host.publish(
      uiState({ stepId: 'find-the-address', stepIndex: 1, stepTitle: 'Find the address (12, 4)' }),
    )
    expect(session.store.getState().lastActionSeq).toBe(seq0 + 1)

    // A newly revealed hint: 'hint: {the hint text}'.
    host.publish(
      uiState({
        stepId: 'find-the-address',
        stepIndex: 1,
        stepTitle: 'Find the address (12, 4)',
        hints: ['Count from the bottom-left corner.'],
        hintsRemaining: 1,
      }),
    )
    expect(session.store.getState().lastAction).toBe('hint: Count from the bottom-left corner.')
    expect(session.store.getState().lastActionSeq).toBe(seq0 + 2)

    // Hints collapsing (reset) is silent: nothing NEW to say.
    host.publish(
      uiState({ stepId: 'find-the-address', stepIndex: 1, stepTitle: 'Find the address (12, 4)' }),
    )
    expect(session.store.getState().lastActionSeq).toBe(seq0 + 2)

    // Done: 'lesson complete: {title}' — once, even though stepIndex moved.
    host.publish(uiState({ stepId: null, stepIndex: 5, stepTitle: '', done: true }))
    expect(session.store.getState().lastAction).toBe('lesson complete: First tiles')
    expect(session.store.getState().lastActionSeq).toBe(seq0 + 3)

    // Done republished (a resume straight into done): silent.
    host.publish(uiState({ stepId: null, stepIndex: 5, stepTitle: '', done: true }))
    expect(session.store.getState().lastActionSeq).toBe(seq0 + 3)

    // The rail emptying (dispose) narrates nothing.
    host.publish(null)
    expect(session.store.getState().lastActionSeq).toBe(seq0 + 3)
  })

  it('a lesson switch is a fresh start: its first publish is silent, its second speaks', () => {
    const session = makeSession()
    const host = createEditorTutorialHost(session, { storage: mapProgressStorage() })
    host.publish(uiState({}))
    const seq = session.store.getState().lastActionSeq

    // Another lesson arrives mid-flight (the picker): suppressed — the
    // whole rail re-rendered, and that is its own announcement.
    host.publish(
      uiState({ lessonId: 'three-views', title: 'Three views of one world', stepId: 'the-map-view', stepTitle: 'The map view', stepCount: 4 }),
    )
    expect(session.store.getState().lastActionSeq).toBe(seq)

    // But the NEXT change within it speaks normally.
    host.publish(
      uiState({
        lessonId: 'three-views',
        title: 'Three views of one world',
        stepId: 'the-diamond-view',
        stepIndex: 1,
        stepTitle: 'Squares into diamonds',
        stepCount: 4,
      }),
    )
    expect(session.store.getState().lastAction).toBe('step 2 of 4: Squares into diamonds')
    expect(session.store.getState().lastActionSeq).toBe(seq + 1)
  })

  it('rail announcements and builder events share lastActionSeq monotonically', () => {
    const session = makeSession()
    const host = createEditorTutorialHost(session, { storage: mapProgressStorage() })
    host.publish(uiState({})) // silent first publish
    expect(session.store.getState().lastActionSeq).toBe(1) // boot's 'loaded world'

    session.bus.dispatch({ kind: 'place-entity', marker: 'crate', position: { x: 2.5, y: 2.5 }, elevation: 0 })
    expect(session.store.getState().lastActionSeq).toBe(2)
    expect(session.store.getState().lastAction).toBe('placed crate')

    host.publish(
      uiState({ stepId: 'place-a-crate', stepIndex: 2, stepTitle: 'Place a crate' }),
    )
    expect(session.store.getState().lastActionSeq).toBe(3)
    expect(session.store.getState().lastAction).toBe('step 3 of 5: Place a crate')

    session.bus.undo()
    expect(session.store.getState().lastActionSeq).toBe(4)
    expect(session.store.getState().lastAction).toBe('undid: place crate')
  })
})

// ---------------------------------------------------------------------------
// The full engine over the editor — the in-process twin of the e2e gate
// ---------------------------------------------------------------------------

describe('lesson-01 driven to done through real session mutations', () => {
  it('paint → address → place → keyboard-move → save: the rail advances at every gate', () => {
    const session = makeSession()
    const brush = createBrushTool(session)
    const select = createSelectTool(session)
    const placer = createPlacerTool(session)
    session.addTool(brush)
    session.addTool(select)
    session.addTool(placer)

    const progressStorage = mapProgressStorage()
    const host = createEditorTutorialHost(session, { storage: progressStorage })
    const engine = createTutorialEngine(host, lessons)

    engine.start('first-tiles')
    expect(railOf(session)?.stepId).toBe('paint-a-tile')
    expect(railOf(session)?.stepIndex).toBe(0)

    // STEP 1 — paint any tile, by keyboard: the one-cell stroke (begin →
    // paint → end) emits exactly one tile-painted. Water on grass so the
    // cell really changes (painting grass on grass emits nothing).
    session.setActiveTile(2)
    session.moveCursor(0, 0) // summons the cursor at (16, 12)
    session.actAtCursor()
    expect(railOf(session)?.stepId).toBe('find-the-address')

    // STEP 2 — water at exactly (12, 4), by pointer stroke: down paints the
    // cell (the document mutates NOW), up ends the gesture — and it is the
    // end()'s tile-painted event that triggers the machine's world re-check.
    brush.onPointerDown(ev({ tile: { tx: 12, ty: 4 }, world: { x: 12.5, y: 4.5, z: 0 } }))
    brush.onPointerUp(ev({}))
    const ground = session.doc.layers.find((layer) => layer.id === 'ground')
    if (ground === undefined) throw new Error('starter world lost its ground layer')
    expect(getCell(ground, 12, 4)).toBe(2) // the world holds the fact…
    expect(railOf(session)?.stepId).toBe('place-a-crate') // …and the rail moved on it

    // STEP 3 — place a crate through the placer's keyboard door: Enter at
    // the cursor cell dispatches one place-entity (and selects the result).
    session.setActiveMarker('crate')
    session.setActiveTool('placer')
    session.moveCursor(-11, -7) // (16, 12) → (5, 5)
    session.actAtCursor()
    expect(railOf(session)?.stepId).toBe('move-your-crate')

    // STEP 4 — the keyboard grab-carry-drop: Enter on the selected crate's
    // cell grabs it, arrows carry the ghost, Enter drops — ONE move-entity,
    // one entity-moved, indistinguishable from a pointer drag.
    session.setActiveTool('select')
    session.actAtCursor() // grab (the placer left the crate selected, cursor on its cell)
    session.moveCursor(2, 1) // carry to (7, 6)
    session.actAtCursor() // drop
    expect(session.doc.entities['e2']?.components['position']).toEqual({ x: 7.5, y: 6.5 })
    expect(railOf(session)?.stepId).toBe('save-your-world')

    // STEP 5 — save. Done: the rail congratulates, and progress remembers.
    expect(session.save()).toEqual({ ok: true })
    const done = railOf(session)
    expect(done?.done).toBe(true)
    expect(done?.stepId).toBeNull()
    expect(done?.stepIndex).toBe(5)
    expect(JSON.parse(progressStorage.map.get(TUTORIAL_PROGRESS_KEY) ?? '')).toEqual({
      lessonId: 'first-tiles',
      stepIndex: 5,
      revealedHints: 0,
    })

    // The finish survives a "reload": dispose the first engine (the tab
    // closing) and run a fresh one over the same stores — it resumes
    // straight to done (a Phase 3 exit criterion, in miniature).
    engine.dispose()
    expect(railOf(session)).toBeNull() // dispose publishes the empty rail
    const engine2 = createTutorialEngine(host, lessons)
    engine2.start('first-tiles')
    expect(railOf(session)?.done).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Shipped lesson data vs the frozen builder.* vocabulary (moved here from
// the retired lesson-harness test — the app-side echo of the governance
// snapshot in packages/tutorial/test/freeze.test.ts)
// ---------------------------------------------------------------------------

describe('shipped lesson data vs the real builder.* vocabulary', () => {
  // Every member of the frozen BuilderEvent union, as a value list. The
  // `satisfies` clause rejects typos and strangers; the NoMissing check
  // below rejects omissions — add a BuilderEvent variant without listing it
  // here and the app typecheck fails, so this list cannot silently rot.
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
    'builder.view-projection-changed',
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

  it('no shipped lesson leans on an alias — at the freeze, every name is a current name', () => {
    for (const lesson of lessons) {
      for (const step of lesson.steps) {
        if (step.completion.kind !== 'event') continue
        expect(
          BUILDER_EVENT_ALIASES[step.completion.type],
          `${lesson.id}/${step.id}: aliased names belong to POST-freeze renames, not fresh lesson data`,
        ).toBeUndefined()
      }
    }
  })
})
