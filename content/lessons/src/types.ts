/**
 * The lesson schema, v1 — this file is for curriculum AUTHORS.
 *
 * At the Phase 3 freeze the schema graduated from this package's draft into
 * @engine/tutorial (docs/ARCHITECTURE.md §9, docs/DECISIONS.md D4). This
 * file now re-exports the one frozen copy, so a lesson you write here is
 * checked against exactly the types the tutorial engine executes. The heart
 * of the schema did not move an inch: a lesson is DATA — a plain object you
 * could print on paper — and no step may ever ask about the user interface.
 * A step completes on a frozen `builder.*` event or on a fact about the
 * world, never on "the panel is open". That absence is a parse-time
 * guarantee, and it is what keeps a decade of curriculum alive through
 * every editor redesign.
 *
 * ## What changed from the Phase 2 draft
 *
 * - **`hint` became `hints`, an array with AT LEAST ONE entry.** A stuck
 *   student is a P1 bug, so every step must ship an escape — and now the
 *   escapes escalate: hints[0] is the gentle nudge, hints[1] the sharper
 *   spell-it-out (mention the keyboard path — some students never touch the
 *   mouse). Validation rejects a step with an empty hints array.
 * - **New required `arc` field on the lesson** ('coordinates', 'distance',
 *   'perspectives'): the curriculum's grouping, shown in the rail.
 * - **New optional `fixture`** on the lesson: a fixture-world id the host
 *   loads before the lesson starts (the perspective-reveal showcase runs on
 *   'showcase-island'). Absent = the student's own world, untouched.
 * - **New optional `target`** on a step ({@link StepTarget}): where the
 *   editor points the student's attention — a piece of chrome by ANCHOR id
 *   (registry-governed, D5 — see apps/editor/src/editor/anchors.ts for the
 *   legal ids), a world cell, or a marker entity. Chrome targets get the
 *   DOM spotlight; world targets are highlighted by the lens layer.
 * - **New optional `onEnter`** on a step ({@link StepEffect}): declarative
 *   effects applied when the step begins — switch the view lens, show lens
 *   overlays ({@link LensOverlaySpec}, whose endpoints may be fixed points
 *   or live `{ marker }` references — {@link OverlayPoint}). Effects are
 *   data; the host applies them.
 * - **Two new predicate kinds** ({@link StepPredicate}): `entity-at` (an
 *   entity with a marker stands ON a cell) and `entity-distance` (the
 *   ground-plane distance between two marker entities — the arc-2
 *   Pythagoras predicate, with a small float-dust tolerance).
 * - **New optional `figures`** on a step ({@link StepFigure}): pictures in
 *   the lesson document beside the prose — a plain `image` by URL, or a
 *   `scene` the ENGINE draws (a fixture world through a named projection,
 *   with optional lens overlays whose measured labels are computed, never
 *   hand-typed). Presentation-only by construction: no predicate can
 *   mention a figure, so a figure can never gate completion. Every figure
 *   must carry non-empty `alt` text (validated) — a screen-reader student
 *   gets the same lesson.
 * - **`all`/`any` composition, with one rule:** NO EVENT LEAVES inside a
 *   composition. An event is a moment and a composition is a state of the
 *   world; "all of [a moment, a fact]" cannot be honestly waited on, so the
 *   validator rejects it. Compose world facts; gate on single events.
 * - **`atCell`** on an event predicate ({@link StepPredicate}): legal only on
 *   `builder.tile-painted`, it matches when one of the gesture's painted
 *   cells is exactly (tx, ty) — the pre-satisfaction-proof way to say "paint
 *   it HERE", mirroring `toCell` on `builder.entity-moved`.
 *
 * ## Event granularity, in one breath
 *
 * Events fire once per COMPLETED intention: a drag that paints 40 cells is
 * ONE `builder.tile-painted`; a cancelled drag (Esc) is NOTHING; undo emits
 * its own `builder.command-undone`, never a fake replay of the original.
 * The full conventions live in the frozen vocabulary's header:
 * packages/tutorial/src/events.ts.
 *
 * Before a lesson ships, `validateLessons` from @engine/tutorial must
 * return no problems for it — the content test in this package runs it over
 * every shipped lesson on every PR.
 */

import type { Lesson, LessonStep, StepPredicate } from '@engine/tutorial'

export type {
  Lesson,
  LessonStep,
  StepPredicate,
  StepEffect,
  StepTarget,
  StepFigure,
  LensOverlaySpec,
  OverlayPoint,
} from '@engine/tutorial'

/** @deprecated The draft name from Phase 2 — the schema froze as
 * {@link Lesson} in @engine/tutorial. Kept so mid-phase code keeps
 * compiling; new code says `Lesson`. */
export type LessonDraft = Lesson

/** @deprecated The draft name from Phase 2 — the schema froze as
 * {@link LessonStep} in @engine/tutorial. New code says `LessonStep`. */
export type LessonStepDraft = LessonStep

/** @deprecated The draft name from Phase 2 — the schema froze as
 * {@link StepPredicate} in @engine/tutorial. New code says `StepPredicate`. */
export type StepPredicateDraft = StepPredicate
