/**
 * The transient-edit preview channel — uncommitted drags, as a named protocol.
 *
 * A drag-move is two different things at two different moments, and this
 * module is the seam between them. WHILE the pointer is down, the entity's
 * new position is an OPINION — rendered immediately so the drag feels alive,
 * but absent from history, the store, and the event stream, because the
 * student hasn't decided yet. WHEN the pointer releases, the whole gesture
 * collapses into exactly ONE move-entity command from start to end — one
 * history entry, one builder.entity-moved, one undo step. Esc collapses it
 * into nothing at all.
 *
 * That shape (live override → one command or zero) is ARCHITECTURE §6's
 * transient-edit protocol, specified before any tool existed on purpose:
 * Phase 4's dual-representation binding — drag the arrow and the number
 * changes, edit the number and the arrow moves — rides THIS channel, not a
 * private hack inside the select tool. Which is why the channel lives here,
 * named, instead of inside tools/select.ts where its only Phase 2 caller is.
 *
 * The override is the renderer's half of the deal: while a drag is live,
 * {@link PreviewChannel.entityOverride} says "draw THIS entity THERE instead
 * of at its committed components" (render.ts honors it, depth key and all).
 * One drag at a time, by contract — a second pointer asking to drag gets
 * null and is ignored, because two simultaneous opinions about where things
 * are is how documents get corrupted.
 */

import type { EntityId, World } from '@engine/core'
import { getEntity } from '@engine/core'
import type { WorldPoint } from '@engine/projection'
import { entityWorldPoint } from './picking'
import type {
  DispatchResult,
  EditorCommand,
  EntityDragPreview,
  MoveEntityCommand,
  PreviewChannel,
} from './types'

/** What the channel needs from the session — the live document (the drag's
 * start point is read from it), the one undoable door (commit dispatches
 * through it), and a repaint request (the ghost must move this frame). */
export interface PreviewChannelDeps {
  getDoc(): World
  dispatch(command: EditorCommand): DispatchResult
  requestRender(): void
}

/**
 * The channel as the SESSION sees it: the public {@link PreviewChannel}
 * contract plus one internal door, `clear()`. Deliberately not on the
 * contract type — tools and panels retire a drag through the handle they
 * hold (commit/cancel); only the session, sweeping up before loadWorld or
 * on Esc, may wipe an override whose owner the ACTIVE tool cannot reach
 * (a drag begun by a panel, or by a tool that has since been switched away).
 */
export interface SessionPreviewChannel extends PreviewChannel {
  /** Drop any live override without committing — as if the drag were
   * cancelled by its owner. Outstanding handles go inert (their retired-
   * handle guard already covers a stale commit/cancel/update). */
  clear(): void
}

/** Build the session's one preview channel. */
export function createPreviewChannel(deps: PreviewChannelDeps): SessionPreviewChannel {
  /** The live drag, or null. `start` is the committed position the gesture
   * began from (undo's target, commit's comparison point); `point` is where
   * the ghost currently draws. */
  let live: { readonly id: EntityId; readonly start: WorldPoint; point: WorldPoint } | null = null

  return {
    get entityOverride() {
      return live === null ? null : { id: live.id, point: live.point }
    },

    clear(): void {
      // The session's sweep (loadWorld, cancelGesture): the override dies
      // uncommitted, and the next frame draws committed truth. The handle
      // that owned this drag still exists somewhere — its `live !== state`
      // guard makes every later call on it a quiet no-op.
      if (live === null) return
      live = null
      deps.requestRender()
    },

    beginEntityDrag(id: EntityId): EntityDragPreview | null {
      // One preview at a time: a second pointer (or a re-entrant begin) is
      // ignored, not queued — the first gesture owns the channel until it
      // commits or cancels.
      if (live !== null) return null

      // The start point comes from the document, not the caller: an entity
      // that does not exist — or has no readable position — has no committed
      // state to drag FROM, so there is no drag to begin.
      const entity = getEntity(deps.getDoc(), id)
      if (entity === undefined) return null
      const start = entityWorldPoint(entity)
      if (start === null) return null

      const state = { id, start, point: start }
      live = state

      // Retire this handle: clear the override and repaint so the entity
      // snaps to wherever the document says it is. Called by both commit and
      // cancel — the override clears EITHER way (the contract in types.ts).
      const finish = (): void => {
        live = null
        deps.requestRender()
      }

      // A retired handle (already committed or cancelled) goes quiet instead
      // of throwing: `live !== state` also covers a handle kept around after
      // a NEW drag began. A stray Esc after release is a user conversation,
      // not a programmer error.
      return {
        update(point: WorldPoint): void {
          if (live !== state) return
          state.point = point
          // Renders this frame; touches no history, no store, no events —
          // an opinion, not a decision.
          deps.requestRender()
        },

        commit(): void {
          if (live !== state) return
          const { start, point } = state
          // Clear the override BEFORE dispatching: the dispatch's event
          // listeners refresh the snapshot and schedule a repaint, and that
          // frame must draw the committed truth, never a leftover ghost.
          finish()
          // A drag that ends where it began decided nothing: no command, no
          // history entry, no event (the vocabulary's convention 2 — and an
          // undo that "moves" an entity zero distance would read as broken).
          if (point.x === start.x && point.y === start.y && point.z === start.z) return
          // Exactly ONE command from the gesture's start/end state. The
          // storey rides along only when the drag actually changed it.
          const command: MoveEntityCommand =
            point.z === start.z
              ? { kind: 'move-entity', id: state.id, to: { x: point.x, y: point.y } }
              : { kind: 'move-entity', id: state.id, to: { x: point.x, y: point.y }, toElevation: point.z }
          deps.dispatch(command)
        },

        cancel(): void {
          if (live !== state) return
          // Esc: as far as history, events, and the store are concerned,
          // nothing ever happened. The repaint inside finish() snaps the
          // entity back to its committed position.
          finish()
        },
      }
    },
  }
}
