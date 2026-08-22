/**
 * THE LESSON-REPLAY CORPUS — the CI artifact behind the Phase 3 exit
 * criterion "the corpus proves every step completable".
 *
 * For every shipped lesson this file holds one SCRIPT: a synthetic student
 * driven through the REAL tutorial engine by `replayLesson` from
 * @engine/tutorial (auto-advance, effects, the event-then-world cascade all
 * run exactly as in the shipped editor). The gate at the bottom demands
 * every lesson complete with stepsCompleted === steps.length — when an
 * editor refactor or a careless lesson edit strands a student, THIS file
 * fails, and `stuckAt` names the broken step.
 *
 * ## For the next author — how to add a lesson's script
 *
 * 1. Add your lesson to `lessons` in src/index.ts. The registry test below
 *    fails until a corpus entry exists — that is the authoring duty.
 * 2. Write the script as a list of beats in the MUTATE-THEN-ANNOUNCE
 *    convention (pinned in packages/tutorial/src/replay.ts, which is
 *    required reading): first change the document the way the editor's
 *    command would (paint the cell, spawn the crate at its CENTER, write
 *    the moved position), then feed the builder.* event the editor would
 *    emit afterwards. That order is the editor's own — the step machine
 *    re-checks world predicates on the event FOLLOWING a mutation, so a
 *    mutation without its announcing event advances nothing.
 *    Event-only beats (saves, view switches) have no mutation half.
 * 3. Do NOT import the editor app. Starter-world lessons replay against
 *    the inline starter-facts document below, which mirrors the pinned
 *    StarterWorld contract (apps/editor/src/editor/types.ts) — if that
 *    contract ever changes, change the mirror here in the same PR.
 *
 * ## The fixture stand-in, on purpose
 *
 * This host's loadFixture returns FALSE for every id — the corpus has no
 * 'showcase-island', 'bear-portrait-start', or 'bear-figure-start' (fixtures
 * are app assets). Lessons 00, 'the-third-number', and 03 must complete
 * anyway, and the tests assert they do: a fixture lesson gates every step on
 * events precisely so it survives a host that cannot stage its scenery
 * (lessons.test.ts pins that rule for all fixture lessons).
 */

import { describe, expect, it } from 'vitest'
import { createWorld, spawn } from '@engine/core'
import type { EntityId, TileLayer, World } from '@engine/core'
import { replayLesson } from '@engine/tutorial'
import type { Lesson, ReplayAction, ReplayHost, StepEffect } from '@engine/tutorial'
import { lessons } from '../src/index'

// ---------------------------------------------------------------------------
// The starter-facts document (mirror of the pinned StarterWorld contract)
// ---------------------------------------------------------------------------

const WIDTH = 32
const HEIGHT = 24
const GRASS = 1
const WATER = 2
const SAND = 3
const STONE = 4

/** The 'portrait' tileset's locked values this corpus's paint events name
 * (IMPLEMENTATION-NOTES' palette table; apps/editor/src/editor/fixtures.ts
 * is the one true copy). Mirrors GRASS/WATER/SAND/STONE above — named so a
 * paint beat below reads as "chick yellow", not a bare 2. */
const CHICK_YELLOW = 2
const BEAK_ORANGE = 3
const INK_BLACK = 5
const FLOOR_LIGHT = 6

/** The pinned pond box (tx 5–8, ty 4–6); its one-cell rim is sand. */
const inPond = (tx: number, ty: number): boolean => tx >= 5 && tx <= 8 && ty >= 4 && ty <= 6

/**
 * Build the starter facts inline: 32×24 'ground' grass layer, the pond and
 * its sand rim, one player standing at (16.5, 12.5) — the center of cell
 * (16, 12). Layers are hand-rolled literals (no @engine/tilemap, no app
 * imports); the cosmetic fields (names, tileset id) match the starter for
 * honesty, though no lesson predicate reads them.
 */
function starterFactsDoc(): World {
  const world = createWorld({
    name: 'my first world',
    settings: { tileSize: 1, primaryProjection: 'topdown', seed: 7 },
  })
  const cells = new Uint16Array(WIDTH * HEIGHT).fill(GRASS)
  for (let ty = 3; ty <= 7; ty += 1) {
    for (let tx = 4; tx <= 9; tx += 1) {
      // index = y·width + x — the taught row-major formula.
      cells[ty * WIDTH + tx] = inPond(tx, ty) ? WATER : SAND
    }
  }
  const ground: TileLayer = {
    id: 'ground',
    name: 'ground',
    width: WIDTH,
    height: HEIGHT,
    elevation: 0,
    layerBand: 0,
    tilesetId: 'terrain',
    cells,
  }
  world.layers.push(ground)
  spawn(world, {
    name: 'player',
    components: { position: { x: 16.5, y: 12.5 }, elevation: { z: 0 }, marker: { kind: 'player' } },
  })
  return world
}

/** The player is e1 (spawned first), so the script's crate is minted e2 —
 * deterministic by the world's own counter (D2), pinned here so the
 * announced events can carry the honest id. */
const CRATE_ID: EntityId = 'e2'

// ---------------------------------------------------------------------------
// Script-building helpers (each returns the mutate-then-announce PAIR)
// ---------------------------------------------------------------------------

/** One completed brush gesture: write the cell, announce tile-painted. The
 * announcement half delegates to {@link paintEventBeat} so the corpus holds
 * exactly ONE definition of the frozen tile-painted payload — a field added
 * to the vocabulary gets added in one place or the type checker objects. */
function paintBeat(tx: number, ty: number, tile: number): ReplayAction[] {
  return [
    {
      kind: 'mutate',
      mutate(doc) {
        const layer = doc.layers[0]
        if (layer === undefined) throw new Error('corpus doc has no ground layer')
        layer.cells[ty * layer.width + tx] = tile
      },
    },
    paintEventBeat('ground', tile, tx, ty),
  ]
}

/** One placer act: spawn a crate at the CELL CENTER (+0.5 — the placer's
 * convention), announce entity-placed. */
function placeCrateBeat(tx: number, ty: number): ReplayAction[] {
  const x = tx + 0.5
  const y = ty + 0.5
  return [
    {
      kind: 'mutate',
      mutate(doc) {
        spawn(doc, {
          name: 'crate',
          components: { position: { x, y }, elevation: { z: 0 }, marker: { kind: 'crate' } },
        })
      },
    },
    {
      kind: 'event',
      event: { type: 'builder.entity-placed', id: CRATE_ID, marker: 'crate', name: 'crate', position: { x, y }, elevation: 0 },
    },
  ]
}

/** One completed move gesture: write the crate's new center, announce
 * entity-moved from the old center to the new. */
function moveCrateBeat(from: { tx: number; ty: number }, to: { tx: number; ty: number }): ReplayAction[] {
  const target = { x: to.tx + 0.5, y: to.ty + 0.5 }
  return [
    {
      kind: 'mutate',
      mutate(doc) {
        const crate = doc.entities[CRATE_ID]
        if (crate === undefined) throw new Error(`corpus script expected ${CRATE_ID} to exist before moving it`)
        crate.components['position'] = { x: target.x, y: target.y }
      },
    },
    {
      kind: 'event',
      event: {
        type: 'builder.entity-moved',
        id: CRATE_ID,
        from: { x: from.tx + 0.5, y: from.ty + 0.5, z: 0 },
        to: { x: target.x, y: target.y, z: 0 },
      },
    },
  ]
}

/**
 * One event-only paint announcement — no mutate half. `paintBeat` writes
 * `doc.layers[0]` because the starter-facts document only HAS the one
 * ground layer; the 'bear-portrait-start' fixture's 'portrait' and 'floor'
 * layers do not exist on this host's document at all (loadFixture returns
 * false — see the header), so there is nothing to mutate. This announces
 * exactly the event the editor's own brush stroke would raise, which is all
 * a fixture lesson's step machine ever re-checks against.
 */
function paintEventBeat(layerId: string, tile: number, tx: number, ty: number): ReplayAction {
  return {
    kind: 'event',
    event: { type: 'builder.tile-painted', layerId, tile, cells: [{ tx, ty }], toolId: 'brush' },
  }
}

/** Saves and view switches change no world state: event-only beats. */
const saveBeat: ReplayAction = {
  kind: 'event',
  event: { type: 'builder.world-saved', worldId: 'w7' }, // seed 7 → worldId 'w7'
}

function viewBeat(from: 'profile' | 'topdown' | 'iso', to: 'profile' | 'topdown' | 'iso'): ReplayAction {
  return { kind: 'event', event: { type: 'builder.view-projection-changed', from, to } }
}

// ---------------------------------------------------------------------------
// The corpus: one script per shipped lesson
// ---------------------------------------------------------------------------

/**
 * lessonId → the synthetic student that completes it. The registry test
 * below demands every entry of `lessons` appear here — adding a lesson
 * without a corpus script fails CI, which is the authoring duty made
 * mechanical.
 */
const corpus: Record<string, ReadonlyArray<ReplayAction>> = {
  // Lesson 00 — coordinates, on the 'bear-portrait-start' fixture. Every
  // beat is event-only, mirroring 'three-views' below: a fixture lesson
  // gates every step on events precisely so it survives this fixture-less
  // host, and there is no 'portrait'/'floor' layer on the starter-facts
  // document to mutate in the first place.
  'paint-by-numbers': [
    // Step 1 (event: bare tile-painted — the freebie): the checkered
    // floor, cell (0, 0) — deliberately NOT one of the four gated cells
    // below, so this beat can never masquerade as one of them.
    paintEventBeat('floor', FLOOR_LIGHT, 0, 0),
    // Step 2 (event: tile-painted, where tile 5/'portrait', atCell (5, 8)): the first eye.
    paintEventBeat('portrait', INK_BLACK, 5, 8),
    // Step 3 (event: tile-painted, where tile 5/'portrait', atCell (10, 8)): the second eye.
    paintEventBeat('portrait', INK_BLACK, 10, 8),
    // Step 4 (event: tile-painted, where tile 5/'portrait', atCell (7, 15)): the top feather.
    paintEventBeat('portrait', INK_BLACK, 7, 15),
    // Step 5 (event: tile-painted, where tile 2/'portrait', atCell (3, 0)): the foot pad.
    paintEventBeat('portrait', CHICK_YELLOW, 3, 0),
    // Step 6 (event: view-projection-changed, topdown → iso): Pip stands up.
    viewBeat('topdown', 'iso'),
  ],

  // 'the-third-number' — coordinates, on the 'bear-figure-start' fixture.
  // Every beat is event-only, mirroring 'paint-by-numbers' above: a fixture
  // lesson gates every step on events precisely so it survives this
  // fixture-less host, and there is no 'z1'..'z10' layer on the
  // starter-facts document to mutate in the first place.
  'the-third-number': [
    // Step 1 (event: tile-painted, where tile 2/'z1', atCell (6, 2)): the foot pad.
    paintEventBeat('z1', CHICK_YELLOW, 6, 2),
    // Step 2 (event: tile-painted, where tile 5/'z11', atCell (12, 9)): half the nose.
    paintEventBeat('z11', INK_BLACK, 12, 9),
    // Step 3 (event: tile-painted, where tile 3/'z14', atCell (13, 7)): the beak corner.
    paintEventBeat('z14', BEAK_ORANGE, 13, 7),
    // Step 4 (event: tile-painted, where tile 5/'z18', atCell (12, 13)): half the sprig.
    paintEventBeat('z18', INK_BLACK, 12, 13),
    // Step 5 (event: view-projection-changed, iso → profile): Pip in the round.
    viewBeat('iso', 'profile'),
    // Step 6 (event: view-projection-changed, profile → topdown): face on.
    viewBeat('profile', 'topdown'),
    // Step 7 (event: view-projection-changed, topdown → iso): three pictures, one Pip.
    viewBeat('topdown', 'iso'),
  ],

  // Arc 1 — coordinates, on the student's world.
  'first-tiles': [
    // Step 1 (event: any paint): stone somewhere neutral — deliberately NOT
    // (12, 4), so step 2's tile-at is exercised by its OWN beat, not by a
    // cascade from this one.
    ...paintBeat(2, 2, STONE),
    // Step 2 (tile-at water (12, 4)): completes on the event FOLLOWING the
    // cell write — the cascade in action.
    ...paintBeat(12, 4, WATER),
    // Step 3 (entity-exists crate): the placer's spawn-then-announce.
    ...placeCrateBeat(10, 18),
    // Step 4 (event: entity-moved): one completed drag gesture.
    ...moveCrateBeat({ tx: 10, ty: 18 }, { tx: 11, ty: 18 }),
    // Step 5 (event: world-saved).
    saveBeat,
  ],

  // Arc 2 — distance, on the student's world. The crate walks the 3-4-5
  // story: (19,12) → (19,16) → (20,15) → (22,20), every stop a cell center,
  // every leg whole-numbered (arithmetic pinned in lessons.test.ts). The
  // move steps gate on the entity-moved MOMENT with a `toCell` destination,
  // and each moveCrateBeat's event carries `to` at the destination's CENTER
  // (tx+0.5, ty+0.5) — which floors back to exactly the gated cell, the
  // same event the editor's own drag commit would announce.
  'the-distance-picture': [
    // Step 1 (entity-at (19,12)): the placement — spawn-then-announce.
    ...placeCrateBeat(19, 12),
    // Step 2 (entity-moved, toCell (19,16)): to = (19.5, 16.5) → floors to (19, 16).
    ...moveCrateBeat({ tx: 19, ty: 12 }, { tx: 19, ty: 16 }),
    // Step 3 (entity-moved, toCell (20,15)): to = (20.5, 15.5) → floors to (20, 15).
    ...moveCrateBeat({ tx: 19, ty: 16 }, { tx: 20, ty: 15 }),
    // Step 4 (entity-moved, toCell (22,20)): to = (22.5, 20.5) → floors to (22, 20).
    ...moveCrateBeat({ tx: 20, ty: 15 }, { tx: 22, ty: 20 }),
    // Step 5 (event: world-saved).
    saveBeat,
  ],

  // Arc 3 — perspectives, on the 'showcase-island' fixture. Every beat is
  // event-only: view switches never mutate the document, and the lesson
  // must complete even though this host cannot load the island at all.
  'three-views': [
    viewBeat('topdown', 'iso'), // step 1: the squares become diamonds
    viewBeat('iso', 'profile'), // step 2: edge-on
    viewBeat('profile', 'topdown'), // step 3: back around
    viewBeat('topdown', 'iso'), // step 4: one more flip, builder's choice
  ],
}

// ---------------------------------------------------------------------------
// The harness host: fresh starter doc, effect recorder, fixture-less
// ---------------------------------------------------------------------------

function makeHost(doc: World): { host: ReplayHost; effects: StepEffect[]; fixturesAsked: string[] } {
  const effects: StepEffect[] = []
  const fixturesAsked: string[] = []
  const host: ReplayHost = {
    doc: () => doc,
    applyEffect(effect) {
      effects.push(effect)
    },
    loadFixture(fixtureId) {
      fixturesAsked.push(fixtureId)
      return false // the corpus stages no fixtures — see the header
    },
  }
  return { host, effects, fixturesAsked }
}

function lessonById(id: string): Lesson {
  const lesson = lessons.find((candidate) => candidate.id === id)
  if (lesson === undefined) throw new Error(`no shipped lesson with id "${id}"`)
  return lesson
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe('the lesson-replay corpus (CI exit-criterion artifact)', () => {
  it('every shipped lesson has a corpus script — the authoring duty', () => {
    for (const lesson of lessons) {
      expect(corpus[lesson.id], `lesson "${lesson.id}" shipped without a replay-corpus script`).toBeDefined()
    }
  })

  for (const lesson of lessons) {
    it(`"${lesson.id}" completes: every step provably reachable by a real student`, () => {
      const script = corpus[lesson.id] ?? []
      const { host, fixturesAsked } = makeHost(starterFactsDoc())
      const result = replayLesson({ lesson, host, script })
      expect(result).toEqual({
        completed: true,
        stepsCompleted: lesson.steps.length,
        stuckAt: null,
      })
      // Fixture wiring is real even though staging is not: the engine must
      // have ASKED for the lesson's fixture before the first step.
      expect(fixturesAsked).toEqual(lesson.fixture === undefined ? [] : [lesson.fixture])
    })
  }

  it('lesson 02 applies the right-triangle overlay when the reveal arc begins', () => {
    // The overlay IS the lesson (the live legs-and-hypotenuse picture); a
    // corpus pass should certify it was requested, not just that steps
    // advanced past it.
    const script = corpus['the-distance-picture'] ?? []
    const { host, effects } = makeHost(starterFactsDoc())
    replayLesson({ lesson: lessonById('the-distance-picture'), host, script })
    const overlayEffects = effects.filter(
      (effect) => effect.kind === 'show-overlays' && effect.overlays.some((overlay) => overlay.kind === 'right-triangle'),
    )
    expect(overlayEffects.length).toBeGreaterThanOrEqual(1)
  })

  it('lesson 03 completes WITHOUT its fixture — event gating is the resilience, by design', () => {
    // loadFixture returned false, so the lesson ran on the plain starter
    // doc: no island, no plateau — and every step still completed, because
    // fixture lessons gate on events, never on fixture terrain.
    const script = corpus['three-views'] ?? []
    const { host } = makeHost(starterFactsDoc())
    const result = replayLesson({ lesson: lessonById('three-views'), host, script })
    expect(result.completed).toBe(true)
  })

  it('lesson 03 re-establishes each view lens as its steps are entered', () => {
    // The set-view-projection onEnter effects are the steps' stage setup;
    // the recorded stream pins their authored order (topdown at entry, then
    // each switched-to view re-declared) — bracketed by the machine's
    // clean-stage sweeps: a null at start (a new lesson begins on a clean
    // stage) and a null on reaching done (a finished lesson cleans up).
    const script = corpus['three-views'] ?? []
    const { host, effects } = makeHost(starterFactsDoc())
    replayLesson({ lesson: lessonById('three-views'), host, script })
    const views = effects.flatMap((effect) => (effect.kind === 'set-view-projection' ? [effect.projection] : []))
    expect(views).toEqual([null, 'topdown', 'iso', 'profile', null])
  })
})
