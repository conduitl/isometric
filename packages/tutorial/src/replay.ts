/*
 * The lesson-replay harness — how "shipped lessons keep working forever"
 * stops being a promise and becomes a CI job.
 *
 * A replay is a synthetic student: a script of the same two things a real
 * one produces. MUTATIONS model what the editor DOES to the document
 * (paint the cell, spawn the crate); EVENTS are what it ANNOUNCES
 * afterwards (builder.tile-painted, builder.entity-placed). The corpus
 * pairs each event with its world change because that is how the editor
 * actually behaves — mutate first, announce second — and the step
 * machine's event-then-world cascade depends on exactly that ordering.
 *
 * The harness drives a REAL createTutorialEngine, not a predicate
 * simulator: auto-advance, effect application, progress writes, and the
 * cascade all run exactly as they will in the shipped editor, so a corpus
 * pass certifies the machine's semantics along with the lesson's data.
 * Only the seams are swapped: an in-memory ProgressStore (every replay is
 * a fresh student — no resume bleeding between corpus entries) and a
 * capture-only publish.
 *
 * The result is deliberately blunt: did the lesson complete, how many
 * steps did the script get through, and — the number one asks for at 2am
 * — WHICH step is it stuck on. "The corpus proves every step completable"
 * is a Phase 3 exit criterion, and a stuck student is a P1 bug; stuckAt
 * is the bug report's first line.
 */

import type { World } from '@engine/core'
import type { BuilderEvent } from './events'
import { createTutorialEngine } from './machine'
import type { Lesson, StepEffect, TutorialHost, TutorialProgress, TutorialUiState } from './types'

/** The slice of a host a replay needs: the document, effect application
 * (usually a recorder), and fixture loading. Everything else — events,
 * progress, publication — is the harness's own in-memory machinery. */
export interface ReplayHost {
  doc(): World
  applyEffect(effect: StepEffect): void
  loadFixture(fixtureId: string): boolean
}

/**
 * One beat of the synthetic student. `mutate` receives the live document
 * and edits it in place (what the editor's command did); `event` is fed to
 * the engine's listener (what the editor announced). Corpus convention:
 * mutate first, then the event that announces it — the editor's own order.
 */
export type ReplayAction =
  | { readonly kind: 'event'; readonly event: BuilderEvent }
  | { readonly kind: 'mutate'; readonly mutate: (doc: World) => void }

/** How far the script got. `stepsCompleted` counts fully completed steps
 * (equals steps.length exactly when `completed`); `stuckAt` names the step
 * the lesson is waiting on, or null when it finished. */
export interface ReplayResult {
  readonly completed: boolean
  readonly stepsCompleted: number
  readonly stuckAt: string | null
}

/**
 * Run one lesson against one script and report honestly. PUBLIC API: the
 * content package's corpus test calls this for every shipped lesson, and
 * CI fails when any lesson stops completing — which is precisely the
 * moment an editor refactor broke a shipped promise.
 *
 * The replay starts from whatever `host.doc()` holds (corpus entries pair
 * each lesson with its fixture world); lessons that declare a fixture get
 * the host's loadFixture called exactly as in the editor. Progress is a
 * fresh in-memory store per call — replays never resume.
 */
export function replayLesson(opts: {
  lesson: Lesson
  host: ReplayHost
  script: ReadonlyArray<ReplayAction>
}): ReplayResult {
  const { lesson, script } = opts

  // The adapter host: real seams delegated, stateful seams in-memory.
  const listeners = new Set<(event: BuilderEvent) => void>()
  let stored: TutorialProgress | null = null
  const states: TutorialUiState[] = []
  const host: TutorialHost = {
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    doc: () => opts.host.doc(),
    applyEffect: (effect) => opts.host.applyEffect(effect),
    loadFixture: (fixtureId) => opts.host.loadFixture(fixtureId),
    progress: {
      read: () => stored,
      write(progress) {
        stored = progress
      },
      clear() {
        stored = null
      },
    },
    // Capture every real state; the dispose-time null is not "how far the
    // lesson got", so it is ignored.
    publish(state) {
      if (state !== null) states.push(state)
    },
  }

  const engine = createTutorialEngine(host, [lesson])
  engine.start(lesson.id)

  for (const action of script) {
    if (action.kind === 'mutate') {
      action.mutate(opts.host.doc())
    } else {
      for (const listener of [...listeners]) listener(action.event)
    }
  }

  const final = states.at(-1)
  const result: ReplayResult =
    final === undefined
      ? // The engine always publishes on start; a missing state means the
        // lesson never even began — report zero progress, stuck at the top.
        { completed: false, stepsCompleted: 0, stuckAt: lesson.steps[0]?.id ?? null }
      : {
          completed: final.done,
          stepsCompleted: final.done ? lesson.steps.length : final.stepIndex,
          stuckAt: final.done ? null : final.stepId,
        }

  engine.dispose()
  return result
}
