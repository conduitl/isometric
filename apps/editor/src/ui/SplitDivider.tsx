/**
 * The divider between the lesson document and the editor — hand-rolled on
 * purpose (~80 lines: pointer capture plus a keydown handler), so docking
 * libraries stay deferred and no dependency enters DECISIONS.md.
 *
 * All the arithmetic lives in split-math.ts (pure, unit-tested); this
 * component is the DOM half: a real `role="separator"` Tab stop whose
 * aria-value* mirror the lesson pane's percentage (0 while parked), drag
 * via pointer capture against the frame's live width, and the keyboard
 * contract the brief pinned — arrows nudge (Shift strides), Enter and
 * double-click cycle the reading/balanced/building presets, Home parks the
 * lesson to its spine, End restores or widens.
 */

import type { ReactElement, RefObject } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  cycleSplitPreset,
  nudgeSplit,
  parkSplit,
  SPLIT_BIG_STEP,
  SPLIT_MAX,
  SPLIT_MIN,
  SPLIT_STEP,
  splitFromPointer,
  widenSplit,
} from './split-math'
import type { SplitState } from './split-math'

export function SplitDivider({
  state,
  onChange,
  frameRef,
}: {
  state: SplitState
  onChange: (next: SplitState) => void
  /** The split frame itself — the width the drag percentage is measured
   * against, read live because the window resizes under the divider. */
  frameRef: RefObject<HTMLDivElement | null>
}): ReactElement {
  const dragTo = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const frame = frameRef.current
    if (frame === null) return
    const rect = frame.getBoundingClientRect()
    if (rect.width <= 0) return
    onChange(splitFromPointer(state, ((e.clientX - rect.left) / rect.width) * 100))
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? SPLIT_BIG_STEP : SPLIT_STEP
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        onChange(nudgeSplit(state, -step))
        return
      case 'ArrowRight':
        e.preventDefault()
        onChange(nudgeSplit(state, step))
        return
      case 'Enter':
        e.preventDefault()
        onChange(cycleSplitPreset(state))
        return
      case 'Home':
        e.preventDefault()
        onChange(parkSplit(state))
        return
      case 'End':
        e.preventDefault()
        onChange(widenSplit(state))
        return
      default:
    }
  }

  return (
    <div
      className="split-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the lesson and editor panes"
      aria-valuemin={SPLIT_MIN}
      aria-valuemax={SPLIT_MAX}
      aria-valuenow={state.parked ? 0 : Math.round(state.pct)}
      tabIndex={0}
      onPointerDown={(e) => {
        // Capture makes the drag survive the pointer leaving the 6px strip
        // — every later move routes here until release, wherever it lands.
        e.currentTarget.setPointerCapture(e.pointerId)
        dragTo(e)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) dragTo(e)
      }}
      onDoubleClick={() => onChange(cycleSplitPreset(state))}
      onKeyDown={onKeyDown}
    >
      <span className="split-grip" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}
