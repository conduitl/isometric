/**
 * The lesson pane — the LEFT HALF of the app, because the lesson is the
 * product and the editor its companion (the 2026-08 reframe; this began
 * life as a right-rail panel called LessonRail, and the engine wiring
 * survived both moves intact).
 *
 * Two views share the pane, like a reader with a bookshelf:
 *
 * - **The library**: every shipped lesson as a list — click one to start
 *   it (keyboard: every entry is a plain button on the tab ring). The list
 *   carries the `panel.lessonPicker` anchor: the picker's registry duty
 *   ("where lessons are chosen") survives its change of costume from a
 *   <select> to a list.
 * - **The lesson**: a back control ("All lessons"), the title, and then
 *   EVERY step of the lesson as one continuous, scrollable document —
 *   read ahead as far as you like. Completed steps wear a checkmark; the
 *   current step is marked (and carries the hint / start-over / show-me
 *   escapes, which belong only to the step you are ON); the pane scrolls
 *   the current step into view whenever the machine advances.
 *
 * The pane decides NOTHING about lesson progress — the machine owns which
 * step is current (published as TutorialUiState through the host seam);
 * this pane renders the full step list from the lesson DATA and marks it
 * up with the machine's position. Hints stay engine-driven (requestHint /
 * hintsRemaining / reset), because revealed hints survive reload and that
 * memory lives in the machine, not in the DOM.
 *
 * ## Parking
 *
 * The pane can PARK to a 44px labeled spine (the divider's Home key, a
 * drag below the park threshold, or the global L key — App owns the state;
 * this pane renders it). While parked the document hides but stays
 * MOUNTED, so every panel.lesson* anchor keeps existing in the DOM — the
 * anchor registry's promise. A NEW step (or the lesson finishing)
 * auto-restores the pane: fresh instructions are exactly the moment a
 * free-building student wants the lesson back.
 *
 * ## "Show me" — the step-target spotlight
 *
 * Unchanged in spirit from the rail (anchor targets get the DOM masked
 * spotlight; world targets compose a highlight over the step's declared
 * overlays), with ONE move for the overlay-card editor: before
 * spotlighting an anchor the pane asks App to REVEAL the card that owns it
 * (revealAnchorChrome) and looks the element up a frame later. The pointer
 * still hides on: a second press, a step change, any builder event, and
 * Escape.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, ReactElement, SetStateAction } from 'react'
import { lessons } from '@content/lessons'
import { createDomSpotlight } from '@engine/lens'
import type { DomSpotlight } from '@engine/lens'
import type { LensOverlaySpec, LessonStep, TutorialEngine, TutorialUiState } from '@engine/tutorial'
import { anchor, resolveAnchor } from '../editor/anchors'
import type { AnchorId } from '../editor/anchors'
import { formatInstruction } from '../editor/lesson/format'
import type { EditorTutorialHost } from '../editor/tutorial-host'
import type { EditorSession } from '../editor/types'
import { useSnapshot } from './App'
import { LessonFigure } from './panels/LessonFigure'
import { unparkSplit } from './split-math'
import type { SplitState } from './split-math'

/** Does this lesson id name a shipped lesson that runs on a fixture?
 * (Unknown ids answer false — no fixture means no park choreography.) */
function lessonHasFixture(lessonId: string): boolean {
  return lessons.find((lesson) => lesson.id === lessonId)?.fixture !== undefined
}

/** Mini-markdown paragraphs → real elements: bold → strong, code → code. */
function InstructionText({ text }: { text: string }): ReactElement {
  return (
    <>
      {formatInstruction(text).map((paragraph, p) => (
        <p key={p}>
          {paragraph.spans.map((span, s) =>
            span.kind === 'bold' ? (
              <strong key={s}>{span.text}</strong>
            ) : span.kind === 'code' ? (
              <code key={s}>{span.text}</code>
            ) : (
              <Fragment key={s}>{span.text}</Fragment>
            ),
          )}
        </p>
      ))}
    </>
  )
}

/**
 * The overlays a step DECLARES via its onEnter show-overlays effects — the
 * last one wins, mirroring the machine's replace semantics. Empty when the
 * step (or the lesson, or the stepId) is unknown: composing over nothing is
 * the honest fallback.
 */
function declaredOverlays(lessonId: string, stepId: string | null): ReadonlyArray<LensOverlaySpec> {
  if (stepId === null) return []
  const lesson = lessons.find((candidate) => candidate.id === lessonId)
  const step = lesson?.steps.find((candidate) => candidate.id === stepId)
  let declared: ReadonlyArray<LensOverlaySpec> = []
  for (const effect of step?.onEnter ?? []) {
    if (effect.kind === 'show-overlays') declared = effect.overlays
  }
  return declared
}

/** Where a step stands relative to the machine's position. */
type StepStatus = 'done' | 'current' | 'ahead'

function statusOf(step: LessonStep, index: number, tutorial: TutorialUiState): StepStatus {
  if (tutorial.done) return 'done'
  if (step.id === tutorial.stepId) return 'current'
  return index < tutorial.stepIndex ? 'done' : 'ahead'
}

/** The lesson pane: always mounted (the anchor's promise), a library or a
 * lesson document inside, collapsed to its spine while parked. */
export function LessonPane({
  session,
  engine,
  host,
  split,
  setSplit,
  revealAnchorChrome,
}: {
  session: EditorSession
  engine: TutorialEngine
  host: EditorTutorialHost
  split: SplitState
  setSplit: Dispatch<SetStateAction<SplitState>>
  /** Ask App to open whatever overlay card owns this anchor, so the
   * spotlight has something visible to frame. */
  revealAnchorChrome: (id: AnchorId) => void
}): ReactElement {
  const tutorial = useSnapshot(session, (s) => s.tutorial)

  /** Is the student browsing the library? Navigation state only — the
   * running lesson keeps running underneath; "back" is a bookshelf, not a
   * stop button. */
  const [browsing, setBrowsing] = useState(false)

  /** host.hasParked() is an imperative read, not a subscription — bumping
   * this after our own restore call makes the "Back to my world" button
   * re-evaluate (and disappear) once the park is spent. */
  const [, bumpParkCheck] = useState(0)

  /** Is the "show me" pointer (spotlight or world highlight) live? The ref
   * mirrors the state for the event-subscription path, which must decide
   * without waiting on a re-render. */
  const [showing, setShowing] = useState(false)
  const showingRef = useRef(false)
  /** True while the live pointer is a COMPOSED world highlight (so hide
   * knows whether it owes the session an overlay restore). */
  const composedRef = useRef(false)
  /** The one spotlight, created lazily on first anchor-target use. */
  const spotlightRef = useRef<DomSpotlight | null>(null)

  /** The scrolling document, for keeping the current step in view. */
  const docRef = useRef<HTMLDivElement>(null)
  /** The pane root (focus management queries) and the back control. */
  const paneRef = useRef<HTMLElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  /** Where focus should land after a user-initiated view switch — set by
   * the click handlers, consumed once by the effect below. Never set on
   * boot, so resume never steals focus. */
  const navFocusRef = useRef<'library' | 'lesson' | null>(null)

  /** Put the pointer away, idempotently: spotlight off, and a composed
   * world highlight hands the picture back to whatever step is current AT
   * HIDE TIME (imperative peek at the mirror — an event-handler read, not
   * a render subscription). */
  const hideShowMe = useCallback((): void => {
    if (!showingRef.current) return
    showingRef.current = false
    setShowing(false)
    spotlightRef.current?.hide()
    if (composedRef.current) {
      composedRef.current = false
      const current = session.store.getState().tutorial
      session.setOverlays(
        current === null ? [] : declaredOverlays(current.lessonId, current.stepId),
      )
    }
  }, [session])

  // The pointer dies with the step: a new step is a new question, and last
  // step's arrow answering it would mislead. (stepId also changes on lesson
  // switch and on done — both rightly hide too.)
  const stepId = tutorial?.stepId ?? null
  useEffect(() => {
    hideShowMe()
  }, [stepId, hideShowMe])

  // A parked pane auto-restores when the lesson MOVES: a new step, or the
  // finish. Only real transitions count — the ref starts null, so a boot
  // (or a reload resuming mid-lesson) respects a persisted park instead of
  // yanking the pane open on arrival.
  const beat = tutorial === null ? null : tutorial.done ? '#done' : tutorial.stepId
  const prevBeatRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevBeatRef.current
    prevBeatRef.current = beat
    if (beat !== null && prev !== null && beat !== prev) {
      setSplit((state) => (state.parked ? unparkSplit(state) : state))
    }
  }, [beat, setSplit])

  // Keep the current step in view: whenever the machine moves (and on the
  // first render of a resumed lesson), the document scrolls the live step
  // to its top — done scrolls to the finish block at the bottom. Instant,
  // never smooth: nothing in this editor animates.
  useEffect(() => {
    if (browsing) return
    const container = docRef.current
    if (container === null || beat === null) return
    if (beat === '#done') {
      container.scrollTop = container.scrollHeight
      return
    }
    const step = container.querySelector(`[data-step-id=${JSON.stringify(beat)}]`)
    if (step instanceof HTMLElement) step.scrollIntoView({ block: 'start' })
  }, [beat, browsing])

  // Focus follows a deliberate navigation (never boot): into the library →
  // the first lesson button; into a lesson → the back control. Without
  // this, the button just pressed unmounts and focus falls to <body>.
  useEffect(() => {
    const want = navFocusRef.current
    navFocusRef.current = null
    if (want === 'library') {
      paneRef.current?.querySelector<HTMLElement>('.lesson-list button')?.focus()
    } else if (want === 'lesson') {
      backRef.current?.focus()
    }
  }, [browsing])

  // Any builder event means the student ACTED — the pointer served its
  // purpose (or the action made it stale); either way it goes away.
  useEffect(() => session.onEvent(() => hideShowMe()), [session, hideShowMe])

  // Escape while pointing: "no thanks". Without this, a mouse user under
  // the anchor spotlight's dimmer could only escape by performing the action.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hideShowMe()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hideShowMe])

  // Unmount: the spotlight owns DOM nodes; dispose them with the panel.
  useEffect(
    () => () => {
      spotlightRef.current?.dispose()
      spotlightRef.current = null
    },
    [],
  )

  const showMe = (): void => {
    if (showingRef.current) {
      hideShowMe() // second press: the toggle's other half
      return
    }
    if (tutorial === null) return
    const target = tutorial.target
    if (target === null) return

    if (target.kind === 'anchor') {
      // Chrome target: resolve through the registry (aliases keep decade-old
      // lesson data pointing at renamed chrome), ask App to unfold whatever
      // card owns it, then find the live element ONE FRAME LATER — after
      // React has flushed the reveal — and spotlight it. Missing element =
      // quietly nothing.
      const live = resolveAnchor(target.anchor)
      if (live === null) return
      revealAnchorChrome(live)
      requestAnimationFrame(() => {
        // The student may have moved on during the frame we waited.
        if (showingRef.current) return
        // JSON.stringify quotes the attribute value (anchor ids carry dots);
        // it also keeps this lookup from reading as an ATTACHMENT site to the
        // anchors.test.ts source scan — this is a query, not a data-anchor.
        const element = document.querySelector(`[data-anchor=${JSON.stringify(live)}]`)
        if (!(element instanceof HTMLElement)) return
        if (spotlightRef.current === null) spotlightRef.current = createDomSpotlight()
        spotlightRef.current.show(element)
        showingRef.current = true
        setShowing(true)
      })
      return
    }

    // World target: compose the highlight on top of the step's declared
    // overlays and let the lens layer draw it in the world itself — no DOM
    // tour library can spotlight an entity (ARCHITECTURE §9).
    const highlight: LensOverlaySpec =
      target.kind === 'cell'
        ? { kind: 'cell-highlight', tx: target.tx, ty: target.ty, z: target.z, label: 'here' }
        : { kind: 'entity-highlight', marker: target.marker, label: 'this one' }
    session.setOverlays([...declaredOverlays(tutorial.lessonId, tutorial.stepId), highlight])
    composedRef.current = true
    showingRef.current = true
    setShowing(true)
  }

  /** Open a lesson from the library. Opening the RUNNING lesson is pure
   * navigation (no restart — a fixture lesson must not reset its stage
   * just because the student peeked at the shelf). */
  const openLesson = (lessonId: string): void => {
    hideShowMe()
    navFocusRef.current = 'lesson'
    setBrowsing(false)
    if (tutorial !== null && tutorial.lessonId === lessonId) return
    // A lesson WITHOUT a fixture runs on the student's own world — bring it
    // back from the park (if any) BEFORE the lesson starts, so resume and
    // auto-advance look at THEIR world, not leftover fixture scenery. A
    // lesson WITH a fixture needs nothing extra here: loadFixture parks.
    if (!lessonHasFixture(lessonId)) host.restoreParkedIfAny()
    engine.start(lessonId)
  }

  const goToLibrary = (): void => {
    hideShowMe()
    navFocusRef.current = 'library'
    setBrowsing(true)
  }

  /** The lesson data behind the published state — the document renders ALL
   * steps from here; the machine's TutorialUiState marks the position. An
   * unknown id (a mid-HMR gap) falls back to the library. */
  const lessonData = tutorial === null ? undefined : lessons.find((lesson) => lesson.id === tutorial.lessonId)
  const showLibrary = browsing || tutorial === null || lessonData === undefined

  /** The spine's vertical label: where the lesson stands, at a glance. */
  const spineLabel =
    tutorial === null
      ? 'Lessons'
      : tutorial.done
        ? `${tutorial.title} · done`
        : `${tutorial.title} · step ${tutorial.stepIndex + 1} of ${tutorial.stepCount}`

  /** One step of the document: mark, title, prose, figures — plus the
   * escapes and revealed hints on the CURRENT step only. */
  const renderStep = (step: LessonStep, index: number, live: TutorialUiState): ReactElement => {
    const status = statusOf(step, index, live)
    return (
      <li
        key={step.id}
        data-step-id={step.id}
        className={`lesson-step ${status}`}
        aria-current={status === 'current' ? 'step' : undefined}
      >
        <h3 className="lesson-step-title">
          {/* The mark: a checkmark once the step is DONE (the ask), the
              step number otherwise. Decorative — the hidden suffix below
              says "completed" in words. */}
          <span className="step-mark" aria-hidden="true">
            {status === 'done' ? '✓' : index + 1}
          </span>
          {step.title}
          {status === 'done' ? <span className="visually-hidden"> — completed</span> : null}
        </h3>
        <InstructionText text={step.instruction} />

        {(step.figures ?? []).map((figure, f) => (
          <LessonFigure key={f} figure={figure} />
        ))}

        {status === 'current' ? (
          <>
            {live.hints.length > 0 ? (
              <ul className="lesson-hints">
                {live.hints.map((hint, h) => (
                  <li key={h}>
                    <InstructionText text={hint} />
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="lesson-actions">
              {/* aria-disabled, NOT disabled: revealing the LAST hint is a
                  click on this very button, and a hard disabled= at that
                  moment would yank the still-focused button out of the tab
                  order and dump keyboard focus to <body> — a keyboard or
                  screen-reader student would lose their place as a reward
                  for reading all the hints. aria-disabled keeps the button
                  focusable and announced as unavailable; the onClick guard
                  makes the unavailability real. */}
              <button
                type="button"
                data-anchor={anchor('panel.lessonHint')}
                aria-disabled={live.hintsRemaining === 0}
                onClick={() => {
                  if (live.hintsRemaining > 0) engine.requestHint()
                }}
              >
                {live.hintsRemaining > 0 ? `hint (${live.hintsRemaining} left)` : 'hint (none left)'}
              </button>
              <button
                type="button"
                data-anchor={anchor('panel.lessonReset')}
                onClick={() => {
                  // The pointer would survive reset's onEnter re-apply
                  // with a stale picture underneath it — put it away first.
                  hideShowMe()
                  engine.reset()
                }}
              >
                start over this step
              </button>
              <button
                type="button"
                data-anchor={anchor('panel.lessonShowMe')}
                aria-pressed={showing}
                disabled={live.target === null}
                onClick={showMe}
              >
                show me
              </button>
            </div>
          </>
        ) : null}
      </li>
    )
  }

  return (
    <section
      ref={paneRef}
      className={split.parked ? 'lesson-pane parked' : 'lesson-pane'}
      style={{ flexBasis: split.parked ? '44px' : `${split.pct}%` }}
      aria-label="lesson"
      data-anchor={anchor('panel.lesson')}
    >
      {split.parked ? (
        <button
          type="button"
          className="lesson-spine"
          title="Restore the lesson pane"
          onClick={() => setSplit((state) => unparkSplit(state))}
        >
          <span>{spineLabel}</span>
        </button>
      ) : null}

      <div className="lesson-body" hidden={split.parked}>
        {showLibrary ? (
          <div className="lesson-library">
            <h2 className="lesson-library-title">Lessons</h2>
            {/* The picker's registry duty in list form: the anchor rides
                the list. Arc and progress live OUTSIDE each button so a
                button's accessible name is exactly the lesson title. */}
            <ul className="lesson-list" aria-label="lessons" data-anchor={anchor('panel.lessonPicker')}>
              {lessons.map((lesson) => {
                const running = tutorial !== null && tutorial.lessonId === lesson.id
                return (
                  <li key={lesson.id} className={running ? 'running' : undefined}>
                    <span className="lesson-list-arc">{lesson.arc}</span>
                    <button
                      type="button"
                      aria-current={running ? 'true' : undefined}
                      onClick={() => openLesson(lesson.id)}
                    >
                      {lesson.title}
                    </button>
                    {running && tutorial !== null ? (
                      <span className="lesson-list-status">
                        {tutorial.done
                          ? 'finished'
                          : `step ${tutorial.stepIndex + 1} of ${tutorial.stepCount}`}
                      </span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : tutorial === null || lessonData === undefined ? null : (
          <>
            <header className="lesson-head">
              <button type="button" ref={backRef} className="lesson-back" onClick={goToLibrary}>
                All lessons
              </button>
              <span className="lesson-step-count">
                {tutorial.done ? 'finished' : `step ${tutorial.stepIndex + 1} of ${tutorial.stepCount}`}
              </span>
            </header>

            {/* Progress, at a glance; the step-count text above is the
                accessible spelling, so the bar is decoration. */}
            <div className="lesson-progress" aria-hidden="true">
              <i
                style={{
                  width: `${
                    tutorial.done
                      ? 100
                      : Math.round((tutorial.stepIndex / Math.max(1, tutorial.stepCount)) * 100)
                  }%`,
                }}
              />
            </div>

            <div className="lesson-doc" ref={docRef}>
              <div className="lesson-doc-inner">
                <p className="lesson-arc">{tutorial.arc}</p>
                <h2 className="lesson-title">{tutorial.title}</h2>

                {/* THE document: every step, one after another — read ahead
                    freely. The machine's position paints the marks. */}
                <ol className="lesson-steps">
                  {lessonData.steps.map((step, index) => renderStep(step, index, tutorial))}
                </ol>

                {tutorial.done ? (
                  <div className="lesson-finish">
                    <p className="lesson-done">
                      You finished the whole lesson! Your world is saved — and it is YOURS: keep
                      painting, keep placing, keep going. When you want more, pick your next lesson
                      from the list.
                    </p>
                    {/* A fixture lesson ends on borrowed scenery: the way home.
                        Deliberately NOT an anchor — anchors exist so lesson STEPS
                        can point at chrome, and this button renders only in the
                        done state, when no step is (or can ever be) current; no
                        lesson will ever target it, so the registry (whose history
                        is append-forever) must not grow for it. Hidden when no
                        park waits: without one there is nothing to go back to. */}
                    {lessonHasFixture(tutorial.lessonId) && host.hasParked() ? (
                      <button
                        type="button"
                        onClick={() => {
                          host.restoreParkedIfAny()
                          bumpParkCheck((n) => n + 1)
                        }}
                      >
                        Back to my world
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
