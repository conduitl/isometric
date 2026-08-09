/**
 * The tile brush — one gesture, one history entry, no gaps.
 *
 * A brush drag is a conversation between two rates: the pointer reports at
 * whatever rate the browser feels like, but the STROKE is one intention —
 * so the bus's TileStroke coalesces every painted cell into one history
 * entry and one builder.tile-painted event (bus.ts owns that ceremony; this
 * tool only decides WHICH cells).
 *
 * The "which cells" question has a trap in it: a fast drag can jump many
 * cells between two pointer reports, and painting only the reported cells
 * would leave a dotted line. So every move paints the whole SEGMENT from
 * the previous cell to the current one, by integer line interpolation (the
 * derivation lives on paintSegment below — it is the taught
 * index = y·width + x formula's walking cousin: both are about moving
 * through a grid in whole-cell steps).
 *
 * Leaving the active layer mid-drag does NOT end the stroke: stroke.paint
 * already ignores out-of-bounds cells, so the gesture stays alive and
 * re-entering the layer keeps painting — one gesture, one entry, even when
 * the pointer takes a scenic detour off the map.
 *
 * Keyboard parity is a shape guarantee, not a convenience: Enter at the
 * cell cursor runs a one-cell stroke (begin → paint → end), so mouse and
 * keyboard leave IDENTICAL histories and identical events — a lesson can
 * never tell which input device a student used, and a screen-reader user's
 * undo stack reads exactly like everyone else's.
 */

import { Vec2 } from '@engine/math'
import { worldToTile } from '@engine/tilemap'
import type { TileLayer } from '@engine/core'
import type {
  EditorSession,
  EditorTool,
  EditorToolPlugin,
  TileStroke,
  ToolPointerEvent,
} from '../types'

/** Build the tile brush around a session. Exported (alongside the plugin)
 * so tests can hold the instance and drive its handlers directly. */
export function createBrushTool(session: EditorSession): EditorTool {
  /** The live stroke, between a primary down and ANY up. */
  let stroke: TileStroke | null = null
  /** The last cell the stroke visited — the segment-paint's start point.
   * May be out of the layer's bounds (an off-map detour); kept anyway so
   * the line stays continuous when the pointer comes back. */
  let lastCell: { readonly tx: number; readonly ty: number } | null = null

  const activeLayer = (): TileLayer | null => {
    const id = session.store.getState().activeLayerId
    return session.doc.layers.find((layer) => layer.id === id) ?? null
  }

  /** Mirror the pointer's cell into the hover ghost — the "where will my
   * paint land?" answer, shown on the active layer's own storey. */
  const hoverAt = (e: ToolPointerEvent): void => {
    const layer = activeLayer()
    if (e.tile === null || layer === null) {
      session.hover(null)
      return
    }
    session.hover({ layerId: layer.id, tx: e.tile.tx, ty: e.tile.ty, elevation: layer.elevation })
  }

  /** The pointer's cell, in-bounds or not: the enriched `tile` when inside
   * the active layer, else the raw floor-division cell from the world point
   * (so off-map segments still interpolate; painting them is a no-op). */
  const cellAt = (e: ToolPointerEvent): { tx: number; ty: number } | null => {
    if (e.tile !== null) return e.tile
    if (e.world === null) return null
    return worldToTile(session.doc.settings, Vec2.make(e.world.x, e.world.y))
  }

  /**
   * Paint every cell along the segment from `from` to `to`, excluding
   * `from` (already painted when the pointer was there).
   *
   * The stepping, derived: take `steps = max(|dx|, |dy|)` — the number of
   * whole-cell moves along the LONGER axis. Walking i = 1..steps, the ideal
   * (fractional) position after i steps is (dx·i/steps, dy·i/steps) past
   * `from`; rounding each axis to the nearest integer gives the cell. Both
   * per-step increments |dx|/steps and |dy|/steps are ≤ 1, so consecutive
   * rounded cells differ by at most 1 on each axis — the line is gap-free
   * by construction, however fast the drag jumped. (Same spirit as
   * index = y·width + x: a grid is walked in integer steps, and the
   * arithmetic — not luck — guarantees you never skip a row.)
   */
  const paintSegment = (
    live: TileStroke,
    from: { readonly tx: number; readonly ty: number },
    to: { readonly tx: number; readonly ty: number },
  ): void => {
    const dx = to.tx - from.tx
    const dy = to.ty - from.ty
    const steps = Math.max(Math.abs(dx), Math.abs(dy))
    for (let i = 1; i <= steps; i += 1) {
      live.paint(from.tx + Math.round((dx * i) / steps), from.ty + Math.round((dy * i) / steps))
    }
    // steps === 0 → same cell as before: nothing new to paint.
  }

  return {
    id: 'brush',
    label: 'Tile brush',
    shortcut: 'b',

    onPointerDown(e: ToolPointerEvent): void {
      // A live stroke owns the gesture: a second concurrent pointer's down
      // is ignored rather than interleaved, mirroring onCursorAct — the bus
      // would rightly throw on a second beginTileStroke. (The viewport
      // filters second pointers too; this guard keeps the tool honest even
      // when driven directly.)
      if (stroke !== null) return
      // Primary button, on a paintable cell of the active layer, only.
      if (!e.primary || e.tile === null) return
      const snapshot = session.store.getState()
      if (snapshot.activeLayerId === null) return
      // activeTile 0 is the eraser — the stroke machinery treats it as just
      // another value to write, which is exactly what erasing is.
      const begun = session.bus.beginTileStroke(snapshot.activeLayerId, snapshot.activeTile)
      if (begun === null) return
      stroke = begun
      begun.paint(e.tile.tx, e.tile.ty)
      lastCell = e.tile
      hoverAt(e)
    },

    onPointerMove(e: ToolPointerEvent): void {
      // The hover ghost tracks EVERY move, stroke or no stroke.
      hoverAt(e)
      if (stroke === null) return
      const cell = cellAt(e)
      if (cell === null) return
      if (lastCell === null) stroke.paint(cell.tx, cell.ty)
      else paintSegment(stroke, lastCell, cell)
      lastCell = cell
    },

    onPointerUp(): void {
      // ANY up ends the gesture (lostpointercapture reports button −1, so
      // `primary` is not consulted). end() commits the coalesced entry —
      // or nothing, if the stroke changed nothing.
      if (stroke === null) return
      stroke.end()
      stroke = null
      lastCell = null
    },

    onCursorAct(tile: { readonly tx: number; readonly ty: number }): void {
      // A live mouse stroke owns the gesture; Enter mid-drag is ignored
      // rather than interleaved (the bus would rightly throw).
      if (stroke !== null) return
      const snapshot = session.store.getState()
      if (snapshot.activeLayerId === null) return
      // The one-cell stroke: begin → paint → end, so keyboard painting
      // leaves the IDENTICAL history entry and event shape as a click.
      const single = session.bus.beginTileStroke(snapshot.activeLayerId, snapshot.activeTile)
      if (single === null) return
      single.paint(tile.tx, tile.ty)
      single.end()
    },

    onCancel(): void {
      // Esc or a tool switch: every painted cell reverts, no history, no
      // event — the stroke never happened.
      if (stroke === null) return
      stroke.cancel()
      stroke = null
      lastCell = null
    },

    onSettle(): void {
      // save() is about to serialize: COMMIT the live stroke, exactly as a
      // pointerup would — one coalesced history entry, one tile-painted —
      // so the file never contains cells that no undo step can explain.
      if (stroke === null) return
      stroke.end()
      stroke = null
      lastCell = null
    },
  }
}

/** The tile brush as a plugin — the same shaped door a third-party tool
 * would come through (types.ts: EditorToolPlugin). */
export const brushToolPlugin: EditorToolPlugin = {
  name: 'tool-brush',
  version: '0.1.0',
  register(session: EditorSession): void {
    session.addTool(createBrushTool(session))
  },
}
