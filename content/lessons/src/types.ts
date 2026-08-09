/**
 * The lesson-step schema — DRAFT. This file is for curriculum AUTHORS.
 *
 * If you write lessons, this is your whole vocabulary. A lesson is DATA: a
 * plain object you could print on paper, with no code hiding anywhere in it.
 * That is a rule, not a habit — no field of a lesson may ever hold a
 * function, and no step may ever ask about the state of the user interface
 * (docs/ARCHITECTURE.md §9). Here is why, because the why is what keeps a
 * decade of curriculum alive:
 *
 * The editor's buttons and panels WILL move. Toolbars get redesigned,
 * palettes get merged, keyboard shortcuts change. If a step could say
 * "the student clicked the brush button", every one of those redesigns
 * would silently break shipped lessons — a curriculum with a ten-year
 * lifespan chained to this month's layout. So there is deliberately no
 * "clicked the button" predicate and no "panel is open" predicate. A step
 * can only ask two kinds of question:
 *
 * 1. **What did the student DO, in world terms?** — a semantic event like
 *    `builder.tile-painted` ("a brush gesture changed some cells") or
 *    `builder.world-saved`. These names are the editor's promise to
 *    lessons: they describe the world-changing intention, never the
 *    gesture mechanics, and after the Phase 3 freeze they never change
 *    meaning (old names live forever in an alias table).
 * 2. **What is TRUE in the world now?** — "cell (5, 4) holds water",
 *    "a crate entity exists". These read the saved-world truth directly,
 *    so they stay correct through any amount of undo, redo, or replay.
 *
 * ## Event granularity, in one breath
 *
 * Events fire once per COMPLETED intention: a drag that paints 40 cells is
 * ONE `builder.tile-painted`; a cancelled drag (Esc) is NOTHING; undo emits
 * its own `builder.command-undone`, never a fake replay of the original.
 * A step gated on an event can therefore never half-fire or fire at
 * pointer speed. The full conventions live in the vocabulary file's header:
 * apps/editor/src/editor/events/builder.ts.
 *
 * ## Draft status
 *
 * The real tutorial engine arrives in Phase 3, where this schema formalizes
 * into @engine/tutorial and the event vocabulary freezes. Until then the
 * shape below is a working draft — good enough to author real steps today,
 * consumer-tested by the editor's lesson rail, and expected to grow (step
 * targets/highlights, onEnter effects, richer predicates). What will NOT
 * change is the rule above: world facts and semantic events only.
 */

/**
 * One lesson: an id, a human title, and the steps in teaching order.
 * Ids are kebab-case ('first-tiles') and permanent — progress tracking and
 * the lesson-replay corpus will key on them, so pick a name you can keep.
 */
export interface LessonDraft {
  readonly id: string
  readonly title: string
  readonly steps: readonly LessonStepDraft[]
}

/**
 * One step: what the rail shows, and how the editor knows it is complete.
 *
 * `instruction` is mini-markdown — plain prose with `**bold**` and
 * `` `code` `` spans only, blank line for a new paragraph (the rail's tiny
 * in-house formatter supports exactly that, nothing more). `hint` is the
 * gentler second try; the review checklist requires one on every shipped
 * step, because a stuck student is a P1 bug.
 */
export interface LessonStepDraft {
  readonly id: string
  readonly title: string
  readonly instruction: string
  readonly hint?: string
  readonly completion: StepPredicateDraft
}

/**
 * The three questions a step may ask. Note what is missing on purpose:
 * nothing here can mention a button, a panel, a pointer, or a pixel.
 *
 * - `event` — completes the moment the editor emits a builder.* event with
 *   this `type` ("the student painted", "the student saved"). Use it when
 *   the DOING matters more than the result: any paint, any save.
 * - `tile-at` — completes when cell (tx, ty) holds the given tile value.
 *   `tile` omitted means "any tile, just not empty"; `tile: 0` means "this
 *   cell is empty" (an erasing exercise). `layerId` omitted means "on any
 *   layer". Use it when the RESULT matters: the student can paint, erase,
 *   undo, and try again — the step completes when the world is right.
 * - `entity-exists` — completes when some entity with this marker kind
 *   ('crate', 'tree', …) exists in the world. Same spirit: however they
 *   got there, a crate in the world is a crate in the world.
 */
export type StepPredicateDraft =
  | { readonly kind: 'event'; readonly type: string }
  | {
      readonly kind: 'tile-at'
      readonly tx: number
      readonly ty: number
      readonly tile?: number
      readonly layerId?: string
    }
  | { readonly kind: 'entity-exists'; readonly marker: string }
