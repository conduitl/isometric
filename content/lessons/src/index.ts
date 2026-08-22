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

import { lesson00 } from './lesson-00-paint-by-numbers'
import { lesson01 } from './lesson-01-first-tiles'
import { lessonThirdNumber } from './lesson-01-the-third-number'
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

export { lesson00 } from './lesson-00-paint-by-numbers'
export { lesson01 } from './lesson-01-first-tiles'
export { lessonThirdNumber } from './lesson-01-the-third-number'
export { lesson02 } from './lesson-02-the-distance-picture'
export { lesson03 } from './lesson-03-three-views'

/**
 * Every shipped lesson, in curriculum order — and THIS ARRAY is the source
 * of truth for that order, not the filenames. Lesson 00 leads: it is the
 * first thing a new student meets, so it teaches addresses and nothing else.
 * 'the-third-number' follows immediately, adding `z` to the same bear before
 * lesson 01 hands the student the whole editor.
 *
 * Two files therefore carry an `01` prefix ('lesson-01-first-tiles.ts' and
 * 'lesson-01-the-third-number.ts'), which is history rather than ambiguity:
 * shipped files keep their names here — ids are permanent (progress records,
 * replay corpus) and filenames stay stable — so a lesson inserted into the
 * middle of the sequence takes the position it wants in this array and
 * exports under its own name. Hence `lessonThirdNumber` beside the numeric
 * aliases: `lesson01` was already spoken for, and renaming a shipped symbol
 * to free it would buy tidiness with churn.
 */
export const lessons: readonly Lesson[] = [lesson00, lessonThirdNumber, lesson01, lesson02, lesson03]
