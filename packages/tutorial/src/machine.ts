/*
 * The step machine — the one stateful object in the tutorial system.
 *
 * Everything else in this package is data or pure functions; this file is
 * where a lesson actually RUNS. The machine holds exactly one live lesson
 * (the v1 rail shows one), a step index, and a revealed-hint count — and
 * every change to any of them follows the same two-beat discipline:
 * persist through host.progress, then publish a fresh TutorialUiState.
 * Persist-first means a tab crash between the beats costs the student
 * nothing; publish-once-per-settle means the UI never flickers through
 * intermediate steps (three auto-advanced steps arrive as ONE new state).
 *
 * ## Auto-advance: resume re-checks facts, not memories
 *
 * On entering any position — fresh start, resume, event advance, hot
 * reload — the machine walks forward through consecutive steps whose
 * completion is a pure WORLD predicate the current document already
 * satisfies. A returning student whose world already holds the tile is not
 * asked to paint it again; a lesson dropped onto a half-finished world
 * starts where the world says it should. Event-predicate steps NEVER
 * auto-advance: an event is a moment, and a moment must actually happen —
 * no snapshot can prove the student pressed save.
 *
 * Steps skipped by auto-advance still get their onEnter effects applied,
 * in order. Effects are declarative replace-semantics (the last
 * set-view-projection wins; each show-overlays replaces the set), so the
 * landing step's picture is what the student sees — and the host receives
 * one deterministic effect stream whether the steps were walked by hand or
 * skipped in a burst, which is exactly what keeps the replay corpus honest.
 *
 * ## The event channel
 *
 * Every builder event from host.on is offered to the current step: if its
 * completion is an event predicate matching the event, the step completes.
 * Then — match or no match — world predicates are re-checked, because the
 * editor mutates the document BEFORE announcing the gesture: the event
 * that completes step N is often the same one whose world change already
 * satisfies step N+1 (the event-then-world cascade).
 *
 * ## The reentrancy latch — only student actions advance steps
 *
 * The machine's own host calls EMIT: the editor's setViewProjection emits
 * view-projection-changed while an onEnter effect is being applied, and
 * loadFixture emits world-loaded while start() is loading the stage. All
 * of it is synchronous JS, so those events arrive back at handleEvent in
 * the MIDDLE of the machine's own work — and without a guard, a step whose
 * onEnter emits its own gate event would complete itself, and a fixture
 * load would advance whatever lesson was still listening.
 *
 * One latch fixes all of it: machineBusy is held while start(), reload(),
 * reset(), and handleEvent's own enter-step chains are mid-flight, and
 * handleEvent returns immediately while it is up. Latched events are
 * DISCARDED, never queued: everything here is synchronous, so any event
 * arriving under the latch is by construction machine-caused, not
 * student-caused — and only student actions advance steps. That is the
 * honest semantics: a lesson gate is a thing the STUDENT does, and the
 * machine's own stagecraft must never trip it.
 *
 * ## The clean stage
 *
 * Overlays and the view lens are LESSON decorations, and the machine sweeps
 * them at both ends of a lesson's life:
 *
 * - **start(lessonId) cleans first**: before the lesson's fixture loads and
 *   before any step's onEnter effects, the machine applies show-overlays []
 *   and set-view-projection null — a new lesson begins on a clean stage, and
 *   stale triangles from the previous lesson must not haunt it.
 * - **Reaching DONE cleans last**: any walk that lands on done (an event
 *   advance, auto-advance, a reload whose re-derivation clamps a live step
 *   straight to done) applies the same two — a finished lesson cleans up
 *   after itself instead of leaving its last picture painted over the
 *   student's world forever. (Reloading a lesson that was ALREADY done
 *   sweeps nothing again: its done-time sweep already ran.)
 * - **Going idle cleans too**: start() with an unknown lesson id and
 *   reload() finding the running lesson vanished both sweep before
 *   publishing null — the rail shows nothing, and so does the stage.
 *   dispose() is the one deliberate exception (see "The edges" below).
 *
 * All of these are ordinary declarative effects through host.applyEffect, so
 * replace semantics keep them safe: whatever the entered step's own effects
 * declare afterwards is what the student sees.
 *
 * ## The edges, pinned
 *
 * - DONE (stepIndex === steps.length) publishes done: true with an empty
 *   instruction and KEEPS progress stored — a finished lesson reloaded
 *   tomorrow is still finished, not restarted. Progress is only cleared
 *   when a start() finds stored progress for a DIFFERENT lesson.
 * - Progress carries the current step's ID alongside its index (absent
 *   when done), and start()'s resume resolves by stored id FIRST, falling
 *   back to the clamped index for legacy bytes or a vanished id — a
 *   catalogue update that inserts a step must not strand a returning
 *   student one step off (types.ts pins this).
 * - reset() re-enters the CURRENT step: re-applies onEnter, zeroes the
 *   revealed hints. It never rewinds and never touches the document —
 *   reset is an escape hatch, not an undo (types.ts pins this).
 * - reload() is the curriculum author's hot-loop: swap lesson data, keep
 *   the student's place by step ID when the step still exists (its index
 *   may have shifted), else clamp by index; re-enter (the step's effects
 *   may be the very thing the author just edited), re-run auto-advance.
 *   Event progress within the current step is forgotten — draft semantics
 *   carried over from Phase 2. A lesson that vanished sweeps the stage and
 *   publishes null.
 * - An unknown lessonId at start() also sweeps, publishes null, and idles:
 *   the rail shows nothing rather than something wrong.
 * - dispose() unsubscribes and publishes null but deliberately LEAVES the
 *   stage: dispose is teardown, not navigation — the host around it is
 *   going away, and firing effects into a dying editor helps no one.
 */

import type { BuilderEvent } from './events'
import { evaluateWorldPredicate, isWorldPredicate, matchEventPredicate } from './predicates'
import type { Lesson, LessonStep, StepEffect, TutorialEngine, TutorialHost, TutorialUiState } from './types'

/** The clean-stage effects (see the file header): clear the overlay set,
 * return the view lens to the world's primary. Applied when a lesson
 * begins and when one reaches done — in this order, so a host that treats
 * them independently sweeps the decorations before it re-aims the camera. */
const CLEAN_STAGE: ReadonlyArray<StepEffect> = [
  { kind: 'show-overlays', overlays: [] },
  { kind: 'set-view-projection', projection: null },
]

/** The machine's whole mutable state: which lesson, where in it, and how
 * much help has been revealed. Everything else is derivable. */
interface ActiveLesson {
  lesson: Lesson
  stepIndex: number
  revealedHints: number
}

/** Clamp a possibly-garbage number (stored progress crosses a serialization
 * boundary) into [min, max], truncating fractions; non-finite → min. */
function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  const truncated = Math.trunc(value)
  return truncated < min ? min : truncated > max ? max : truncated
}

/**
 * Create the tutorial engine over a host seam and a lesson catalogue. The
 * engine subscribes to builder events immediately and holds the
 * subscription until dispose(); until start() names a lesson, events fall
 * through untouched. One lesson runs at a time — start() replaces.
 *
 * See the file header for the full semantics (auto-advance, done-keeps-
 * progress, reset, reload); types.ts pins the contract this implements.
 */
export function createTutorialEngine(host: TutorialHost, lessons: ReadonlyArray<Lesson>): TutorialEngine {
  let catalogue = lessons
  let active: ActiveLesson | null = null
  let disposed = false
  /** The reentrancy latch (file header: "only student actions advance
   * steps"): true while the machine's own work is mid-flight, so events its
   * host calls emit synchronously — setViewProjection announcing a lens
   * change, loadFixture announcing a world load — are discarded by
   * handleEvent instead of advancing steps mid-operation. */
  let machineBusy = false

  /** Run `work` with the latch held. Saves and restores rather than
   * clearing, so a host callback that somehow re-enters the machine cannot
   * drop the outer latch early. */
  function withLatch(work: () => void): void {
    const wasBusy = machineBusy
    machineBusy = true
    try {
      work()
    } finally {
      machineBusy = wasBusy
    }
  }

  /** Apply a step's onEnter effects through the host, in authored order. */
  function enterStep(step: LessonStep): void {
    for (const effect of step.onEnter ?? []) host.applyEffect(effect)
  }

  /** Sweep the stage (file header: "The clean stage"). */
  function cleanStage(): void {
    for (const effect of CLEAN_STAGE) host.applyEffect(effect)
  }

  /**
   * Walk forward through consecutive steps whose completion is a pure
   * world predicate the document already satisfies, entering each step
   * passed through. Stops at the first event-predicate step (moments must
   * happen), the first unsatisfied fact, or done.
   */
  function autoAdvance(state: ActiveLesson): void {
    const steps = state.lesson.steps
    while (state.stepIndex < steps.length) {
      const step = steps[state.stepIndex]
      if (step === undefined) break
      if (!isWorldPredicate(step.completion)) break
      if (!evaluateWorldPredicate(host.doc(), step.completion)) break
      state.stepIndex += 1
      state.revealedHints = 0
      const next = steps[state.stepIndex]
      if (next !== undefined) enterStep(next)
    }
    // A walk that LANDS on done cleans its stage — a finished lesson must
    // not leave its overlays or borrowed view lens painted over the world.
    // Every arrival at done passes through here exactly once (handleEvent
    // returns early when already done; start/reload call this only from a
    // live step — reload's clamp-straight-to-done path sweeps in its own
    // branch), so the sweep cannot double-fire.
    if (state.stepIndex === steps.length) cleanStage()
  }

  /** Derive the published UI state from the machine state. Done shows an
   * empty instruction and a null stepId — the rail renders the finish. */
  function snapshot(state: ActiveLesson): TutorialUiState {
    const { lesson, stepIndex, revealedHints } = state
    const step = lesson.steps[stepIndex]
    if (step === undefined) {
      return {
        lessonId: lesson.id,
        arc: lesson.arc,
        title: lesson.title,
        stepId: null,
        stepIndex,
        stepCount: lesson.steps.length,
        stepTitle: '',
        instruction: '',
        hints: [],
        hintsRemaining: 0,
        target: null,
        done: true,
      }
    }
    return {
      lessonId: lesson.id,
      arc: lesson.arc,
      title: lesson.title,
      stepId: step.id,
      stepIndex,
      stepCount: lesson.steps.length,
      stepTitle: step.title,
      instruction: step.instruction,
      hints: step.hints.slice(0, revealedHints),
      hintsRemaining: step.hints.length - revealedHints,
      // The step's attention target rides along so the rail's "show me"
      // spotlight needs no second lookup channel; a step without one — and
      // the done state — honestly publish null (types.ts pins this).
      target: step.target ?? null,
      done: false,
    }
  }

  /** The two-beat discipline: persist, then publish. Called after EVERY
   * position or hint change — and only after a change. */
  function commit(state: ActiveLesson): void {
    const step = state.lesson.steps[state.stepIndex]
    host.progress.write({
      lessonId: state.lesson.id,
      stepIndex: state.stepIndex,
      // The step's ID rides along (absent when done — steps.length still
      // means finished): resume resolves by id first, so a catalogue edit
      // that shifts indices cannot strand a returning student on the wrong
      // step (types.ts pins this).
      ...(step === undefined ? {} : { stepId: step.id }),
      revealedHints: state.revealedHints,
    })
    host.publish(snapshot(state))
  }

  function handleEvent(event: BuilderEvent): void {
    // The latch (file header): an event arriving while the machine's own
    // work is mid-flight is machine-caused — the editor announcing a lens
    // switch the machine itself requested, a fixture load the machine
    // itself triggered — and only student actions advance steps. Discarded,
    // not queued: there is no student intention here to keep.
    if (machineBusy) return
    const state = active
    if (state === null) return
    const steps = state.lesson.steps
    const step = steps[state.stepIndex]
    if (step === undefined) return // done — a finished lesson ignores the world going by
    const before = state.stepIndex
    withLatch(() => {
      if (step.completion.kind === 'event' && matchEventPredicate(event, step.completion)) {
        state.stepIndex += 1
        state.revealedHints = 0
        const next = steps[state.stepIndex]
        if (next !== undefined) enterStep(next)
      }
      // Either way: the editor mutated the document before announcing, so
      // world facts may have just become true (the event-then-world cascade).
      autoAdvance(state)
      if (state.stepIndex !== before) commit(state)
    })
  }

  const unsubscribe = host.on(handleEvent)

  return {
    start(lessonId: string): void {
      if (disposed) return
      const lesson = catalogue.find((candidate) => candidate.id === lessonId)
      if (lesson === undefined) {
        // The rail shows nothing rather than something wrong — and neither
        // does the stage: the previous lesson's decorations are swept
        // before idling (going idle cleans too; file header).
        active = null
        withLatch(() => cleanStage())
        host.publish(null)
        return
      }
      withLatch(() => {
        // Resolve the student's place from the store FIRST — the progress
        // seam is independent of the document, so nothing below can
        // invalidate this read.
        const stored = host.progress.read()
        const state: ActiveLesson = { lesson, stepIndex: 0, revealedHints: 0 }
        if (stored !== null && stored.lessonId === lesson.id) {
          // Resume by stored step ID first (a catalogue update that
          // inserted or removed a step must not strand the student on the
          // wrong step), falling back to the clamped index for legacy
          // bytes or a vanished id. steps.length still means done — a
          // finished lesson stays finished across reloads.
          const byId =
            stored.stepId === undefined
              ? -1
              : lesson.steps.findIndex((candidate) => candidate.id === stored.stepId)
          state.stepIndex = byId >= 0 ? byId : clampInt(stored.stepIndex, 0, lesson.steps.length)
          const step = lesson.steps[state.stepIndex]
          if (step !== undefined) {
            state.revealedHints = clampInt(stored.revealedHints, 0, step.hints.length)
          }
        } else {
          host.progress.clear()
        }
        // Swap the active lesson BEFORE any host call — defense in depth
        // behind the latch: were an event ever to slip through while the
        // stage is being prepared, it would reach the NEW lesson, never
        // auto-advance the outgoing one on fixture scenery.
        active = state

        // A new lesson begins on a CLEAN stage: whatever overlays or view
        // lens the previous lesson left behind are swept BEFORE the fixture
        // loads and before the first entered step paints its own picture —
        // stale triangles from lesson two must not haunt lesson three. (A
        // resume straight into done enters no step, so this sweep is also
        // what that path leaves behind.)
        cleanStage()
        // Fixture next, so resume's world re-checks see the lesson's stage.
        // false = the host does not know the id: proceed on the current
        // world (nothing worse than a missing backdrop). The world-loaded
        // event the fixture load emits lands under the latch: discarded.
        if (lesson.fixture !== undefined) host.loadFixture(lesson.fixture)

        const entered = lesson.steps[state.stepIndex]
        if (entered !== undefined) {
          enterStep(entered)
          autoAdvance(state)
        }
        commit(state)
      })
    },

    requestHint(): void {
      if (disposed) return
      const state = active
      if (state === null) return
      const step = state.lesson.steps[state.stepIndex]
      if (step === undefined) return // done — nothing left to hint at
      if (state.revealedHints >= step.hints.length) return // all revealed already
      state.revealedHints += 1
      commit(state)
    },

    reset(): void {
      if (disposed) return
      const state = active
      if (state === null) return
      const step = state.lesson.steps[state.stepIndex]
      if (step === undefined) return // done — nothing to re-enter
      withLatch(() => {
        state.revealedHints = 0
        enterStep(step)
        commit(state)
      })
    },

    reload(next: ReadonlyArray<Lesson>): void {
      if (disposed) return
      catalogue = next
      const state = active
      if (state === null) return // idle stays idle — new data, nothing running
      const lesson = catalogue.find((candidate) => candidate.id === state.lesson.id)
      if (lesson === undefined) {
        // The running lesson vanished from the catalogue: sweep its
        // decorations before idling (going idle cleans too; file header) —
        // publishing null must not leave its triangles painted forever.
        active = null
        withLatch(() => cleanStage())
        host.publish(null)
        return
      }

      withLatch(() => {
        // Re-derive the student's place against the NEW data: the step they
        // were on may have moved (keep it by id), vanished (clamp by index),
        // or the lesson may have grown past a previous finish (the clamp
        // lands on the first new step — hot-reload favors the author).
        const oldStep = state.lesson.steps[state.stepIndex]
        let stepIndex = clampInt(state.stepIndex, 0, lesson.steps.length)
        let revealedHints = 0
        if (oldStep !== undefined) {
          const byId = lesson.steps.findIndex((candidate) => candidate.id === oldStep.id)
          if (byId >= 0) {
            stepIndex = byId
            const survivor = lesson.steps[byId]
            // The step survived the edit — the student's revealed hints do too
            // (clamped: the edit may have removed some).
            revealedHints = clampInt(state.revealedHints, 0, survivor === undefined ? 0 : survivor.hints.length)
          }
        }
        const nextState: ActiveLesson = { lesson, stepIndex, revealedHints }
        active = nextState

        const entered = lesson.steps[nextState.stepIndex]
        if (entered !== undefined) {
          // Re-apply onEnter: the step's declarative setup may be the very
          // thing the author just edited.
          enterStep(entered)
          autoAdvance(nextState)
        } else if (oldStep !== undefined) {
          // The re-derivation clamped a LIVE pre-reload step straight to
          // done (the author shrank the lesson out from under the student):
          // this walk lands on done without passing through autoAdvance, so
          // the done-time sweep the header pins happens here. Reloading a
          // lesson that was ALREADY done takes the oldStep === undefined
          // path instead — its sweep already ran when it finished, and a
          // second one would repaint a stage the student may have since
          // arranged themselves.
          cleanStage()
        }
        commit(nextState)
      })
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      unsubscribe()
      active = null
      // Deliberately NO clean-stage sweep: dispose is TEARDOWN, not
      // navigation — the editor around this engine is going away, and
      // firing effects into a dying host helps no one. Every navigation
      // path that abandons a lesson (start's unknown id, reload's vanished
      // lesson, reaching done) sweeps; teardown leaves the stage as-is.
      host.publish(null)
    },
  }
}
