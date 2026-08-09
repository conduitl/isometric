/**
 * Shipped-lesson checks, in three layers.
 *
 * Schema validity is the REAL validator's job: `validateLessons` from
 * @engine/tutorial is the same code CI and the authoring loop run, so this
 * test simply demands it finds nothing — ids, prose, hints, predicate
 * shapes, event-type resolution, composition rules all live THERE, not in
 * hand-rolled copies here.
 *
 * What remains hand-rolled is what the validator cannot know:
 *
 * 1. STARTER-WORLD COORDINATION. Lessons without a fixture run on the
 *    editor's starter world, and the starter world has geography — a 32×24
 *    ground layer, a pond (tx 5–8, ty 4–6) with a computed one-cell sand
 *    rim, and a player standing at (16.5, 12.5). A cell predicate outside
 *    the layer can never complete; one inside the pond+rim box is
 *    pre-satisfied (or asks the student to destroy the pond); an entity on
 *    the player's own cell is a pile-up. Those facts live in
 *    apps/editor/src/editor/starter.ts — and @content/lessons must stay a
 *    leaf package that cannot import the editor — so the numbers are pinned
 *    here as literals, beside the lesson data that leans on them. Fixture
 *    lessons are exempt (their world is the fixture, not the starter).
 *
 * 2. ANCHOR MEMBERSHIP. Step targets may name editor chrome only by
 *    registry id. The registry (apps/editor/src/editor/anchors.ts) is the
 *    app-side source of truth this package cannot import, so a mirror of
 *    the legal ids is maintained below — additive-only, like the registry.
 *
 * 3. CURRICULUM ARITHMETIC. Lesson 02's whole story is numbers ("legs 3
 *    and 4, distance 5"); a wrong number in curriculum is a HIGH bug, so
 *    every distance claim is recomputed here from the lesson data itself:
 *    cell centers, deltas, hypotenuse.
 */

import { describe, expect, it } from 'vitest'
import { validateLessons } from '@engine/tutorial'
import type { StepPredicate, StepTarget } from '@engine/tutorial'
import { lesson02, lessons } from '../src/index'

// ---------------------------------------------------------------------------
// Starter-world facts (StarterWorld contract, apps/editor/src/editor/types.ts)
// ---------------------------------------------------------------------------

/** Starter ground layer bounds: 32×24 cells, addresses 0-based. */
const GROUND_WIDTH = 32
const GROUND_HEIGHT = 24

/** The starter pond (tx 5–8, ty 4–6) grown by its one-cell sand rim,
 * inclusive box. No starter-world cell predicate may point inside. */
const POND_AND_RIM = { minTx: 4, maxTx: 9, minTy: 3, maxTy: 7 }

/** The starter player: standing at (16.5, 12.5), the CENTER of cell
 * (16, 12) — cell-dwellers stand on centers (the +0.5 lesson). */
const PLAYER = { x: 16.5, y: 12.5 }
const PLAYER_CELL = { tx: 16, ty: 12 }

const inPondOrRim = (tx: number, ty: number): boolean =>
  tx >= POND_AND_RIM.minTx && tx <= POND_AND_RIM.maxTx && ty >= POND_AND_RIM.minTy && ty <= POND_AND_RIM.maxTy

// ---------------------------------------------------------------------------
// The legal-anchor mirror
// ---------------------------------------------------------------------------

/**
 * MIRROR of the anchor registry — the source of truth is ANCHOR_IDS in
 * apps/editor/src/editor/anchors.ts (D5 governance: additive-only,
 * alias-forwarded, CI-checked on the app side). Content cannot import the
 * app, so the list is copied here; when the registry grows, grow this list.
 * A lesson pointing at an id missing from the real registry would spotlight
 * nothing, so membership here is a shipping requirement.
 */
const LEGAL_ANCHORS: ReadonlySet<string> = new Set([
  'palette.entities',
  'palette.tiles',
  'panel.entities',
  'panel.inspector',
  'panel.layers',
  'panel.lesson',
  'panel.lessonHint',
  'panel.lessonPicker',
  'panel.lessonReset',
  'panel.lessonShowMe',
  'status.announcements',
  'status.coords',
  'status.saveState',
  'status.zoom',
  'toolbar.brush',
  'toolbar.export',
  'toolbar.import',
  'toolbar.placer',
  'toolbar.redo',
  'toolbar.restoreBackup',
  'toolbar.save',
  'toolbar.select',
  'toolbar.undo',
  'toolbar.viewIso',
  'toolbar.viewProfile',
  'toolbar.viewTopdown',
  'toolbar.worldName',
  'viewport.canvas',
])

// ---------------------------------------------------------------------------
// Predicate walking
// ---------------------------------------------------------------------------

/** Every cell-addressed leaf in a predicate tree: tile-at, entity-at, and
 * an event predicate's `toCell` destination (the entity-moved moment-gate
 * names a cell too, and that cell must obey the same geography rules —
 * on the board, off the pond, off the player). all/any recursed — the
 * validator guarantees no event leaves hide in there, but cell-addressed
 * world leaves are legal. */
function cellLeaves(predicate: StepPredicate): Array<{ kind: string; tx: number; ty: number }> {
  switch (predicate.kind) {
    case 'tile-at':
    case 'entity-at':
      return [{ kind: predicate.kind, tx: predicate.tx, ty: predicate.ty }]
    case 'event':
      return predicate.toCell === undefined
        ? []
        : [{ kind: 'event-toCell', tx: predicate.toCell.tx, ty: predicate.toCell.ty }]
    case 'all':
    case 'any':
      return predicate.of.flatMap(cellLeaves)
    default:
      return []
  }
}

/** Every world cell a step points at: cell-addressed completion leaves plus
 * a cell-kind target — all must sit on the board the student is shown. */
function stepCells(
  completion: StepPredicate,
  target: StepTarget | undefined,
): Array<{ kind: string; tx: number; ty: number }> {
  const cells = cellLeaves(completion)
  if (target?.kind === 'cell') cells.push({ kind: 'target-cell', tx: target.tx, ty: target.ty })
  return cells
}

/** The mini-formatter renders unterminated markers literally, so a typo can
 * never eat text — but a shipped lesson should not lean on that mercy.
 * Balanced markers = an even number of '**' and of '`' occurrences. */
function markersBalanced(text: string): boolean {
  return (text.split('**').length - 1) % 2 === 0 && (text.split('`').length - 1) % 2 === 0
}

const allSteps = lessons.flatMap((lesson) => lesson.steps.map((step) => ({ lesson, step })))

/** Lessons that run on the STUDENT'S world — the starter-coordination
 * checks apply to exactly these. Fixture lessons play on their own stage. */
const starterSteps = lessons
  .filter((lesson) => lesson.fixture === undefined)
  .flatMap((lesson) => lesson.steps.map((step) => ({ lesson, step })))

describe('schema validity — the real validator, the one CI runs', () => {
  it('ships the three v1 arcs', () => {
    expect(lessons.map((lesson) => lesson.arc)).toEqual(['coordinates', 'distance', 'perspectives'])
  })

  it('validateLessons finds no problems in any shipped lesson', () => {
    expect(validateLessons(lessons)).toEqual([])
  })
})

describe('starter-world coordination (facts the validator cannot know)', () => {
  it('every cell a starter-world step names sits inside the 32×24 ground layer', () => {
    for (const { lesson, step } of starterSteps) {
      for (const { tx, ty } of stepCells(step.completion, step.target)) {
        const where = `${lesson.id}/${step.id}`
        expect(Number.isInteger(tx) && Number.isInteger(ty), `${where}: non-integer cell address`).toBe(true)
        expect(tx, `${where}: tx out of bounds`).toBeGreaterThanOrEqual(0)
        expect(tx, `${where}: tx out of bounds`).toBeLessThan(GROUND_WIDTH)
        expect(ty, `${where}: ty out of bounds`).toBeGreaterThanOrEqual(0)
        expect(ty, `${where}: ty out of bounds`).toBeLessThan(GROUND_HEIGHT)
      }
    }
  })

  it('no cell-addressed predicate points inside the starter pond or its sand rim', () => {
    // A pre-satisfied tile target skips its step the moment the previous
    // one completes; an entity target on water asks for a floating crate.
    for (const { lesson, step } of starterSteps) {
      for (const { kind, tx, ty } of cellLeaves(step.completion)) {
        expect(
          inPondOrRim(tx, ty),
          `${lesson.id}/${step.id}: ${kind} (${tx}, ${ty}) is inside the starter pond+rim`,
        ).toBe(false)
      }
    }
  })

  it('no entity-addressed predicate points at the player’s own cell', () => {
    // entity-at asks something to STAND there; an entity-moved toCell asks
    // something to LAND there — either way, the player's cell is a pile-up.
    for (const { lesson, step } of starterSteps) {
      for (const { kind, tx, ty } of cellLeaves(step.completion)) {
        if (kind !== 'entity-at' && kind !== 'event-toCell') continue
        expect(
          tx === PLAYER_CELL.tx && ty === PLAYER_CELL.ty,
          `${lesson.id}/${step.id}: ${kind} (${tx}, ${ty}) is the player's cell`,
        ).toBe(false)
      }
    }
  })
})

describe('anchor targets stay inside the registry mirror', () => {
  it('every anchor a step targets is a registered anchor id', () => {
    for (const { lesson, step } of allSteps) {
      if (step.target?.kind !== 'anchor') continue
      expect(
        LEGAL_ANCHORS.has(step.target.anchor),
        `${lesson.id}/${step.id}: anchor "${step.target.anchor}" is not in the registry mirror ` +
          '(source of truth: apps/editor/src/editor/anchors.ts)',
      ).toBe(true)
    }
  })
})

describe('lesson 02 arithmetic — every distance claim recomputed', () => {
  /** The placer sets entities at cell CENTERS: cell (tx, ty) → (tx+0.5, ty+0.5). */
  const center = (tx: number, ty: number): { x: number; y: number } => ({ x: tx + 0.5, y: ty + 0.5 })

  /** The crate cells lesson 02 walks, with the legs and distance its prose
   * claims for each — the lesson's numbers, restated independently. `gate`
   * pins HOW each step completes: the placement is a world fact
   * (entity-at, the accepted narrow residual — see the lesson header), and
   * every move is a moment (entity-moved landing in the cell), so a
   * leftover crate parked on a destination can never auto-skip a move. */
  const claims = [
    { stepId: 'three-east', gate: 'entity-at', cell: { tx: 19, ty: 12 }, legs: { east: 3, north: 0 }, distance: 3 },
    { stepId: 'four-north', gate: 'moved-to', cell: { tx: 19, ty: 16 }, legs: { east: 3, north: 4 }, distance: 5 },
    { stepId: 'the-other-corner', gate: 'moved-to', cell: { tx: 20, ty: 15 }, legs: { east: 4, north: 3 }, distance: 5 },
    { stepId: 'predict-then-look', gate: 'moved-to', cell: { tx: 22, ty: 20 }, legs: { east: 6, north: 8 }, distance: 10 },
  ] as const

  it('the placement gates entity-at, and every move gates the entity-moved moment, at the claimed cell', () => {
    for (const claim of claims) {
      const step = lesson02.steps.find((candidate) => candidate.id === claim.stepId)
      expect(step, `lesson 02 is missing step "${claim.stepId}"`).toBeDefined()
      expect(step?.completion).toEqual(
        claim.gate === 'entity-at'
          ? { kind: 'entity-at', marker: 'crate', tx: claim.cell.tx, ty: claim.cell.ty }
          : {
              kind: 'event',
              type: 'builder.entity-moved',
              toCell: { tx: claim.cell.tx, ty: claim.cell.ty },
            },
      )
    }
  })

  it('cell centers, deltas, and hypotenuses match the prose exactly', () => {
    for (const claim of claims) {
      const crate = center(claim.cell.tx, claim.cell.ty)
      const east = crate.x - PLAYER.x
      const north = crate.y - PLAYER.y
      // Whole-number legs are the lesson's design: center-to-center between
      // cell-dwellers, so the prose never needs to round.
      expect(east, `${claim.stepId}: east leg`).toBe(claim.legs.east)
      expect(north, `${claim.stepId}: north leg`).toBe(claim.legs.north)
      const measured = Math.hypot(east, north)
      // Within float dust of exact — and far inside the entity-distance
      // predicate's default 0.05 tolerance.
      expect(Math.abs(measured - claim.distance), `${claim.stepId}: hypotenuse`).toBeLessThanOrEqual(1e-9)
    }
  })

  it('no movement step asks for the cell the crate already stands on', () => {
    // Step N's cell must differ from step N−1's resting place. For the old
    // entity-at gates that was pre-satisfaction (the step completed the
    // instant it became current); for the moved-to gates it is the OPPOSITE
    // failure — a snapped move onto the cell the crate already occupies
    // commits nothing and emits no event, so the step could never complete.
    // Either way, consecutive cells must differ.
    for (let i = 1; i < claims.length; i += 1) {
      const previous = claims[i - 1]
      const current = claims[i]
      if (previous === undefined || current === undefined) throw new Error('claims table is dense')
      expect(
        previous.cell.tx === current.cell.tx && previous.cell.ty === current.cell.ty,
        `${current.stepId}: same cell as ${previous.stepId}`,
      ).toBe(false)
    }
  })
})

describe('fixture lessons survive a missing fixture', () => {
  it('every step of a fixture lesson gates on an event, never on fixture terrain', () => {
    // loadFixture may return false (host does not know the id) and the
    // lesson then runs on the current world — so a fixture lesson may not
    // depend on facts about the fixture's cells or entities.
    for (const lesson of lessons) {
      if (lesson.fixture === undefined) continue
      for (const step of lesson.steps) {
        expect(
          step.completion.kind,
          `${lesson.id}/${step.id}: fixture-lesson step must gate on an event`,
        ).toBe('event')
      }
    }
  })
})

describe('prose formatting and hint escalation', () => {
  it('instruction and every hint parse cleanly (balanced ** and ` marks)', () => {
    for (const { lesson, step } of allSteps) {
      const where = `${lesson.id}/${step.id}`
      expect(markersBalanced(step.instruction), `${where}: unbalanced markers in instruction`).toBe(true)
      for (const [i, hint] of step.hints.entries()) {
        expect(markersBalanced(hint), `${where}: unbalanced markers in hints[${i}]`).toBe(true)
      }
    }
  })

  it('hints escalate: at least two per step, and hints[1] names the keyboard path', () => {
    // Some students never touch the mouse; the spelled-out hint must name
    // keys. The check is a heuristic (a named key or the word "keyboard"),
    // strong enough to catch a mouse-only second hint.
    const mentionsKeys = /keyboard|arrow keys|`Tab`|`Enter`|`Ctrl\+|`Cmd\+/i
    for (const { lesson, step } of allSteps) {
      const where = `${lesson.id}/${step.id}`
      expect(step.hints.length, `${where}: needs a nudge hint AND a spelled-out hint`).toBeGreaterThanOrEqual(2)
      const spelledOut = step.hints[1]
      expect(spelledOut, `${where}: hints[1] missing`).toBeDefined()
      expect(
        spelledOut !== undefined && mentionsKeys.test(spelledOut),
        `${where}: hints[1] must include the keyboard path`,
      ).toBe(true)
    }
  })
})
