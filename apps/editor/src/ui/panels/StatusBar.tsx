/**
 * The status bar — the slow facts through React, the fast facts around it.
 *
 * Two very different data rates share this strip, and the architecture
 * splits them on purpose:
 *
 * - **Pointer-rate data bypasses React by architecture** (ARCHITECTURE §6:
 *   "linked numeric displays at rAF rate outside React's throttled store").
 *   The cursor's cell address and the camera zoom change on every pointer
 *   twitch, so they ride the session's FastChannel into imperative
 *   textContent writes on two refs — no setState, no re-render, no React
 *   involvement past the initial mount. A late mount paints fast.last so
 *   the readout never opens blank mid-session.
 * - **Edit-rate data renders normally**: the save-state badge and the
 *   aria-live announcer read the throttled snapshot like any panel.
 *
 * The announcer is the editor's single voice for screen readers: the
 * session's lastAction label ("painted 6 tiles", "undid: place crate")
 * plus the persistence message when a document was restored or a save
 * failed. role="status" + polite, visually hidden but ALWAYS in the DOM —
 * a live region that mounts and unmounts is a live region that misses
 * announcements.
 */

import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { anchor } from '../../editor/anchors'
import type { CursorReadout, EditorSession } from '../../editor/types'
import { useSnapshot } from '../App'

/** The cursor's place, preferring the cell address (the taught spelling);
 * the world point when outside the active layer; a dash when off-canvas. */
function formatCoords(readout: CursorReadout): string {
  if (readout.tile !== null) return `(${readout.tile.tx}, ${readout.tile.ty})`
  if (readout.world !== null) return `(${readout.world.x.toFixed(1)}, ${readout.world.y.toFixed(1)})`
  return '—'
}

/** Zoom as a plain multiplier, 1.00 = the whole world fits. */
function formatZoom(zoom: number): string {
  return `×${zoom.toFixed(2)}`
}

/** The bottom strip: fast readouts, save badge, and the live announcer. */
export function StatusBar({ session }: { session: EditorSession }): ReactElement {
  const persistence = useSnapshot(session, (s) => s.persistence)
  const lastAction = useSnapshot(session, (s) => s.lastAction)
  const lastActionSeq = useSnapshot(session, (s) => s.lastActionSeq)

  const coordsRef = useRef<HTMLSpanElement>(null)
  const zoomRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const write = (readout: CursorReadout): void => {
      // Imperative on purpose — see the header. NEVER React state here.
      if (coordsRef.current !== null) coordsRef.current.textContent = formatCoords(readout)
      if (zoomRef.current !== null) zoomRef.current.textContent = formatZoom(readout.zoom)
    }
    if (session.fast.last !== null) write(session.fast.last)
    // subscribe returns unsubscribe — the paired cleanup StrictMode demands.
    return session.fast.subscribe(write)
  }, [session])

  // The one spoken line: the last completed action, joined with the
  // persistence story when there is one worth telling.
  //
  // The repeat trick: a polite live region only re-announces when its DOM
  // text MUTATES, so painting one tile twice in a row ("painted 1 tile",
  // then the identical label again) would be silent the second time. The
  // snapshot's lastActionSeq bumps on EVERY completed action, so an odd seq
  // appends a zero-width space (U+200B): visually nothing, spoken as
  // nothing, but the text node alternates between two spellings and screen
  // readers re-announce every repeat.
  const spoken: string[] = []
  if (lastAction !== null) spoken.push(lastActionSeq % 2 === 1 ? `${lastAction}\u200B` : lastAction)
  if ((persistence.state === 'restored' || persistence.state === 'error') && persistence.message !== null) {
    spoken.push(persistence.message)
  }

  return (
    <div className="status-bar">
      <span className="label">cell</span>
      <span className="status-readout" data-anchor={anchor('status.coords')} ref={coordsRef}>
        —
      </span>
      <span className="label">zoom</span>
      <span className="status-readout" data-anchor={anchor('status.zoom')} ref={zoomRef}>
        —
      </span>
      <span
        className={`save-badge save-${persistence.state}`}
        data-anchor={anchor('status.saveState')}
        title={persistence.message ?? undefined}
      >
        {persistence.state}
        {persistence.message !== null ? ` — ${persistence.message}` : ''}
      </span>
      <p
        className="visually-hidden"
        role="status"
        aria-live="polite"
        data-anchor={anchor('status.announcements')}
      >
        {spoken.join(' — ')}
      </p>
    </div>
  )
}
