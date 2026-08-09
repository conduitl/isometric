/**
 * The lesson rail — the authoring harness's face.
 *
 * Renders the snapshot's LessonUiState and nothing else: the harness decides
 * which step is current (world facts + builder events), the session mirrors
 * it, and this rail just shows it. Instructions pass through the in-house
 * mini-formatter (bold and code spans, paragraphs — the whole vocabulary),
 * so an author's `**bold**` becomes a real <strong> and their backticks a
 * real <code>, with unterminated markers surfacing literally instead of
 * eating the sentence.
 *
 * When no lesson is loaded the rail shows nothing — but the WRAPPER element
 * still renders, carrying the panel.lesson anchor. That is a promise, not an
 * accident: the anchor registry guarantees every registered anchor exists in
 * the mounted UI, so a lesson step (or the anchor tripwire test) can always
 * find the rail, even at the moment a lesson is about to appear in it.
 *
 * The done state congratulates and tells the truth that matters most to a
 * ten-year-old: the world they just built is saved, and it is THEIRS.
 */

import { Fragment } from 'react'
import type { ReactElement } from 'react'
import { anchor } from '../../editor/anchors'
import { formatInstruction } from '../../editor/lesson/format'
import type { EditorSession } from '../../editor/types'
import { useSnapshot } from '../App'

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

/** The lesson region: always mounted (the anchor's promise), populated only
 * while a lesson is loaded. */
export function LessonRail({ session }: { session: EditorSession }): ReactElement {
  const lesson = useSnapshot(session, (s) => s.lesson)

  return (
    <section className="panel lesson-rail" aria-label="lesson" data-anchor={anchor('panel.lesson')}>
      {lesson === null ? null : (
        <>
          <h2>{lesson.title}</h2>
          {lesson.done ? (
            <p className="lesson-done">
              You finished the whole lesson! Your world is saved — and it is YOURS: keep painting,
              keep placing, keep going.
            </p>
          ) : (
            <>
              <p className="lesson-step-count">
                step {lesson.stepIndex + 1} of {lesson.stepCount}
              </p>
              <InstructionText text={lesson.instruction} />
              {lesson.hint !== null ? (
                <details>
                  <summary>hint</summary>
                  <InstructionText text={lesson.hint} />
                </details>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  )
}
