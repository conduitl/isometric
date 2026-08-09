/**
 * @content/lessons — lesson arcs as data.
 *
 * Nothing in this package is engine code: it exports plain objects a
 * curriculum writer authors by hand and the editor's lesson rail renders.
 * The schema lives in types.ts (read its header first — it explains the
 * two kinds of question a step may ask, and why there are only two);
 * README.md in this package is the full authoring guide.
 *
 * `lessons` is the shipping order: the editor's v1 rail shows the first
 * entry. Add new lessons to the array; never reuse a retired id.
 */

import { lesson01 } from './lesson-01-first-tiles'
import type { LessonDraft } from './types'

export type { LessonDraft, LessonStepDraft, StepPredicateDraft } from './types'
export { lesson01 } from './lesson-01-first-tiles'

/** Every shipped lesson, in curriculum order. */
export const lessons: readonly LessonDraft[] = [lesson01]
