/**
 * EngineViewport — THE React↔engine boundary component (ARCHITECTURE §6).
 *
 * React's entire contribution to the canvas is this file: mount a <canvas>
 * exactly once, hand it to the session, and route the canvas's OWN keyboard
 * onto named session methods. `session.attach(canvas)` owns everything else
 * — sizing (ResizeObserver + DPR), the render-on-demand rAF loop, pointer
 * routing to the active tool — and returns a detach function that undoes all
 * of it, so the effect below is a clean attach/detach pair. StrictMode
 * deliberately runs that pair twice in dev (mount → cleanup → mount); the
 * component survives because attach and detach are true inverses.
 *
 * Note what is ABSENT here: React state. Every keystroke calls a session
 * method and nothing else — no useState, no re-render, no derived UI. The
 * one read this component ever performs is an imperative getState() peek at
 * the current selection when Delete is pressed, which is an event-handler
 * read of the mirror, not a render subscription.
 *
 * The keyboard IS a pointer here (ARCHITECTURE §2.5: every tool is
 * keyboard-operable): arrows walk a cell cursor, Enter/Space acts through
 * the active tool at that cell, and the aria-label plus a visually-hidden
 * legend spell the whole story for screen-reader users before they ever
 * press a key.
 */

import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { anchor } from '../editor/anchors'
import type { EditorSession } from '../editor/types'

/** Shift turns one arrow press into a five-cell stride — fast travel for
 * big maps, spelled out in the aria-label so it is discoverable. */
const FAST_STEP = 5

const KEYBOARD_STORY =
  'world canvas — arrow keys move the cell cursor, up is north (hold Shift for 5-cell steps), ' +
  'Enter paints or places, V/B/E switch tools'

/** The one canvas React ever mounts, wired to the session for its lifetime. */
export function EngineViewport({ session }: { session: EditorSession }): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    // attach() returns detach — the paired inverse StrictMode's double
    // mount depends on. Nothing else in React knows the canvas exists.
    return session.attach(canvas)
  }, [session])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    // App-level chords (Ctrl/Cmd+Z, +S…) are the window listener's business.
    if (e.ctrlKey || e.metaKey || e.altKey) return

    const step = e.shiftKey ? FAST_STEP : 1
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        session.moveCursor(-step, 0)
        return
      case 'ArrowRight':
        e.preventDefault()
        session.moveCursor(step, 0)
        return
      // Up-screen is world NORTH (+y): the world keeps math-class axes
      // (docs/DECISIONS.md D3) and the top-down projection puts north up,
      // so ArrowUp INCREASES ty. Mapping it the screen-array way (−ty) was
      // a real shipped bug: the cursor walked down while the student
      // pressed up. The picture, the readout, and the key now agree — and
      // "y grows upward, like a graph" is the taught convention.
      case 'ArrowUp':
        e.preventDefault()
        session.moveCursor(0, step)
        return
      case 'ArrowDown':
        e.preventDefault()
        session.moveCursor(0, -step)
        return
      case 'Enter':
      case ' ':
        e.preventDefault() // Space must never scroll the page mid-paint
        session.actAtCursor()
        return
      case 'Escape':
        session.cancelGesture()
        return
      case 'Delete':
      case 'Backspace': {
        e.preventDefault() // Backspace must never navigate away from a world
        // The keyboard can race a held pointer mid-paint, and the bus THROWS
        // on dispatch while a stroke is open (gestures are atomic) — so ask
        // the honest predicate and refuse quietly instead.
        if (session.bus.strokeOpen()) return
        // Imperative peek at the mirror — an event-handler read, not a
        // render subscription; this component keeps zero React state.
        const selection = session.store.getState().selection
        if (selection !== null && selection.kind === 'entity') {
          // Deselect only when the delete really happened: a refused
          // dispatch (a stale id) must not silently drop the selection.
          if (session.bus.dispatch({ kind: 'delete-entity', id: selection.id }).ok) {
            session.select(null)
          }
        }
        return
      }
      case '+':
      case '=':
        session.zoomBy(1.25)
        return
      case '-':
      case '_':
        session.zoomBy(0.8)
        return
      case '0':
        session.resetCamera()
        return
      default:
        break
    }

    switch (e.key.toLowerCase()) {
      case 'v':
        session.setActiveTool('select')
        return
      case 'b':
        session.setActiveTool('brush')
        return
      case 'e':
        session.setActiveTool('placer')
        return
      default:
        return
    }
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        data-anchor={anchor('viewport.canvas')}
        role="application"
        tabIndex={0}
        aria-label={KEYBOARD_STORY}
        aria-describedby="viewport-keyboard-legend"
        onKeyDown={onKeyDown}
      />
      {/* The long-form legend, off-screen but in the accessibility tree, so a
          screen-reader user can study the commands before entering the
          application-role canvas (where their virtual cursor hands over). */}
      <p id="viewport-keyboard-legend" className="visually-hidden">
        Keyboard commands inside the world canvas: arrow keys move the cell cursor one cell; hold
        Shift to move five cells at a time. Enter or Space paints, places, or selects at the cursor,
        depending on the active tool. V selects the select tool, B the tile brush, E the entity
        placer. Escape cancels the gesture in progress. Delete removes the selected entity. Plus and
        minus zoom; zero refits the whole world.
      </p>
    </>
  )
}
