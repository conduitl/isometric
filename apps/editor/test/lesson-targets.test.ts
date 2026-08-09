/**
 * Shipped-lesson anchor targets vs the REAL registry.
 *
 * The content package keeps a hand-copied mirror of the legal anchor ids
 * (content/lessons/test/lessons.test.ts) because a leaf package must not
 * import the app — but a mirror can drift, and a lesson whose `target`
 * names an unregistered anchor spotlights NOTHING for the student. This
 * suite closes the loop from the app side, where importing both ends is
 * legal: every anchor target in every shipped lesson must resolve through
 * the live registry (resolveAnchor — live ids and D5 aliases both count).
 * The content-side mirror test stays as belt-and-braces; THIS is the
 * ground truth.
 */

import { describe, expect, it } from 'vitest'
import { lessons } from '@content/lessons'
import { resolveAnchor } from '../src/editor/anchors'

describe('shipped anchor targets resolve through the live registry', () => {
  for (const lesson of lessons) {
    it(`"${lesson.id}" points only at chrome the registry knows`, () => {
      for (const step of lesson.steps) {
        if (step.target?.kind !== 'anchor') continue
        expect(
          resolveAnchor(step.target.anchor),
          `${lesson.id}/${step.id}: anchor target "${step.target.anchor}" does not resolve ` +
            '(not a live id in ANCHOR_IDS and not an alias) — the lesson would spotlight nothing',
        ).not.toBeNull()
      }
    })
  }
})
