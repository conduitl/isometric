/*
 * HISTORY_LIMIT eviction, pinned directly against createHistory.
 *
 * The cap is a promise with two halves: a teacher's whole session fits
 * (HISTORY_LIMIT entries survive), and overflow drops from the BOTTOM —
 * the oldest work is forgotten first, the newest never. These tests push
 * past the cap with distinguishable labels and read the survivors back out
 * through undo, because the label stream is the only honest census of what
 * the stacks still hold.
 */

import { createWorld } from '@engine/core'
import { describe, expect, it } from 'vitest'
import { createHistory, HISTORY_LIMIT } from '../src/editor/commands/history'
import type { PatchesHistoryEntry } from '../src/editor/commands/history'

/** How far past the cap the test pushes. Small on purpose: the claims are
 * about the boundary, not the bulk. */
const OVERFLOW = 5

/** Entry i: a real, applyable Immer patch pair (rename the world to
 * `name i` / back to `name i-1`), so undo/redo genuinely run applyPatches
 * — plus the label `entry i` the assertions read. */
function entry(i: number): PatchesHistoryEntry {
  return {
    kind: 'patches',
    label: `entry ${i}`,
    patches: [{ op: 'replace', path: ['meta', 'name'], value: `name ${i}` }],
    inversePatches: [{ op: 'replace', path: ['meta', 'name'], value: `name ${i - 1}` }],
  }
}

describe('HISTORY_LIMIT eviction', () => {
  it('keeps exactly the newest HISTORY_LIMIT entries; the oldest are evicted', () => {
    const history = createHistory()
    const doc = createWorld({ name: `name ${OVERFLOW - 1}` })
    for (let i = 0; i < HISTORY_LIMIT + OVERFLOW; i += 1) history.push(entry(i))

    // Undo everything, collecting labels newest-first — the census.
    const undone: string[] = []
    for (let applied = history.undo(doc); applied !== null; applied = history.undo(doc)) {
      undone.push(applied.label)
    }

    // Exactly the cap survived — not one more, not one less.
    expect(undone).toHaveLength(HISTORY_LIMIT)
    // The newest entry is kept (undo pops it first)…
    expect(undone[0]).toBe(`entry ${HISTORY_LIMIT + OVERFLOW - 1}`)
    // …and the oldest survivor is the first entry past the evicted ones.
    expect(undone[undone.length - 1]).toBe(`entry ${OVERFLOW}`)
    // The OVERFLOW oldest entries are gone: their labels appear nowhere.
    for (let i = 0; i < OVERFLOW; i += 1) {
      expect(undone).not.toContain(`entry ${i}`)
    }
    // The stack is honestly empty after undoing them all.
    expect(history.canUndo()).toBe(false)
    expect(history.undo(doc)).toBeNull()
  })

  it('eviction never touches the redo stack: every survivor redoes cleanly', () => {
    const history = createHistory()
    const doc = createWorld({ name: `name ${OVERFLOW - 1}` })
    for (let i = 0; i < HISTORY_LIMIT + OVERFLOW; i += 1) history.push(entry(i))

    // Eviction happened on push (undo-stack bottom only). Undoing everything
    // moves each survivor onto the redo stack; if eviction had corrupted
    // either stack, the round-trip below would lose or reorder entries.
    const undone: string[] = []
    for (let applied = history.undo(doc); applied !== null; applied = history.undo(doc)) {
      undone.push(applied.label)
    }
    expect(history.canRedo()).toBe(true)

    const redone: string[] = []
    for (let applied = history.redo(doc); applied !== null; applied = history.redo(doc)) {
      redone.push(applied.label)
    }
    // Redo replays the exact survivors, oldest-first — the mirror image.
    expect(redone).toEqual([...undone].reverse())
    expect(redone).toHaveLength(HISTORY_LIMIT)
    expect(history.canRedo()).toBe(false)
    expect(history.canUndo()).toBe(true) // everything redone is undoable again
  })
})
