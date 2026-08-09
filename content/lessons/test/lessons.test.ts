/**
 * Data validity for every shipped lesson. These are the checks a curriculum
 * author's PR runs into first: ids well-formed, prose present, predicates
 * pointing at things that exist. They deliberately import nothing from the
 * editor app — @content/lessons must stay a leaf package — so the event
 * vocabulary is asserted against a local copy of the current draft list;
 * apps/editor/test/lesson-harness.test.ts cross-checks that same data
 * against the editor's REAL BuilderEvent type union, with a type-level
 * exhaustiveness guard, so this local list cannot silently rot.
 */

import { describe, expect, it } from 'vitest'
import { lessons } from '../src/index'

/** The current draft builder.* vocabulary (see the header for why this is a
 * local copy). Update alongside apps/editor/src/editor/events/builder.ts —
 * the editor-side cross-check fails if the two ever disagree on a type a
 * lesson actually uses. */
const KNOWN_BUILDER_EVENT_TYPES = [
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
]

/** Starter-world ground layer bounds (StarterWorld contract,
 * apps/editor/src/editor/types.ts): 32×24 cells, addresses 0-based. */
const GROUND_WIDTH = 32
const GROUND_HEIGHT = 24

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** The mini-formatter renders unterminated markers literally, so a typo can
 * never eat text — but a shipped lesson should not lean on that mercy.
 * Balanced markers = an even number of '**' and of '`' occurrences. */
function markersBalanced(text: string): boolean {
  return (text.split('**').length - 1) % 2 === 0 && (text.split('`').length - 1) % 2 === 0
}

const allSteps = lessons.flatMap((lesson) => lesson.steps.map((step) => ({ lesson, step })))

describe('lesson identity', () => {
  it('ships at least one lesson, and no lesson ships empty', () => {
    expect(lessons.length).toBeGreaterThan(0)
    for (const lesson of lessons) {
      expect(lesson.steps.length, `lesson '${lesson.id}' has no steps`).toBeGreaterThan(0)
    }
  })

  it('lesson ids are unique and kebab-case', () => {
    const ids = lessons.map((lesson) => lesson.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id, `lesson id '${id}' is not kebab-case`).toMatch(KEBAB_CASE)
    }
  })

  it('step ids are unique within their lesson and kebab-case', () => {
    for (const lesson of lessons) {
      const ids = lesson.steps.map((step) => step.id)
      expect(new Set(ids).size, `duplicate step id in lesson '${lesson.id}'`).toBe(ids.length)
      for (const id of ids) {
        expect(id, `step id '${id}' in lesson '${lesson.id}' is not kebab-case`).toMatch(KEBAB_CASE)
      }
    }
  })
})

describe('every step carries its prose', () => {
  it('has a non-empty title and instruction', () => {
    for (const { lesson, step } of allSteps) {
      const where = `${lesson.id}/${step.id}`
      expect(step.title.trim(), `${where}: empty title`).not.toBe('')
      expect(step.instruction.trim(), `${where}: empty instruction`).not.toBe('')
    }
  })

  it('has a hint — a stuck student is a P1 bug (review checklist)', () => {
    for (const { lesson, step } of allSteps) {
      const where = `${lesson.id}/${step.id}`
      expect(step.hint, `${where}: missing hint`).toBeDefined()
      expect(step.hint?.trim(), `${where}: empty hint`).not.toBe('')
    }
  })

  it('instruction and hint formatting parses cleanly (balanced ** and ` marks)', () => {
    for (const { lesson, step } of allSteps) {
      const where = `${lesson.id}/${step.id}`
      expect(markersBalanced(step.instruction), `${where}: unbalanced markers in instruction`).toBe(true)
      if (step.hint !== undefined) {
        expect(markersBalanced(step.hint), `${where}: unbalanced markers in hint`).toBe(true)
      }
    }
  })
})

describe('predicates point at things that exist', () => {
  it('every event predicate names a known builder.* event type', () => {
    for (const { lesson, step } of allSteps) {
      if (step.completion.kind !== 'event') continue
      expect(
        KNOWN_BUILDER_EVENT_TYPES,
        `${lesson.id}/${step.id}: unknown event type '${step.completion.type}'`,
      ).toContain(step.completion.type)
    }
  })

  it('every tile-at predicate sits inside the starter 32×24 ground layer', () => {
    for (const { lesson, step } of allSteps) {
      if (step.completion.kind !== 'tile-at') continue
      const { tx, ty } = step.completion
      const where = `${lesson.id}/${step.id}`
      expect(Number.isInteger(tx) && Number.isInteger(ty), `${where}: non-integer cell address`).toBe(true)
      expect(tx, `${where}: tx out of bounds`).toBeGreaterThanOrEqual(0)
      expect(tx, `${where}: tx out of bounds`).toBeLessThan(GROUND_WIDTH)
      expect(ty, `${where}: ty out of bounds`).toBeGreaterThanOrEqual(0)
      expect(ty, `${where}: ty out of bounds`).toBeLessThan(GROUND_HEIGHT)
    }
  })
})
