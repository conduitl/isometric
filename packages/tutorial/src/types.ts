/**
 * The lesson schema, v1 — LOCKED CONTRACT for Phase 3.
 *
 * A lesson is data, not code (ARCHITECTURE §9): plain JSON-serializable
 * objects a curriculum author writes by hand and this engine executes. The
 * schema's most important feature is an ABSENCE: **there is no UI-state
 * predicate type at all.** A step can complete on a frozen semantic event
 * or on a fact about the world — never on "the panel is open" or "the
 * button was clicked". That absence is a parse-time guarantee, not a review
 * comment, and it is what keeps a decade of shipped curriculum robust to
 * every editor refactor that will ever happen. (Zero "click Next" is a
 * Phase 3 exit criterion; this type system is where it is enforced.)
 *
 * ## The pieces
 *
 * - {@link Lesson} / {@link LessonStep} — the authored data.
 * - {@link StepPredicate} — when is a step done? Events + world state only,
 *   with `all`/`any` composition for the rare step that needs it.
 * - {@link StepEffect} — what happens when a step begins (switch the view
 *   lens, show a lens overlay, clear overlays). Effects are DECLARATIVE and
 *   the host applies them; the engine never touches the editor directly.
 * - {@link TutorialHost} — the seam to the editor: events in, world reads,
 *   effect application, progress storage, UI publication. The engine is
 *   framework-free and app-blind; everything app-shaped crosses this seam.
 * - {@link TutorialProgress} — what survives a reload (an exit criterion:
 *   tutorial state survives reload). Stored via the host, keyed by lesson.
 *
 * ## Resume + reset semantics (pinned here so tests and hosts agree)
 *
 * - On start (and on reload): begin from the stored step if progress
 *   exists, else step 0 — then AUTO-ADVANCE through consecutive steps whose
 *   world-state predicates are already satisfied by the current document
 *   (event-predicate steps never auto-advance; an event must really occur).
 * - `reset()` re-enters the CURRENT step: re-applies its onEnter effects
 *   and clears its revealed-hint count. It never rewinds progress and never
 *   touches the world document — reset is an escape hatch, not an undo.
 * - `requestHint()` reveals the next hint, if any remain. Every step ships
 *   at least one hint (enforced by validation): hint + reset escapes on
 *   every step is a Phase 3 exit criterion.
 */

import type { World } from '@engine/core'
import type { BuilderEvent, BuilderEventType, ViewProjectionName } from './events'

// ---------------------------------------------------------------------------
// Predicates — events + world state ONLY
// ---------------------------------------------------------------------------

/**
 * Shallow field matchers for event predicates: every named field must be
 * strictly equal on the event payload's top level. `{ tile: 2 }` on a
 * tile-painted event means "painted water". Scalars only — matching is
 * deliberately too weak to smuggle UI state or deep structure in.
 */
export type EventFieldMatch = Readonly<Record<string, string | number | boolean>>

export type StepPredicate =
  /** A frozen builder.* event occurred (alias-resolved), optionally with
   * top-level payload fields matching `where`, and — for
   * builder.entity-moved only — optionally landing in a named cell:
   * `toCell` matches when the event's `to` position FLOORS to (tx, ty).
   * A moment-gate that names a destination can never be pre-satisfied by
   * something already standing there — the pre-satisfaction-proof way to
   * say "move it HERE" (a lesson-02 lesson learned). */
  | {
      readonly kind: 'event'
      readonly type: BuilderEventType | string
      readonly where?: EventFieldMatch
      readonly toCell?: { readonly tx: number; readonly ty: number }
    }
  /** The named cell holds a tile (any non-empty if `tile` is omitted). */
  | {
      readonly kind: 'tile-at'
      readonly tx: number
      readonly ty: number
      readonly tile?: number
      readonly layerId?: string
    }
  /** At least `atLeast` (default 1) entities with this marker exist. */
  | { readonly kind: 'entity-exists'; readonly marker: string; readonly atLeast?: number }
  /** An entity with this marker stands ON the named cell (its position
   * floors to (tx, ty)). */
  | { readonly kind: 'entity-at'; readonly marker: string; readonly tx: number; readonly ty: number }
  /** The ground-plane Euclidean distance between the first entity of each
   * marker equals `distance` within `tolerance` (default 0.05 — snapped
   * placements land exactly, the tolerance forgives float dust, and a
   * half-cell miss still honestly fails). The arc-2 Pythagoras predicate. */
  | {
      readonly kind: 'entity-distance'
      readonly markerA: string
      readonly markerB: string
      readonly distance: number
      readonly tolerance?: number
    }
  /** Composition, for the rare step that needs it. */
  | { readonly kind: 'all'; readonly of: ReadonlyArray<StepPredicate> }
  | { readonly kind: 'any'; readonly of: ReadonlyArray<StepPredicate> }

// ---------------------------------------------------------------------------
// Effects — declarative step setup, applied by the host
// ---------------------------------------------------------------------------

/**
 * A lens overlay a step may show. Endpoints are either fixed world points
 * or `{ marker }` references resolved against the LIVE document every
 * frame — the right-triangle between player and crate follows the crate as
 * the student drags it, which IS the lesson.
 */
export type OverlayPoint =
  | { readonly x: number; readonly y: number; readonly z?: number }
  | { readonly marker: string }

export type LensOverlaySpec =
  | { readonly kind: 'cell-highlight'; readonly tx: number; readonly ty: number; readonly label?: string }
  | { readonly kind: 'entity-highlight'; readonly marker: string; readonly label?: string }
  | { readonly kind: 'arrow'; readonly from: OverlayPoint; readonly to: OverlayPoint; readonly label?: string }
  /** The legs-and-hypotenuse distance picture: dx east, dy north, the
   * straight line between. Leg/hypotenuse labels default to the measured
   * numbers (rounded to 2 decimals), so "3, 4, …5" appears by itself. */
  | {
      readonly kind: 'right-triangle'
      readonly a: OverlayPoint
      readonly b: OverlayPoint
      readonly labels?: { readonly dx?: string; readonly dy?: string; readonly hypotenuse?: string }
    }

export type StepEffect =
  /** Switch the VIEW lens (X-ray; null returns to the world's primary
   * projection). View-only — the document's primaryProjection is untouched. */
  | { readonly kind: 'set-view-projection'; readonly projection: ViewProjectionName | null }
  /** Replace the tutorial's overlay set (drawn by @engine/lens above the
   * scene). An empty array clears. */
  | { readonly kind: 'show-overlays'; readonly overlays: ReadonlyArray<LensOverlaySpec> }

// ---------------------------------------------------------------------------
// The authored data
// ---------------------------------------------------------------------------

/** Where a step points the student's attention (spotlights): a piece of
 * editor chrome by ANCHOR id (registry-governed, D5), or a world target
 * highlighted by the lens layer. */
export type StepTarget =
  | { readonly kind: 'anchor'; readonly anchor: string }
  | { readonly kind: 'cell'; readonly tx: number; readonly ty: number }
  | { readonly kind: 'entity'; readonly marker: string }

export interface LessonStep {
  readonly id: string
  readonly title: string
  /** Mini-markdown: paragraphs, **bold**, `code` — nothing else. */
  readonly instruction: string
  /** At least one, always (validated) — the hint escape is an exit criterion. */
  readonly hints: ReadonlyArray<string>
  readonly target?: StepTarget
  readonly onEnter?: ReadonlyArray<StepEffect>
  readonly completion: StepPredicate
}

export interface Lesson {
  readonly id: string
  readonly title: string
  /** Arc grouping ('coordinates', 'distance', 'perspectives'). */
  readonly arc: string
  /** Fixture id the host loads before the lesson ('showcase-island' for the
   * perspective reveal); absent = the student's own world, untouched. */
  readonly fixture?: string
  readonly steps: ReadonlyArray<LessonStep>
}

// ---------------------------------------------------------------------------
// Progress, UI state, and the host seam
// ---------------------------------------------------------------------------

/** What survives a reload. Stored via {@link TutorialHost.progress}. */
export interface TutorialProgress {
  readonly lessonId: string
  /** The step the student is ON (index into steps; steps.length = done). */
  readonly stepIndex: number
  /** The step's id, when on a live step — resume resolves by id FIRST (a
   * catalogue update that inserts or removes a step must not strand a
   * returning student on the wrong step), falling back to the clamped
   * index for legacy bytes or a vanished id. Absent when done. */
  readonly stepId?: string
  readonly revealedHints: number
}

export interface ProgressStore {
  read(): TutorialProgress | null
  write(progress: TutorialProgress): void
  clear(): void
}

/** What the lesson rail renders. Published by the engine after every change. */
export interface TutorialUiState {
  readonly lessonId: string
  readonly arc: string
  readonly title: string
  readonly stepId: string | null
  readonly stepIndex: number
  readonly stepCount: number
  readonly stepTitle: string
  readonly instruction: string
  /** Hints revealed so far (prefix of the step's hints). */
  readonly hints: ReadonlyArray<string>
  readonly hintsRemaining: number
  /** The current step's attention target (anchor chrome or world thing) —
   * the rail's "show me" spotlight reads it. Null when the step has none,
   * and when done. */
  readonly target: StepTarget | null
  readonly done: boolean
}

/**
 * The seam to the app. The engine calls DOWN through this; nothing in the
 * app is imported by this package. `applyEffect` is where declarative step
 * effects become editor actions (view lens, overlays); `loadFixture`
 * resolves a lesson's fixture id to a document swap (and returns false for
 * an unknown id — the lesson then runs on the current world, and the
 * engine surfaces nothing worse than a missing backdrop).
 */
export interface TutorialHost {
  on(listener: (event: BuilderEvent) => void): () => void
  doc(): World
  applyEffect(effect: StepEffect): void
  loadFixture(fixtureId: string): boolean
  readonly progress: ProgressStore
  publish(state: TutorialUiState | null): void
}

/** The running engine. One lesson at a time (v1 rail shows one). */
export interface TutorialEngine {
  /** Switch to a lesson by id (applies fixture + first step's effects;
   * resumes from stored progress when the stored lessonId matches). */
  start(lessonId: string): void
  requestHint(): void
  /** Re-enter the current step: re-apply onEnter, clear revealed hints. */
  reset(): void
  /** Hot-reload path: swap lesson data, re-derive position against the live
   * document (event progress within the current step is forgotten — draft
   * semantics carried over from Phase 2, documented). */
  reload(lessons: ReadonlyArray<Lesson>): void
  dispose(): void
}

/**
 * Validation: every lesson must pass BEFORE it ships (a content test, run
 * in CI over @content/lessons). Returns student-invisible, author-facing
 * problems ('step 3 of "first-tiles" has no hints'); empty = valid. The
 * rules the validator enforces are the exit criteria in data form: ids
 * unique and kebab-case; instruction/title non-empty; hints.length >= 1;
 * every event predicate's type resolves through the frozen vocabulary
 * (aliases allowed); numeric fields finite; composition non-empty.
 */
export type LessonProblem = { readonly lessonId: string; readonly stepId: string | null; readonly problem: string }
