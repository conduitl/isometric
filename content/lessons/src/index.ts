/**
 * @content/lessons — lesson arcs as data.
 *
 * Nothing in this package is engine code: it exports plain objects a
 * curriculum writer authors by hand and the editor's lesson rail renders.
 * The schema is the v1 contract frozen in @engine/tutorial, re-exported
 * through types.ts (read its header first — it explains the two kinds of
 * question a step may ask, and why there are only two); README.md in this
 * package is the full authoring guide.
 *
 * `lessons` is the curriculum order — the rail's lesson picker offers them
 * in this sequence. Add new lessons to the array; never reuse a retired
 * id (ids live on in progress records and the replay corpus). Every entry
 * here must pass validateLessons AND ship a completing script in
 * test/replay-corpus.test.ts — both run in CI on every PR.
 */

import { lesson01 } from './lesson-01-first-tiles'
import { lesson02 } from './lesson-02-the-distance-picture'
import { lesson03 } from './lesson-03-three-views'
import type { Lesson } from './types'

// The v1 schema, for lesson authors and the editor alike (frozen in
// @engine/tutorial; types.ts re-exports the one true copy).
export type {
  Lesson,
  LessonStep,
  StepPredicate,
  StepEffect,
  StepTarget,
  LensOverlaySpec,
  OverlayPoint,
} from './types'

// The Phase 2 draft names — deprecated aliases kept so mid-phase code
// keeps compiling; new code uses the names above.
export type { LessonDraft, LessonStepDraft, StepPredicateDraft } from './types'

export { lesson01 } from './lesson-01-first-tiles'
export { lesson02 } from './lesson-02-the-distance-picture'
export { lesson03 } from './lesson-03-three-views'

/** Every shipped lesson, in curriculum order. */
export const lessons: readonly Lesson[] = [lesson01, lesson02, lesson03]
