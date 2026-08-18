/**
 * One lesson figure, rendered — the React face of the StepFigure data
 * (@engine/tutorial types.ts):
 *
 * - **image** figures are a plain <img> with required alt text.
 * - **scene** figures hand a <canvas> to attachSceneFigure
 *   (editor/lesson/figures.ts), which draws the named fixture world through
 *   the real engine — same projections, same renderer, same lens overlays
 *   as the viewport. The component's only jobs are the canvas's lifecycle
 *   and its size: draw on mount, redraw when the lesson pane's divider
 *   gives the figure new room (ResizeObserver), and render NOTHING when the
 *   fixture id resolves to nothing — no picture beats a wrong picture, and
 *   the prose still teaches.
 *
 * Figures are presentation-only by schema, so nothing here talks to the
 * session, the store, or the tutorial machine.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { StepFigure } from '@engine/tutorial'
import { attachSceneFigure } from '../../editor/lesson/figures'

/** Wraps the picture (either kind) with its optional caption. */
function Framed({ caption, children }: { caption?: string; children: ReactElement }): ReactElement {
  return (
    <figure className="lesson-figure">
      {children}
      {caption !== undefined ? <figcaption>{caption}</figcaption> : null}
    </figure>
  )
}

/** The scene arm: a canvas the engine draws into, redrawn per resize. */
function SceneFigure({ figure }: { figure: Extract<StepFigure, { kind: 'scene' }> }): ReactElement | null {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** Flipped when the fixture id resolves to nothing — the figure then
   * renders as nothing at all (see header). */
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const draw = attachSceneFigure(canvas, figure)
    if (draw === null) {
      setMissing(true)
      return
    }
    const redraw = (): void => {
      const rect = canvas.getBoundingClientRect()
      draw({ width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1 })
    }
    redraw()
    // The divider resizes the lesson pane continuously; the observer keeps
    // the picture sharp at every width. Paired disconnect for StrictMode.
    const observer = new ResizeObserver(redraw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [figure])

  if (missing) return null
  return (
    <Framed caption={figure.caption}>
      {/* role=img + aria-label: the canvas pixels ARE the content, and the
          alt text is the schema-required speakable description. */}
      <canvas ref={canvasRef} className="lesson-figure-scene" role="img" aria-label={figure.alt} />
    </Framed>
  )
}

/** A step figure of either kind, framed and captioned. */
export function LessonFigure({ figure }: { figure: StepFigure }): ReactElement | null {
  if (figure.kind === 'image') {
    return (
      <Framed caption={figure.caption}>
        <img src={figure.src} alt={figure.alt} />
      </Framed>
    )
  }
  return <SceneFigure figure={figure} />
}
