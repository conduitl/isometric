/**
 * The entity placer — click a cell, get a marker standing on its center.
 *
 * Placement is one dispatched place-entity command per click (no gesture,
 * no preview): the document's own counter mints the id, the command carries
 * the marker kind from the palette (snapshot.activeMarker), and the new
 * entity lands at the clicked cell's CENTER — tileToWorld's (+0.5)·tileSize
 * lesson made into a habit: tile (tx, ty) owns the square from tx to tx+1,
 * so the spot that LOOKS centered is half a tile in, and entities placed by
 * cell should stand there, not on the corner where four tiles meet. Shift
 * opts out into free placement at the exact world point under the pointer.
 *
 * The elevation is the active layer's: you place onto the storey you are
 * editing, which is also the storey the hover ghost shows.
 *
 * After a successful placement the new entity becomes the selection, so the
 * inspector immediately shows what was just made. Its id is predicted by
 * reading doc.nextEntityId BEFORE dispatching (chosen over fishing the id
 * out of the event): entity-commands.ts pins "ids are minted from the BASE
 * document" as an invariant — `e${nextEntityId}` is exact, synchronous, and
 * needs no event-listener plumbing for a value we can already know.
 */

import { tileToWorld } from '@engine/tilemap'
import type { TileLayer } from '@engine/core'
import type { EditorSession, EditorTool, EditorToolPlugin, ToolPointerEvent } from '../types'

/** Build the entity placer around a session. Exported (alongside the
 * plugin) so tests can hold the instance and drive its handlers directly. */
export function createPlacerTool(session: EditorSession): EditorTool {
  const activeLayer = (): TileLayer | null => {
    const id = session.store.getState().activeLayerId
    return session.doc.layers.find((layer) => layer.id === id) ?? null
  }

  /** The hover ghost: the cell a click would place onto, on the active
   * layer's own storey. */
  const hoverAt = (e: ToolPointerEvent): void => {
    const layer = activeLayer()
    if (e.tile === null || layer === null) {
      session.hover(null)
      return
    }
    session.hover({ layerId: layer.id, tx: e.tile.tx, ty: e.tile.ty, elevation: layer.elevation })
  }

  /** Dispatch one place-entity at a world position and select the result. */
  const place = (position: { readonly x: number; readonly y: number }): void => {
    const marker = session.store.getState().activeMarker
    const elevation = activeLayer()?.elevation ?? 0
    // The id the document is about to mint, read from the base document
    // before dispatch — see the file header for why this beats listening.
    const id = `e${session.doc.nextEntityId}`
    const outcome = session.bus.dispatch({ kind: 'place-entity', marker, position: { x: position.x, y: position.y }, elevation })
    if (!outcome.ok) return
    session.select({ kind: 'entity', id, point: { x: position.x, y: position.y, z: elevation } })
  }

  return {
    id: 'placer',
    label: 'Entity placer',
    shortcut: 'e',

    onPointerDown(e: ToolPointerEvent): void {
      // No double-down guard needed here (unlike brush/select): placement
      // is atomic on down — there is no live gesture a second concurrent
      // pointer could corrupt, and the viewport ignores second pointers
      // anyway, so a stray extra down cannot even double-place.
      // Primary click on a cell of the active layer; a click outside the
      // layer's bounds places nothing (the refusal began in pointerToCell).
      if (!e.primary || e.tile === null) return
      if (e.shiftKey && e.world !== null) {
        // Shift: free placement at the exact world point under the pointer.
        place({ x: e.world.x, y: e.world.y })
        return
      }
      const center = tileToWorld(session.doc.settings, e.tile.tx, e.tile.ty)
      place({ x: center.x, y: center.y })
    },

    onPointerMove(e: ToolPointerEvent): void {
      hoverAt(e)
    },

    onPointerUp(): void {
      // Placement happened on down; there is no gesture to end.
    },

    onCursorAct(tile: { readonly tx: number; readonly ty: number }): void {
      // The keyboard twin of a click: the same placement at the cell center.
      const center = tileToWorld(session.doc.settings, tile.tx, tile.ty)
      place({ x: center.x, y: center.y })
    },

    onCancel(): void {
      // No live gesture state to abandon — placement is atomic on down.
    },
  }
}

/** The entity placer as a plugin — the same shaped door a third-party tool
 * would come through (types.ts: EditorToolPlugin). */
export const placerToolPlugin: EditorToolPlugin = {
  name: 'tool-placer',
  version: '0.1.0',
  register(session: EditorSession): void {
    session.addTool(createPlacerTool(session))
  },
}
