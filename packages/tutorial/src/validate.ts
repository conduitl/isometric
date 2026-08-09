/*
 * Lesson validation — the exit criteria, in data form.
 *
 * The type system already enforces the biggest rule (there IS no UI-state
 * predicate type to write); this file catches everything types cannot:
 * empty strings, event types outside the frozen vocabulary, impossible
 * numbers, hint-less steps, and event leaves smuggled into compositions.
 * It runs as a content test in CI over @content/lessons — a lesson that
 * does not come back clean does not ship.
 *
 * Problems are AUTHOR-facing, never student-facing: precise, quoted, and
 * attributed (lessonId + stepId), because the reader is a curriculum
 * author staring at their own JSON. An empty array means valid.
 *
 * Two rules deserve their reasons stated:
 *
 * - **hints.length >= 1 on every step.** Hint + reset escapes on every
 *   step is a Phase 3 exit criterion; a stuck student is a P1 bug, and a
 *   step with no hint has no escape.
 * - **No event leaves inside all/any.** The machine routes event
 *   predicates through the live event channel and world predicates
 *   through doc inspection; a composition mixing both fits neither
 *   channel and would simply never complete (see predicates.ts). The
 *   validator turns that silent black hole into a loud problem.
 *
 * Fixture ids and anchor ids are strings the HOST resolves (loadFixture
 * returns false for strangers; anchors go through D5's registry, governed
 * elsewhere) — so only non-emptiness is checked here.
 */

import { BUILDER_EVENT_PAYLOAD_FIELDS, resolveBuilderEventType } from './events'
import type { Lesson, LensOverlaySpec, LessonProblem, LessonStep, OverlayPoint, StepEffect, StepPredicate, StepTarget } from './types'

/** kebab-case: lowercase alphanumeric words joined by single hyphens.
 * Lesson and step ids must match — they end up in URLs, progress records,
 * and replay-corpus filenames, where "MyLesson" and "my_lesson" breed. */
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** The three view lenses a set-view-projection effect may name (mirrors
 * ViewProjectionName; membership is checked because lesson data is JSON). */
const VIEW_PROJECTIONS: ReadonlySet<string> = new Set(['profile', 'topdown', 'iso'])

function isBlank(value: string): boolean {
  return value.trim().length === 0
}

/** A `where` value must be a scalar the strict-equality matcher can hit:
 * string, boolean, or finite number. */
function isMatchableScalar(value: unknown): boolean {
  const type = typeof value
  if (type === 'string' || type === 'boolean') return true
  return type === 'number' && Number.isFinite(value)
}

/** Overlay endpoints: a marker reference must be non-empty (the lens layer
 * resolves it against the live doc); a fixed point must be finite. */
function validatePoint(point: OverlayPoint, path: string, flag: (problem: string) => void): void {
  if ('marker' in point) {
    if (typeof point.marker !== 'string' || isBlank(point.marker)) {
      flag(`${path}: marker endpoint must be a non-empty string`)
    }
    return
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    flag(`${path}: point coordinates must be finite numbers`)
  }
  if (point.z !== undefined && !Number.isFinite(point.z)) {
    flag(`${path}: point z must be a finite number`)
  }
}

function validateOverlay(overlay: LensOverlaySpec, path: string, flag: (problem: string) => void): void {
  switch (overlay.kind) {
    case 'cell-highlight':
      if (!Number.isInteger(overlay.tx) || !Number.isInteger(overlay.ty)) {
        flag(`${path}: tx/ty must be integers (cells are whole-numbered)`)
      }
      return
    case 'entity-highlight':
      if (isBlank(overlay.marker)) flag(`${path}: marker must be a non-empty string`)
      return
    case 'arrow':
      validatePoint(overlay.from, `${path}.from`, flag)
      validatePoint(overlay.to, `${path}.to`, flag)
      return
    case 'right-triangle':
      validatePoint(overlay.a, `${path}.a`, flag)
      validatePoint(overlay.b, `${path}.b`, flag)
      return
    default: {
      const unhandled: never = overlay
      void unhandled
      flag(`${path}: unknown overlay kind "${String((overlay as { kind?: unknown }).kind)}"`)
    }
  }
}

function validateEffect(effect: StepEffect, path: string, flag: (problem: string) => void): void {
  switch (effect.kind) {
    case 'set-view-projection':
      if (effect.projection !== null && !VIEW_PROJECTIONS.has(effect.projection)) {
        flag(`${path}: unknown projection "${String(effect.projection)}" (expected profile | topdown | iso | null)`)
      }
      return
    case 'show-overlays':
      effect.overlays.forEach((overlay, index) => validateOverlay(overlay, `${path}.overlays[${index}]`, flag))
      return
    default: {
      const unhandled: never = effect
      void unhandled
      flag(`${path}: unknown effect kind "${String((effect as { kind?: unknown }).kind)}"`)
    }
  }
}

function validateTarget(target: StepTarget, flag: (problem: string) => void): void {
  switch (target.kind) {
    case 'anchor':
      // Anchor ids live in D5's registry, governed like the event
      // vocabulary — the registry check is CI's job; non-emptiness is ours.
      if (isBlank(target.anchor)) flag('target: anchor id is empty')
      return
    case 'cell':
      if (!Number.isInteger(target.tx) || !Number.isInteger(target.ty)) {
        flag('target: tx/ty must be integers (cells are whole-numbered)')
      }
      return
    case 'entity':
      if (isBlank(target.marker)) flag('target: marker must be a non-empty string')
      return
    default: {
      const unhandled: never = target
      void unhandled
      flag(`target: unknown target kind "${String((target as { kind?: unknown }).kind)}"`)
    }
  }
}

/**
 * Validate one completion predicate, recursively. `inComposition` is true
 * below any all/any — where event leaves are forbidden (the machine cannot
 * satisfy a tree that needs both a moment and a snapshot; see
 * predicates.ts).
 */
function validatePredicate(
  predicate: StepPredicate,
  path: string,
  inComposition: boolean,
  flag: (problem: string) => void,
): void {
  switch (predicate.kind) {
    case 'event': {
      if (inComposition) {
        flag(`${path}: event predicates may not appear inside all/any — a composition must be answerable by inspecting the world alone`)
      }
      const resolved = resolveBuilderEventType(predicate.type)
      if (resolved === null) {
        flag(`${path}: event type "${predicate.type}" is not in the frozen builder.* vocabulary (aliases included)`)
      }
      if (predicate.where !== undefined) {
        for (const [field, value] of Object.entries(predicate.where)) {
          if (!isMatchableScalar(value)) {
            flag(`${path}: where.${field} must be a string, boolean, or finite number`)
          }
          // A field the event never carries can never be strictly equal to
          // anything — the matcher would silently fail forever, so the typo
          // is caught HERE, against the frozen field registry, with the real
          // field list in the author's face. (Skipped when the type itself
          // did not resolve: one unknown, one problem.)
          const fields = resolved === null ? null : BUILDER_EVENT_PAYLOAD_FIELDS[resolved]
          if (fields !== null && !fields.includes(field)) {
            flag(
              `${path}: where.${field} is not a payload field of "${resolved}" (its fields are: ${fields.join(', ')})`,
            )
          }
        }
      }
      if (predicate.toCell !== undefined) {
        // A destination cell only means something on a move — every other
        // event lands nowhere, and the matcher would fail-safe forever.
        if (resolved !== null && resolved !== 'builder.entity-moved') {
          flag(
            `${path}: toCell is only legal on builder.entity-moved — "${resolved}" has no destination to land in`,
          )
        }
        if (!Number.isInteger(predicate.toCell.tx) || !Number.isInteger(predicate.toCell.ty)) {
          flag(`${path}: toCell.tx/ty must be integers (cells are whole-numbered)`)
        }
      }
      return
    }
    case 'tile-at': {
      if (!Number.isInteger(predicate.tx) || !Number.isInteger(predicate.ty)) {
        flag(`${path}: tx/ty must be integers (cells are whole-numbered)`)
      }
      if (predicate.tile !== undefined && (!Number.isInteger(predicate.tile) || predicate.tile < 0)) {
        flag(`${path}: tile must be a non-negative integer (0 = empty)`)
      }
      if (predicate.layerId !== undefined && isBlank(predicate.layerId)) {
        flag(`${path}: layerId is empty`)
      }
      return
    }
    case 'entity-exists': {
      if (isBlank(predicate.marker)) flag(`${path}: marker must be a non-empty string`)
      if (predicate.atLeast !== undefined && (!Number.isInteger(predicate.atLeast) || predicate.atLeast < 1)) {
        flag(`${path}: atLeast must be an integer >= 1`)
      }
      return
    }
    case 'entity-at': {
      if (isBlank(predicate.marker)) flag(`${path}: marker must be a non-empty string`)
      if (!Number.isInteger(predicate.tx) || !Number.isInteger(predicate.ty)) {
        flag(`${path}: tx/ty must be integers (cells are whole-numbered)`)
      }
      return
    }
    case 'entity-distance': {
      if (isBlank(predicate.markerA)) flag(`${path}: markerA must be a non-empty string`)
      if (isBlank(predicate.markerB)) flag(`${path}: markerB must be a non-empty string`)
      if (!isBlank(predicate.markerA) && predicate.markerA === predicate.markerB) {
        // Both endpoints resolve to the FIRST entity of the marker — the
        // same entity, distance 0, and distance must be > 0: unsatisfiable.
        flag(
          `${path}: markerA and markerB are both "${predicate.markerA}" — both resolve to the same first entity, whose distance from itself is 0, so this step can never complete`,
        )
      }
      if (!Number.isFinite(predicate.distance) || predicate.distance <= 0) {
        flag(`${path}: distance must be a finite number > 0`)
      }
      if (predicate.tolerance !== undefined && (!Number.isFinite(predicate.tolerance) || predicate.tolerance < 0)) {
        flag(`${path}: tolerance must be a finite number >= 0`)
      }
      return
    }
    case 'all':
    case 'any': {
      if (predicate.of.length === 0) {
        flag(
          `${path}: '${predicate.kind}' composition is empty (empty all is vacuously true, empty any can never be true — neither is a real step)`,
        )
      }
      predicate.of.forEach((child, index) => validatePredicate(child, `${path}.of[${index}]`, true, flag))
      return
    }
    default: {
      const unhandled: never = predicate
      void unhandled
      flag(`${path}: unknown predicate kind "${String((predicate as { kind?: unknown }).kind)}"`)
    }
  }
}

function validateStep(step: LessonStep, flag: (problem: string) => void): void {
  if (!KEBAB_CASE.test(step.id)) {
    flag(`step id "${step.id}" is not kebab-case (expected /^[a-z0-9]+(-[a-z0-9]+)*$/)`)
  }
  if (isBlank(step.title)) flag('step title is empty')
  if (isBlank(step.instruction)) flag('step instruction is empty')
  if (step.hints.length === 0) {
    flag('step has no hints — the hint escape on every step is an exit criterion')
  }
  step.hints.forEach((hint, index) => {
    if (isBlank(hint)) flag(`hints[${index}] is empty`)
  })
  if (step.target !== undefined) validateTarget(step.target, flag)
  step.onEnter?.forEach((effect, index) => validateEffect(effect, `onEnter[${index}]`, flag))
  validatePredicate(step.completion, 'completion', false, flag)
}

/**
 * Validate a lesson catalogue before it ships. Returns author-facing
 * problems (empty = valid); every problem names its lesson and — when it
 * belongs to one — its step. The rules are the Phase 3 exit criteria in
 * data form: unique kebab-case ids, non-empty prose, at least one hint per
 * step, at least one step per lesson, event types that resolve through the
 * frozen vocabulary (aliases legal), `where` fields that the resolved
 * event's frozen payload actually carries (BUILDER_EVENT_PAYLOAD_FIELDS —
 * a typo'd field would silently never match), `toCell` only on
 * builder.entity-moved with whole-numbered coordinates, entity-distance
 * endpoints that are two DIFFERENT markers (the same marker twice measures
 * an entity against itself: always 0, never satisfiable), finite/sane
 * numbers, non-empty compositions with no event leaves inside them, and
 * non-empty fixture/anchor/marker references.
 */
export function validateLessons(lessons: ReadonlyArray<Lesson>): LessonProblem[] {
  const problems: LessonProblem[] = []
  const seenLessonIds = new Set<string>()

  for (const lesson of lessons) {
    const lessonFlag = (problem: string): void => {
      problems.push({ lessonId: lesson.id, stepId: null, problem })
    }

    if (!KEBAB_CASE.test(lesson.id)) {
      lessonFlag(`lesson id "${lesson.id}" is not kebab-case (expected /^[a-z0-9]+(-[a-z0-9]+)*$/)`)
    }
    if (seenLessonIds.has(lesson.id)) {
      lessonFlag(`duplicate lesson id "${lesson.id}"`)
    }
    seenLessonIds.add(lesson.id)

    if (isBlank(lesson.title)) lessonFlag('lesson title is empty')
    if (isBlank(lesson.arc)) lessonFlag('lesson arc is empty')
    if (lesson.fixture !== undefined && isBlank(lesson.fixture)) {
      lessonFlag('fixture id is empty (the host resolves fixture ids; validation checks only non-emptiness)')
    }
    if (lesson.steps.length === 0) {
      lessonFlag('lesson has no steps — a lesson teaches by doing, so at least one')
    }

    const seenStepIds = new Set<string>()
    for (const step of lesson.steps) {
      const stepFlag = (problem: string): void => {
        problems.push({ lessonId: lesson.id, stepId: step.id, problem })
      }
      if (seenStepIds.has(step.id)) {
        stepFlag(`duplicate step id "${step.id}" within lesson "${lesson.id}"`)
      }
      seenStepIds.add(step.id)
      validateStep(step, stepFlag)
    }
  }

  return problems
}
