/*
 * The brush gesture's raster half — tile edits that live OUTSIDE Immer.
 *
 * A drag-paint stroke touches a cell per pointer move, sometimes hundreds
 * per second. Running each touch through `produceWithPatches` would hit
 * Immer's documented worst case (large arrays, many small writes) right in
 * the paint-feel hot path, and would grow undo memory per brush PIXEL. So
 * tile edits take the other lane of the split undo substrate
 * (docs/ARCHITECTURE.md §6): cells mutate in place via setCell — which does
 * its own invalidation bookkeeping (revision + dirty cells) for the render
 * cache — while this module records just enough to run history backwards:
 * one {index, before, after} run per touched cell.
 *
 * COALESCING is the memory story: a stroke that crosses the same cell
 * twenty times records it once. The map is keyed by flat cell index;
 * `before` is first-write-wins (the value the cell held when the stroke
 * FIRST touched it — the only value undo may restore) and `after` is
 * last-write-wins. Within one stroke the painted value is constant, so a
 * repainted cell cannot actually change twice — but the rule is stated and
 * enforced anyway, so the record stays correct if a future stroke kind ever
 * varies its value mid-gesture.
 *
 * ORDER is the event story: the recorder preserves FIRST-paint order, and
 * the builder.tile-painted event lists cells in that order (a lesson that
 * says "paint left to right" can check it). Map iteration order is
 * insertion order, so the map IS the order — no second bookkeeping list.
 *
 * The inverse operations are mechanical: undo writes every `before` back
 * (reverse order), redo writes every `after` (forward order), cancel is
 * undo for a stroke that never reached history. Reverse order on the undo
 * side mirrors patch inversion discipline — with coalesced (unique-index)
 * runs the order cannot matter, but symmetry is cheap and reads honestly.
 * Cell coordinates come back from the flat index by the taught inverse:
 * x = index % width, y = ⌊index / width⌋ (layer.ts teaches the forward
 * formula index = y·width + x).
 */

import type { TileLayer } from '@engine/core'
import { cellIndex, getCell, setCell } from '@engine/tilemap'

/**
 * One coalesced cell record: the flat index (index = y·width + x), the
 * value the cell held when the stroke first touched it, and the value the
 * stroke left behind. A history entry for a stroke is a list of these —
 * memory proportional to distinct cells touched, never to pointer moves.
 */
export interface CellRun {
  readonly index: number
  readonly before: number
  readonly after: number
}

/**
 * The raster half of one live stroke: paints cells, records runs. The bus
 * wraps this in the public {@link import('../types').TileStroke} shape,
 * adding history, events, and the host's tilesTouched notifications —
 * this object knows nothing about any of that.
 */
export interface StrokeRecorder {
  /** Paint one cell with the stroke's tile value. Returns whether the cell
   * actually changed — painting grass on grass, or painting out of bounds,
   * changes nothing and records nothing. */
  paint(tx: number, ty: number): boolean
  /** Close the stroke and report its runs in first-paint order. */
  end(): CellRun[]
  /** Close the stroke and revert every changed cell (reverse paint order).
   * Returns how many cells were reverted, so the caller knows whether the
   * canvas needs repainting. */
  cancel(): number
}

/**
 * Begin recording one stroke over a layer with one tile value (0 erases).
 * The recorder is single-use: after end() or cancel(), every method throws
 * — a closed gesture receiving more paint is a programmer error upstream,
 * never something to absorb silently.
 */
export function createStrokeRecorder(layer: TileLayer, tile: number): StrokeRecorder {
  // Insertion order = first-paint order; see the file header.
  const runs = new Map<number, { index: number; before: number; after: number }>()
  let closed = false

  const assertOpen = (what: string): void => {
    if (closed) {
      throw new Error(`${what}() on a stroke that already ended — a stroke is single-use (programmer error)`)
    }
  }

  return {
    paint(tx: number, ty: number): boolean {
      assertOpen('paint')
      const index = cellIndex(layer, tx, ty)
      if (index === -1) return false // out of bounds: ignored, nothing recorded
      const before = getCell(layer, tx, ty)
      if (before === tile) return false // no-op paint: nothing changed, nothing recorded
      setCell(layer, tx, ty, tile)
      const existing = runs.get(index)
      if (existing === undefined) {
        runs.set(index, { index, before, after: tile })
      } else {
        existing.after = tile // before stays first-write-wins
      }
      return true
    },
    end(): CellRun[] {
      assertOpen('end')
      closed = true
      return [...runs.values()]
    },
    cancel(): number {
      assertOpen('cancel')
      closed = true
      const recorded = [...runs.values()]
      for (const run of recorded.reverse()) {
        setCell(layer, run.index % layer.width, Math.floor(run.index / layer.width), run.before)
      }
      return recorded.length
    },
  }
}

/**
 * Undo a committed stroke: write every run's `before` back, in reverse
 * paint order. Mutates the layer in place via setCell (so the render
 * cache's dirty bookkeeping still happens) — the caller must then report
 * tilesTouched, exactly as history.ts does.
 */
export function undoRuns(layer: TileLayer, runs: ReadonlyArray<CellRun>): void {
  for (const run of [...runs].reverse()) {
    setCell(layer, run.index % layer.width, Math.floor(run.index / layer.width), run.before)
  }
}

/** Redo a committed stroke: write every run's `after`, in paint order.
 * The mirror of {@link undoRuns}; same in-place mutation contract. */
export function redoRuns(layer: TileLayer, runs: ReadonlyArray<CellRun>): void {
  for (const run of runs) {
    setCell(layer, run.index % layer.width, Math.floor(run.index / layer.width), run.after)
  }
}

/** Run list → event cell list: flat indices back to {tx, ty} via the taught
 * inverse (x = index % width, y = ⌊index / width⌋), order preserved. */
export function runsToCells(
  width: number,
  runs: ReadonlyArray<CellRun>,
): Array<{ tx: number; ty: number }> {
  return runs.map((run) => ({ tx: run.index % width, ty: Math.floor(run.index / width) }))
}
