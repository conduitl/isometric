/**
 * The lesson-authoring harness — Phase 2's stand-in for the Phase 3
 * tutorial engine, built so a curriculum author can ship a step TODAY.
 *
 * ROADMAP Phase 2 asks for exactly one thing here: "a non-engineer ships a
 * lesson step without an engine build". So this harness reads the DRAFT
 * schema from @content/lessons, watches the editor's builder.* events and
 * world document, and mirrors "which step are we on" into the store's
 * {@link LessonUiState} slot. It is deliberately small; the real engine
 * (branching, effects, highlights, progress persistence) is Phase 3's job,
 * and by then this harness will have consumer-tested the schema it inherits.
 *
 * ## Draft semantics, pinned by tests (apps/editor/test/lesson-harness.test.ts)
 *
 * - v1 shows ONE lesson: the first in the array. An empty array publishes
 *   null and the rail hides.
 * - The current step is the first whose predicate is not ALREADY satisfied:
 *   world-state predicates (tile-at, entity-exists) are checked against the
 *   live document, and consecutive satisfied ones are skipped in one go —
 *   reopening a half-built world resumes mid-lesson. Event predicates are
 *   never pre-satisfied: an event is a moment, and the moment has passed.
 * - On every builder event: an event-predicate current step advances when
 *   the type matches (both sides resolved through BUILDER_EVENT_ALIASES, so
 *   post-freeze renames keep old lesson data working); world-state steps
 *   are then re-checked, because ANY event may have changed the world (a
 *   paint may complete a tile-at). One event satisfies at most one
 *   event-predicate step — two "paint anything" steps need two paints.
 * - `done` publishes with stepIndex === stepCount (one PAST the last step,
 *   0-based) and empty instruction — the rail renders its own completion
 *   state and must not show a stale step.
 * - reload() is the hot-reload path: swap lesson data and re-derive the
 *   current step FROM SCRATCH against the live document. An author dragging
 *   a step earlier in the file sees the rail follow instantly. Event-
 *   predicate progress is deliberately forgotten on reload — draft
 *   semantics: world facts persist because the world remembers them;
 *   moments do not, because nothing but the moment could.
 *
 * The harness never mutates the document and nothing in the simulation
 * reads from it — it lives strictly on the UI side of the determinism
 * boundary, like the emitter it subscribes to.
 */

import type { World } from '@engine/core'
import type { LessonDraft, StepPredicateDraft } from '@content/lessons'
import { BUILDER_EVENT_ALIASES, type BuilderEvent } from '../events/builder'
import type { LessonUiState } from '../types'

/**
 * What the harness needs from the session, and nothing more: the event
 * stream, the live document, and somewhere to publish the mirror. The
 * session satisfies this trivially; tests satisfy it with ~15 lines.
 */
export interface LessonHarnessHost {
  on(listener: (event: BuilderEvent) => void): () => void
  doc(): World
  publish(state: LessonUiState | null): void
}

export interface LessonHarness {
  /** Hot-reload: replace the lesson data and re-derive the current step
   * from scratch against the live document (see header). */
  reload(lessons: readonly LessonDraft[]): void
  /** Unsubscribe from events and publish null (the rail hides). Idempotent. */
  dispose(): void
}

/** Resolve an event-type name through the permanent alias table (D4): after
 * the freeze, a superseded name and its replacement compare equal. */
function canonicalType(type: string): string {
  return BUILDER_EVENT_ALIASES[type] ?? type
}

/**
 * Is a WORLD-STATE predicate satisfied right now? Event predicates always
 * answer false here — they complete only by witnessing their moment.
 */
function satisfiedByWorld(predicate: StepPredicateDraft, world: World): boolean {
  switch (predicate.kind) {
    case 'event':
      return false
    case 'tile-at': {
      const { tx, ty, tile, layerId } = predicate
      const layers = layerId === undefined ? world.layers : world.layers.filter((layer) => layer.id === layerId)
      return layers.some((layer) => {
        if (tx < 0 || ty < 0 || tx >= layer.width || ty >= layer.height) return false
        const cell = layer.cells[ty * layer.width + tx] ?? 0
        // tile omitted = "any tile, just not empty"; tile 0 = "erased".
        return tile === undefined ? cell !== 0 : cell === tile
      })
    }
    case 'entity-exists': {
      // Marker entities carry a 'marker' component of shape { kind } —
      // the same fact builder.entity-placed reports (types.ts, PlaceEntityCommand).
      return Object.values(world.entities).some((entity) => {
        const marker = entity.components['marker']
        return (
          typeof marker === 'object' && marker !== null && (marker as { kind?: unknown }).kind === predicate.marker
        )
      })
    }
  }
}

/**
 * Watch the editor and mirror lesson progress into the store. See the file
 * header for the full (draft) semantics; the returned handle is the
 * session's to reload on content changes and dispose on teardown.
 */
export function createLessonHarness(host: LessonHarnessHost, lessons: readonly LessonDraft[]): LessonHarness {
  let lesson: LessonDraft | null = lessons[0] ?? null
  let index = 0
  let disposed = false

  function publish(): void {
    if (lesson === null) {
      host.publish(null)
      return
    }
    const steps = lesson.steps
    const step = steps[index]
    host.publish({
      lessonId: lesson.id,
      title: lesson.title,
      stepIndex: index,
      stepCount: steps.length,
      instruction: step?.instruction ?? '',
      hint: step?.hint ?? null,
      done: index >= steps.length,
    })
  }

  /** Advance past every consecutive already-satisfied world-state step.
   * Returns true if the index moved. */
  function skipSatisfied(world: World): boolean {
    if (lesson === null) return false
    let moved = false
    for (;;) {
      const step = lesson.steps[index]
      if (step === undefined || !satisfiedByWorld(step.completion, world)) return moved
      index += 1
      moved = true
    }
  }

  function handleEvent(event: BuilderEvent): void {
    if (lesson === null) return
    const world = host.doc()
    let eventSpent = false
    let moved = false
    for (;;) {
      const step = lesson.steps[index]
      if (step === undefined) break
      if (step.completion.kind === 'event') {
        if (eventSpent || canonicalType(step.completion.type) !== canonicalType(event.type)) break
        eventSpent = true
      } else if (!satisfiedByWorld(step.completion, world)) {
        break
      }
      index += 1
      moved = true
    }
    if (moved) publish()
  }

  const off = host.on(handleEvent)

  // Boot: resume from whatever the world already proves, then show the rail.
  skipSatisfied(host.doc())
  publish()

  return {
    reload(next: readonly LessonDraft[]): void {
      if (disposed) return
      lesson = next[0] ?? null
      index = 0
      if (lesson !== null) skipSatisfied(host.doc())
      publish()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      off()
      host.publish(null)
    },
  }
}
