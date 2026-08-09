/*
 * The command bus — the one undoable door into the document.
 *
 * Everything that changes the world document passes through here, in
 * exactly two shapes (types.ts): a dispatched {@link EditorCommand}, or a
 * {@link TileStroke} gesture. The bus is the choreographer, not the brain —
 * entity-commands.ts decides WHAT a command does, tile-stroke.ts records
 * WHAT a stroke changed, history.ts remembers HOW to run it backwards. The
 * bus sequences the ceremony around them, always in the same order:
 * document first (replaceDoc / tilesTouched), history second, event last —
 * so an event listener that inspects the document always sees the state
 * the event describes.
 *
 * The bus stays deliberately ignorant of rendering, storage, and React: it
 * talks to a {@link DocumentHost} (the session's document seat) and an
 * `emit` function (the builder.* boundary emitter). That narrowness is what
 * makes the 500-command fuzz-vs-replay-oracle gate meaningful — a test can
 * host the bus with a plain object and replay its whole life.
 *
 * ## Stroke atomicity
 *
 * While a stroke is open, dispatch / undo / redo / beginTileStroke /
 * clearHistory THROW. A gesture is atomic by definition — half a brush
 * stroke interleaved with an undo would leave history describing a document
 * that never existed. The tools guarantee they never interleave (Esc
 * cancels before anything else runs), so hitting this throw is a programmer
 * error worth crashing loudly on, not a user state worth soft-answering.
 *
 * ## Outcome → ceremony mapping (the quiet contracts)
 *
 * - rejection: {ok:false}; document, history, and events untouched.
 * - no-op: {ok:true, label} but NO history entry and NO event — undo must
 *   never appear to do nothing, and lessons never gate on non-changes.
 * - a stroke that changed zero cells commits nothing at all; a cancelled
 *   stroke reverts its cells and commits nothing (cancelled gestures emit
 *   nothing — the event vocabulary's convention 2).
 */

import type { BuilderEvent } from '../events/builder'
import type { CommandBus, DispatchResult, DocumentHost, EditorCommand, TileStroke } from '../types'
import { executeCommand } from './entity-commands'
import { createHistory } from './history'
import { createStrokeRecorder, runsToCells } from './tile-stroke'
import './immer-setup'

/**
 * Wire a bus to its document seat and event emitter. One bus per session,
 * for the session's whole life — loading a world clears the HISTORY (via
 * clearHistory), never the bus.
 */
export function createCommandBus(opts: {
  host: DocumentHost
  emit: (event: BuilderEvent) => void
}): CommandBus {
  const { host, emit } = opts
  const history = createHistory()
  let strokeOpen = false

  const assertNoOpenStroke = (what: string): void => {
    if (strokeOpen) {
      throw new Error(
        `${what} while a tile stroke is open — a gesture is atomic; ` +
          'end() or cancel() the stroke first (programmer error)',
      )
    }
  }

  const applyHistory = (direction: 'undo' | 'redo'): string | null => {
    assertNoOpenStroke(direction)
    const applied = direction === 'undo' ? history.undo(host.doc) : history.redo(host.doc)
    if (applied === null) return null
    // Same ceremony order as dispatch: document, then the event about it.
    if (applied.kind === 'patches') host.replaceDoc(applied.next)
    else host.tilesTouched(applied.layerId)
    emit(
      direction === 'undo'
        ? { type: 'builder.command-undone', label: applied.label }
        : { type: 'builder.command-redone', label: applied.label },
    )
    return applied.label
  }

  return {
    strokeOpen(): boolean {
      // The polite door to the atomicity latch: UI code that CAN reach
      // dispatch/undo/redo mid-gesture (toolbar buttons as much as keys)
      // asks here instead of learning about atomicity from the throw.
      return strokeOpen
    },

    dispatch(command: EditorCommand): DispatchResult {
      assertNoOpenStroke('dispatch')
      const outcome = executeCommand(host.doc, command)
      if (outcome.status === 'rejected') return { ok: false, reason: outcome.reason }
      if (outcome.status === 'noop') return { ok: true, label: outcome.label }
      host.replaceDoc(outcome.next)
      history.push({
        kind: 'patches',
        label: outcome.label,
        patches: outcome.patches,
        inversePatches: outcome.inversePatches,
      })
      emit(outcome.event)
      return { ok: true, label: outcome.label }
    },

    beginTileStroke(layerId: string, tile: number): TileStroke | null {
      assertNoOpenStroke('beginTileStroke')
      const layer = host.doc.layers.find((candidate) => candidate.id === layerId)
      if (layer === undefined) return null
      const recorder = createStrokeRecorder(layer, tile)
      strokeOpen = true
      return {
        paint(tx: number, ty: number): boolean {
          const changed = recorder.paint(tx, ty)
          // Real changes only: a no-op or out-of-bounds paint must not cost
          // the viewport a repaint.
          if (changed) host.tilesTouched(layerId)
          return changed
        },
        end(): void {
          const runs = recorder.end()
          strokeOpen = false
          if (runs.length === 0) return // a gesture that changed nothing commits nothing
          const count = runs.length
          const verb = tile === 0 ? 'erase' : 'paint'
          const label = `${verb} ${count} ${count === 1 ? 'tile' : 'tiles'}`
          history.push({ kind: 'stroke', label, layerId, runs })
          emit({
            type: 'builder.tile-painted',
            layerId,
            tile,
            cells: runsToCells(layer.width, runs),
            // Hardcoded this phase: the brush is the only painter (keyboard
            // Enter-to-paint routes through it too). When another paint tool
            // exists, the id must be threaded through beginTileStroke.
            toolId: 'brush',
          })
        },
        cancel(): void {
          const reverted = recorder.cancel()
          strokeOpen = false
          // Reverting cells is a real cell change the viewport must see —
          // but it pushes no history and emits no event (convention 2:
          // cancelled gestures never happened).
          if (reverted > 0) host.tilesTouched(layerId)
        },
      }
    },

    undo(): string | null {
      return applyHistory('undo')
    },
    redo(): string | null {
      return applyHistory('redo')
    },
    canUndo(): boolean {
      return history.canUndo()
    },
    canRedo(): boolean {
      return history.canRedo()
    },
    clearHistory(): void {
      assertNoOpenStroke('clearHistory')
      history.clear()
    },
  }
}
