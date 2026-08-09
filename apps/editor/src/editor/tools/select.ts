/**
 * The selection tool — pick things, and drag entities through the preview
 * channel.
 *
 * Selection happens on pointerDOWN, not up: the thing under your finger is
 * selected the moment you touch it, and whatever happens next (a drag, a
 * plain release) happens TO the selected thing. That ordering is why a drag
 * needs no "select then drag" two-step — down selects and ARMS, and the drag
 * begins only when the pointer has traveled past a small threshold, so a
 * plain click with a shaky hand never accidentally nudges an entity.
 *
 * The drag itself is the preview protocol's first customer (preview.ts):
 * every pointer move updates the uncommitted override, and release commits
 * exactly one move-entity command. The world point under the pointer comes
 * from the inverse walk pinned to the DRAGGED ENTITY'S OWN elevation — not
 * the active layer's — because an entity standing on a plateau must slide
 * along its own storey; pinning it to the ground floor would teleport it
 * downhill the moment the drag began (picking.ts teaches the same
 * per-candidate pinning for clicks).
 *
 * Dropped positions SNAP to the cell center by default: a tile world reads
 * in cells — terrain, the cursor, the grid all speak in whole tiles — so
 * "put the crate on that tile" is the sentence a drag almost always means,
 * and centers are where tile-dwellers stand (tileToWorld's +0.5 lesson).
 * Holding shift opts out into free positioning for the rarer "exactly
 * there" intent.
 *
 * The keyboard has the same move, as a GRAB: Enter on the cell where the
 * currently-selected entity stands picks it up (the same preview drag a
 * pointer would open), the arrow keys carry it — onCursorMove slides the
 * ghost to each cell's center at the entity's own storey — and Enter again
 * drops it (one move-entity, one event, identical to a pointer drag's
 * commit). Esc cancels the carry. This is why lesson steps about moving
 * things are never pointer-only: grab/carry/drop is a full keyboard twin.
 */

import { entityIds } from '@engine/core'
import { Vec2 } from '@engine/math'
import type { WorldPoint } from '@engine/projection'
import { tileToWorld, worldToTile } from '@engine/tilemap'
import { entityWorldPoint, resolvePick, resolveTile } from '../picking'
import type {
  EditorSession,
  EditorTool,
  EditorToolPlugin,
  EntityDragPreview,
  PickedTile,
  ToolPointerEvent,
} from '../types'

/**
 * How far (CSS px) the pointer must travel from its down-point before an
 * armed entity press becomes a drag. Three pixels: under any real drag,
 * over any tremor a click produces on a trackpad.
 */
export const DRAG_THRESHOLD_PX = 3

/** Build the selection tool around a session. Exported (alongside the
 * plugin) so tests can hold the instance and drive its handlers directly. */
export function createSelectTool(session: EditorSession): EditorTool {
  /** A pointerdown landed on an entity: remember which, where the press
   * started on screen, and the entity's own storey (the drag's pinned z). */
  let armed: { readonly id: string; readonly startScreen: Vec2; readonly z: number } | null = null
  /** The live preview drag, once the threshold is crossed. */
  let drag: EntityDragPreview | null = null
  /** The live keyboard grab (Enter on the selected entity's cell): the same
   * preview-drag handle a pointer drag holds, plus the entity's own storey
   * so every carried cell center stays on ITS z-plane. */
  let grab: { readonly drag: EntityDragPreview; readonly z: number } | null = null

  const reset = (): void => {
    armed = null
    drag = null
    grab = null
  }

  /** The active layer's elevation — the storey keyboard picks default to. */
  const activeElevation = (): number => {
    const id = session.store.getState().activeLayerId
    return session.doc.layers.find((layer) => layer.id === id)?.elevation ?? 0
  }

  return {
    id: 'select',
    label: 'Select',
    shortcut: 'v',

    onPointerDown(e: ToolPointerEvent): void {
      // Only the primary button selects; secondary buttons stay free for
      // future camera/menu gestures.
      if (!e.primary) return
      // A live gesture owns the tool: a second concurrent pointer's down
      // (or a click landing mid keyboard-carry) is ignored, never allowed
      // to cancel-and-restart the gesture out from under the first input.
      // The viewport filters second pointers too; this guard keeps the
      // tool honest even when driven directly.
      if (drag !== null || grab !== null) return
      reset()

      const pick = resolvePick(session.doc, session.stack, e.screen)
      if (pick === null) {
        session.select(null)
        return
      }
      session.select(pick)
      if (pick.kind === 'entity') {
        // Arm a POTENTIAL drag — it becomes real only past the threshold.
        armed = { id: pick.id, startScreen: e.screen, z: pick.point.z }
      }
    },

    onPointerMove(e: ToolPointerEvent): void {
      if (armed === null) return

      if (drag === null) {
        const dx = e.screen.x - armed.startScreen.x
        const dy = e.screen.y - armed.startScreen.y
        if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return
        drag = session.preview.beginEntityDrag(armed.id)
        if (drag === null) {
          // The entity vanished, or another preview owns the channel:
          // disarm rather than retrying on every subsequent move.
          armed = null
          return
        }
      }

      // The inverse walk, pinned to the dragged entity's own storey — its
      // screen position only maps back to its world position on ITS z-plane.
      const world = session.stack.screenToWorld(e.screen, { kind: 'elevation', z: armed.z })
      if (world === null) return

      let point: WorldPoint
      if (e.shiftKey) {
        // Free positioning: exactly where the pointer says.
        point = { x: world.x, y: world.y, z: armed.z }
      } else {
        // Default: snap to the landing cell's center (see the file header
        // for why snapping is the default in a tile world).
        const cell = worldToTile(session.doc.settings, Vec2.make(world.x, world.y))
        const center = tileToWorld(session.doc.settings, cell.tx, cell.ty)
        point = { x: center.x, y: center.y, z: armed.z }
      }
      drag.update(point)
    },

    onPointerUp(): void {
      // ANY up ends the gesture — lostpointercapture reports button −1, so
      // `primary` may be false here and must not be consulted. Commit if a
      // drag is live; a sub-threshold press needs nothing (selection already
      // happened on down).
      if (drag !== null) drag.commit()
      reset()
    },

    onCursorAct(tile: { readonly tx: number; readonly ty: number }): void {
      const doc = session.doc

      // 0a) DROP: a live keyboard grab ends here — the carry commits as
      // exactly one move-entity (one history entry, one entity-moved; the
      // commit's own announcement suffices, so nothing extra is said).
      if (grab !== null) {
        const live = grab
        grab = null
        live.drag.commit()
        return
      }

      // 0b) GRAB: Enter on the cell the CURRENTLY SELECTED entity stands on
      // picks it up instead of re-selecting it — the keyboard twin of
      // press-and-drag. Any other cell falls through to the pick ladder, so
      // acting on a NON-selected entity's cell still selects it first.
      const selected = session.store.getState().selection
      if (selected?.kind === 'entity') {
        const entity = doc.entities[selected.id]
        const point = entity === undefined ? null : entityWorldPoint(entity)
        if (point !== null) {
          const cell = worldToTile(doc.settings, Vec2.make(point.x, point.y))
          if (cell.tx === tile.tx && cell.ty === tile.ty) {
            const begun = session.preview.beginEntityDrag(selected.id)
            // null = the entity vanished or another preview owns the
            // channel; fall through to the ladder rather than going silent.
            if (begun !== null) {
              grab = { drag: begun, z: point.z }
              return
            }
          }
        }
      }

      // 1) An entity standing in the cell wins — walked in THE deterministic
      // id order, so two entities sharing a cell always resolve the same way.
      for (const id of entityIds(doc)) {
        const entity = doc.entities[id]
        if (entity === undefined) continue
        const point = entityWorldPoint(entity)
        if (point === null) continue
        const cell = worldToTile(doc.settings, Vec2.make(point.x, point.y))
        if (cell.tx === tile.tx && cell.ty === tile.ty) {
          session.select({ kind: 'entity', id, point })
          return
        }
      }

      // 2) Else: what a click at this cell's center would pick — the same
      // resolveTile walk the mouse takes, entered at the projected center.
      const elevation = activeElevation()
      const center = tileToWorld(doc.settings, tile.tx, tile.ty)
      const screen = session.stack.worldToScreen({ x: center.x, y: center.y, z: elevation })
      const picked = resolveTile(doc, session.stack, screen)
      if (picked !== null) {
        session.select({ kind: 'tile', tile: picked })
        return
      }

      // 3) The honest fallback (an uninvertible camera): the bare cell
      // itself, claimed by no layer.
      const bare: PickedTile = { layerId: null, tx: tile.tx, ty: tile.ty, elevation }
      session.select({ kind: 'tile', tile: bare })
    },

    onCursorMove(tile: { readonly tx: number; readonly ty: number }): void {
      // CARRY: while a grab is live, the ghost rides the cursor, standing
      // on each visited cell's CENTER (the +0.5 lesson) at the entity's own
      // storey. No grab, no opinion — plain cursor movement is not ours.
      if (grab === null) return
      const center = tileToWorld(session.doc.settings, tile.tx, tile.ty)
      grab.drag.update({ x: center.x, y: center.y, z: grab.z })
    },

    onCancel(): void {
      // Esc or a tool switch: the drag (pointer or keyboard) never happened
      // — no history, no event.
      if (drag !== null) drag.cancel()
      if (grab !== null) grab.drag.cancel()
      reset()
    },

    onSettle(): void {
      // save() is about to serialize: COMMIT the live gesture instead —
      // the ghost's position becomes one real move-entity, exactly as the
      // drop/release would have made it (at most one of drag/grab is live;
      // the preview channel allows a single drag at a time).
      if (drag !== null) drag.commit()
      if (grab !== null) grab.drag.commit()
      reset()
    },
  }
}

/** The selection tool as a plugin — the same shaped door a third-party tool
 * would come through (types.ts: EditorToolPlugin). */
export const selectToolPlugin: EditorToolPlugin = {
  name: 'tool-select',
  version: '0.1.0',
  register(session: EditorSession): void {
    session.addTool(createSelectTool(session))
  },
}
