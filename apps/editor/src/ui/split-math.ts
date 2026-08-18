/**
 * Split-pane arithmetic — every number the lesson/editor divider obeys, as
 * pure functions (App.tsx renders them; this file never touches the DOM, so
 * the whole keyboard-and-drag contract is unit-testable in node).
 *
 * The model: the lesson pane owns `pct` percent of the frame width, clamped
 * to [MIN, MAX] so neither document nor world can be squeezed into
 * uselessness — EXCEPT when parked. Parking collapses the lesson to a thin
 * labeled spine (free building, the world full-bleed), and `pct` is KEPT
 * while parked so restoring lands exactly where the student left off. A
 * drag below PARK_AT reads as "get it out of my way" and parks; presets
 * cover the arc of a session (reading → balanced → building) and Enter
 * cycles them.
 */

/** The lesson pane's legal share of the frame, in percent. */
export const SPLIT_MIN = 22
export const SPLIT_MAX = 74

/** Dragging the divider below this percentage parks the lesson — the drag
 * itself is the "get it out of my way" gesture. */
export const SPLIT_PARK_AT = 14

/** Reading (60), balanced (46 — the default), building (24). */
export const SPLIT_PRESETS: ReadonlyArray<number> = [60, 46, 24]
export const SPLIT_DEFAULT = 46

/** How close (in points) a preset must be to count as "the current one"
 * when Enter cycles — a hand-dragged 45% still reads as "balanced". */
const PRESET_NEARBY = 3

/** Keyboard steps: plain arrows nudge, Shift+arrows stride. */
export const SPLIT_STEP = 2
export const SPLIT_BIG_STEP = 10

export interface SplitState {
  /** The lesson pane's percent share while open — RETAINED while parked,
   * so unparking restores the student's chosen width. */
  readonly pct: number
  readonly parked: boolean
}

export const SPLIT_BOOT: SplitState = { pct: SPLIT_DEFAULT, parked: false }

function clamp(raw: number): number {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, raw))
}

/** A pointer drag's raw percent → the next state: below PARK_AT parks
 * (keeping the last open width); anything else opens at the clamped value. */
export function splitFromPointer(state: SplitState, raw: number): SplitState {
  if (raw < SPLIT_PARK_AT) return { pct: state.pct, parked: true }
  return { pct: clamp(raw), parked: false }
}

/** Arrow keys: nudge by ±delta. A nudge while parked UNPARKS to the stored
 * width first — the arrow says "I want the lesson", not "move a ghost". */
export function nudgeSplit(state: SplitState, delta: number): SplitState {
  if (state.parked) return { pct: state.pct, parked: false }
  return { pct: clamp(state.pct + delta), parked: false }
}

/** Enter / double-click: cycle the presets. The current position (parked
 * counts as 0) advances to the preset AFTER whichever it sits near; a
 * position near none lands on the first (reading). */
export function cycleSplitPreset(state: SplitState): SplitState {
  const at = state.parked ? 0 : state.pct
  let next = SPLIT_PRESETS[0] ?? SPLIT_DEFAULT
  for (let i = 0; i < SPLIT_PRESETS.length; i += 1) {
    const preset = SPLIT_PRESETS[i]
    if (preset !== undefined && Math.abs(preset - at) < PRESET_NEARBY) {
      next = SPLIT_PRESETS[(i + 1) % SPLIT_PRESETS.length] ?? next
      break
    }
  }
  return { pct: next, parked: false }
}

/** Home parks; the spine (and End, and L) restores. */
export function parkSplit(state: SplitState): SplitState {
  return { pct: state.pct, parked: true }
}

export function unparkSplit(state: SplitState): SplitState {
  return { pct: clamp(state.pct), parked: false }
}

/** End: parked → restore; open → widest reading width. */
export function widenSplit(state: SplitState): SplitState {
  return state.parked ? unparkSplit(state) : { pct: SPLIT_MAX, parked: false }
}

// ---------------------------------------------------------------------------
// Persistence — a UI preference, stored beside the editor's other slots
// ---------------------------------------------------------------------------

/** localStorage key, sibling to 'editor:world' / 'editor:tutorial-progress'. */
export const SPLIT_PREF_KEY = 'editor:lesson-split'

/** The narrow slice of Storage the pref needs — injected in tests. */
export interface PrefStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Parse a stored pref, defensively: anything malformed — bad JSON, numbers
 * out of range, missing fields — yields the boot default. A corrupt UI pref
 * must never take the editor down with it. */
export function readSplitPref(storage: PrefStorage | undefined): SplitState {
  if (storage === undefined) return SPLIT_BOOT
  let text: string | null = null
  try {
    text = storage.getItem(SPLIT_PREF_KEY)
  } catch {
    return SPLIT_BOOT
  }
  if (text === null) return SPLIT_BOOT
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return SPLIT_BOOT
    const pct = (parsed as { pct?: unknown }).pct
    const parked = (parsed as { parked?: unknown }).parked
    if (typeof pct !== 'number' || !Number.isFinite(pct)) return SPLIT_BOOT
    if (typeof parked !== 'boolean') return SPLIT_BOOT
    return { pct: clamp(pct), parked }
  } catch {
    return SPLIT_BOOT
  }
}

export function writeSplitPref(storage: PrefStorage | undefined, state: SplitState): void {
  if (storage === undefined) return
  try {
    storage.setItem(SPLIT_PREF_KEY, JSON.stringify({ pct: state.pct, parked: state.parked }))
  } catch {
    // Quota, privacy mode — losing a width preference is not an error worth
    // surfacing to a student.
  }
}
