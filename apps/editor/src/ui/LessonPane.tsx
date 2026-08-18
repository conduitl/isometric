/**
 * The lesson pane — the LEFT HALF of the app, because the lesson is the
 * product and the editor its companion (the 2026-08 reframe: this used to be
 * a right-rail panel called LessonRail; the engine wiring survived the move
 * intact, the framing did not).
 *
 * Renders the snapshot's `tutorial` slice (TutorialUiState, published by
 * @engine/tutorial's machine through the host seam) as a real DOCUMENT —
 * comfortable measure, real figures — and drives the engine through its
 * named methods: requestHint, reset, start. The pane decides NOTHING about
 * lesson progress — the machine owns which step is current; this pane shows
 * it and offers the escapes (hint + start-over on every step is a Phase 3
 * exit criterion).
 *
 * Instructions and hints pass through the in-house mini-formatter (bold and
 * code spans, paragraphs — the whole vocabulary). Figures are looked up
 * from the lesson DATA by (lessonId, stepId) — same pattern as
 * declaredOverlays below — so the tutorial machine stays untouched by
 * presentation concerns.
 *
 * ## Parking
 *
 * The pane can PARK to a 44px labeled spine (the divider's Home key, a drag
 * below the park threshold, or the global L key — App owns the state; this
 * pane renders it). While parked the document hides but stays MOUNTED, so
 * every panel.lesson* anchor keeps existing in the DOM — the anchor
 * registry's promise. A NEW step (or the lesson finishing) auto-restores
 * the pane: the student asked for free building, but fresh instructions are
 * exactly the moment they want the lesson back — and the spine advertises
 * this ("step 3 of 5") rather than hiding it.
 *
 * ## "Show me" — the step-target spotlight
 *
 * Unchanged in spirit from the rail (anchor targets get the DOM masked
 * spotlight; world targets compose a highlight over the step's declared
 * overlays), with ONE new move: editor chrome now lives in collapsible
 * overlay cards, so before spotlighting an anchor the pane asks App to
 * REVEAL the card that owns it (revealAnchorChrome) and looks the element
 * up a frame later — pointing at a folded card would otherwise spotlight
 * nothing. The pointer still hides on: a second press, a step change, any
 * builder event, and Escape.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, ReactElement, SetStateAction } from 'react'
import { lessons } from '@content/lessons'
import { createDomSpotlight } from '@engine/lens'
import type { DomSpotlight } from '@engine/lens'
import type { LensOverlaySpec, StepFigure, TutorialEngine } from '@engine/tutorial'
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

/** The current step's figures, from the lesson data (presentation-only, so
 * the machine never carries them — the pane looks them up like it looks up
 * declared overlays). */
function stepFigures(lessonId: string, stepId: string | null): ReadonlyArray<StepFigure> {
  if (stepId === null) return []
  const lesson = lessons.find((candidate) => candidate.id === lessonId)
  return lesson?.steps.find((candidate) => candidate.id === stepId)?.figures ?? []
}

/** The lesson pane: always mounted (the anchor's promise), populated while
 * a lesson is running, collapsed to its spine while parked. */
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

  // Any builder event means the student ACTED — the pointer served its
  // purpose (or the action made it stale); either way it goes away.
  useEffect(() => session.onEvent(() => hideShowMe()), [session, hideShowMe])

  // Escape while pointing: "no thanks". Without this, a mouse user under
  // the anchor spotlight's dimmer could only escape by doing the action.
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
        ? { kind: 'cell-highlight', tx: target.tx, ty: target.ty, label: 'here' }
        : { kind: 'entity-highlight', marker: target.marker, label: 'this one' }
    session.setOverlays([...declaredOverlays(tutorial.lessonId, tutorial.stepId), highlight])
    composedRef.current = true
    showingRef.current = true
    setShowing(true)
  }

  /** The spine's vertical label: where the lesson stands, at a glance. */
  const spineLabel =
    tutorial === null
      ? 'Lesson'
      : tutorial.done
        ? `${tutorial.title} · done`
        : `${tutorial.title} · step ${tutorial.stepIndex + 1} of ${tutorial.stepCount}`

  return (
    <section
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
        {tutorial === null ? null : (
          <>
            <header className="lesson-head">
              <span className="lesson-arc">{tutorial.arc}</span>
              {/* The picker: every shipped lesson, the running one selected.
                  Present in both states — done invites the next lesson. */}
              <label className="lesson-picker">
                <span className="visually-hidden">lesson</span>
                <select
                  data-anchor={anchor('panel.lessonPicker')}
                  value={tutorial.lessonId}
                  onChange={(e) => {
                    hideShowMe()
                    const nextId = e.currentTarget.value
                    // A lesson WITHOUT a fixture runs on the student's own
                    // world — bring it back from the park (if any) BEFORE the
                    // lesson starts, so resume and auto-advance look at THEIR
                    // world, not leftover fixture scenery. A lesson WITH a
                    // fixture needs nothing extra here: loadFixture parks.
                    if (!lessonHasFixture(nextId)) host.restoreParkedIfAny()
                    engine.start(nextId)
                  }}
                >
                  {lessons.map((lesson) => (
                    <option key={lesson.id} value={lesson.id}>
                      {lesson.title}
                    </option>
                  ))}
                </select>
              </label>
              {tutorial.done ? null : (
                <span className="lesson-step-count">
                  step {tutorial.stepIndex + 1} of {tutorial.stepCount}
                </span>
              )}
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

            <div className="lesson-doc">
              <div className="lesson-doc-inner">
                <h2 className="lesson-title">{tutorial.title}</h2>

                {tutorial.done ? (
                  <>
                    <p className="lesson-done">
                      You finished the whole lesson! Your world is saved — and it is YOURS: keep
                      painting, keep placing, keep going. When you want more, pick your next lesson
                      above.
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
                  </>
                ) : (
                  <>
                    <h3 className="lesson-step-title">{tutorial.stepTitle}</h3>
                    <InstructionText text={tutorial.instruction} />

                    {stepFigures(tutorial.lessonId, tutorial.stepId).map((figure, index) => (
                      <LessonFigure key={index} figure={figure} />
                    ))}

                    {tutorial.hints.length > 0 ? (
                      <ul className="lesson-hints">
                        {tutorial.hints.map((hint, index) => (
                          <li key={index}>
                            <InstructionText text={hint} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            {tutorial.done ? null : (
              <div className="lesson-actions">
                {/* aria-disabled, NOT disabled: revealing the LAST hint is a
                    click on this very button, and a hard disabled= at that
                    moment would yank the still-focused button out of the tab
                    order and dump keyboard focus to <body> — a keyboard or
                    screen-reader student would lose their place as a reward
                    for reading all the hints. aria-disabled keeps the button
                    focusable and announced as unavailable; the onClick guard
                    makes the unavailability real. The label change below
                    still tells sighted users the well is dry. */}
                <button
                  type="button"
                  data-anchor={anchor('panel.lessonHint')}
                  aria-disabled={tutorial.hintsRemaining === 0}
                  onClick={() => {
                    if (tutorial.hintsRemaining > 0) engine.requestHint()
                  }}
                >
                  {tutorial.hintsRemaining > 0
                    ? `hint (${tutorial.hintsRemaining} left)`
                    : 'hint (none left)'}
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
                  disabled={tutorial.target === null}
                  onClick={showMe}
                >
                  show me
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
