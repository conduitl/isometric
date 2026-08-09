/*
 * The history stacks — where the split undo substrate becomes visible.
 *
 * One undo stack, one redo stack, TWO entry kinds, because the two scales
 * of edit undo differently (docs/ARCHITECTURE.md §6):
 *
 * - A `patches` entry (entity/settings commands) holds an Immer
 *   forward/inverse patch pair. Undoing applies the inverse patches and
 *   produces a NEW document — this module returns it so the bus can
 *   `host.replaceDoc(next)`. Id-keyed paths (`entities.e42.name`) keep the
 *   patches correct across interleaved create/delete/undo.
 * - A `stroke` entry (one coalesced brush gesture) holds cell runs
 *   {index, before, after}. Undoing writes the `before` values straight
 *   back into the layer's Uint16Array — the document OBJECT does not change,
 *   so the bus calls `host.tilesTouched(layerId)` instead of replacing it.
 *
 * The mechanics every undo system shares: undo pops the undo stack and
 * pushes the entry onto the redo stack (redo does the reverse), and any NEW
 * committed entry clears the redo stack — once you have gone back and done
 * something different, the abandoned future has no honest meaning.
 *
 * HISTORY_LIMIT sizing (v1): 1000 entries covers a teacher's whole session,
 * not a database. Entries are patch pairs and cell runs — tens of bytes to
 * a few KB each — so even the cap costs at most a few MB, and a kid who
 * undoes 1000 steps is time-travelling, not editing. Oldest entries drop
 * first; history is session-scoped and never persisted into world files
 * (a persisted "replay how I built this" is deferred until a design
 * survives format migration).
 */

import type { World } from '@engine/core'
import { applyPatches } from 'immer'
import type { Patch } from 'immer'
import type { CellRun } from './tile-stroke'
import { redoRuns, undoRuns } from './tile-stroke'
import './immer-setup'

/** Undo memory stays proportional to COMMANDS, not brush pixels or
 * document size — which is why a four-digit cap is comfortably enough. */
export const HISTORY_LIMIT = 1000

/** One entity/settings command: an Immer forward/inverse patch pair. */
export interface PatchesHistoryEntry {
  readonly kind: 'patches'
  readonly label: string
  readonly patches: ReadonlyArray<Patch>
  readonly inversePatches: ReadonlyArray<Patch>
}

/** One committed brush gesture: the layer it painted and its cell runs. */
export interface StrokeHistoryEntry {
  readonly kind: 'stroke'
  readonly label: string
  readonly layerId: string
  readonly runs: ReadonlyArray<CellRun>
}

export type HistoryEntry = PatchesHistoryEntry | StrokeHistoryEntry

/**
 * What undo/redo just did, translated for the bus: a `patches` result
 * carries the NEW document to hand to `host.replaceDoc`; a `stroke` result
 * names the layer whose cells were mutated in place, for
 * `host.tilesTouched`. Both carry the label to announce.
 */
export type AppliedHistoryEntry =
  | { readonly kind: 'patches'; readonly label: string; readonly next: World }
  | { readonly kind: 'stroke'; readonly label: string; readonly layerId: string }

/** The two stacks behind one bus. Session-scoped; cleared on load/import. */
export interface CommandHistory {
  /** Commit a new entry: pushes onto the undo stack, CLEARS the redo stack,
   * drops the oldest entry past HISTORY_LIMIT. */
  push(entry: HistoryEntry): void
  /** Undo the newest entry against the current document. Returns what was
   * done (see {@link AppliedHistoryEntry}), or null on an empty stack. */
  undo(doc: World): AppliedHistoryEntry | null
  /** Redo the most recently undone entry. Null on an empty redo stack. */
  redo(doc: World): AppliedHistoryEntry | null
  canUndo(): boolean
  canRedo(): boolean
  clear(): void
}

/** Build the empty session history. One per command bus. */
export function createHistory(): CommandHistory {
  const undoStack: HistoryEntry[] = []
  const redoStack: HistoryEntry[] = []

  /** A stroke entry's layer must still exist: Phase 2 has no command that
   * removes a layer, so a miss is a programmer error, not a user state. */
  const findLayer = (doc: World, layerId: string) => {
    const layer = doc.layers.find((candidate) => candidate.id === layerId)
    if (layer === undefined) {
      throw new Error(
        `history entry refers to layer "${layerId}", which is not in the document — ` +
          'no Phase 2 command deletes layers, so this is a programmer error',
      )
    }
    return layer
  }

  const apply = (entry: HistoryEntry, doc: World, direction: 'undo' | 'redo'): AppliedHistoryEntry => {
    if (entry.kind === 'patches') {
      // applyPatches produces a NEW document (structural sharing keeps
      // untouched branches — layers included — reference-identical).
      const next = applyPatches(doc, [...(direction === 'undo' ? entry.inversePatches : entry.patches)])
      return { kind: 'patches', label: entry.label, next }
    }
    const layer = findLayer(doc, entry.layerId)
    if (direction === 'undo') undoRuns(layer, entry.runs)
    else redoRuns(layer, entry.runs)
    return { kind: 'stroke', label: entry.label, layerId: entry.layerId }
  }

  return {
    push(entry: HistoryEntry): void {
      undoStack.push(entry)
      redoStack.length = 0
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
    },
    undo(doc: World): AppliedHistoryEntry | null {
      const entry = undoStack.pop()
      if (entry === undefined) return null
      redoStack.push(entry)
      return apply(entry, doc, 'undo')
    },
    redo(doc: World): AppliedHistoryEntry | null {
      const entry = redoStack.pop()
      if (entry === undefined) return null
      undoStack.push(entry)
      return apply(entry, doc, 'redo')
    },
    canUndo(): boolean {
      return undoStack.length > 0
    },
    canRedo(): boolean {
      return redoStack.length > 0
    },
    clear(): void {
      undoStack.length = 0
      redoStack.length = 0
    },
  }
}
