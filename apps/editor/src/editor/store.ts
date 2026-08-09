/**
 * The store mirror — React's only window into the editor, plus the pure
 * builders that fill it.
 *
 * The store owns NOTHING (the contract in ./types says so): it is a zustand
 * vanilla store holding one {@link EditorSnapshot} that the session
 * overwrites after real changes — never per frame, never per pointer-move.
 * React subscribes to it and renders; the document itself stays on the other
 * side of the boundary.
 *
 * Everything else in this file is a PURE builder: doc in, plain mirrored
 * data out, no closures over anything. The session composes them when it
 * refreshes the snapshot; tests call them directly with a bare world. That
 * split — dumb store, pure derivations, session as the only writer — is what
 * makes "React never touches the document" checkable rather than aspirational.
 */

import type { World } from '@engine/core'
import { entityIds, getEntity } from '@engine/core'
import { getCell } from '@engine/tilemap'
import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import { entityWorldPoint, markerKind } from './picking'
import type { EditorSnapshot, PaletteTile, Selection, SelectionInfo } from './types'

/**
 * The marker kinds the entity placer offers this phase. A short, fixed list
 * on purpose: three recognizable things a first world plausibly wants, each
 * with its own marker color in the renderer. Custom markers arrive with
 * later tiers; the palette stays honest until then.
 */
export const MARKER_KINDS: ReadonlyArray<string> = ['player', 'crate', 'tree']

/** The eraser's swatch — the viewport background family, because erasing
 * paints "nothing" and the button should look like what it does. */
const ERASER: PaletteTile = { value: 0, name: 'eraser', color: '#232936' }

/**
 * The pre-boot snapshot: what the store holds between createEditorStore()
 * and the session's first real mirror. Deliberately minimal and honest — an
 * empty world nobody has saved is 'unsaved', the palette is just the eraser
 * slot's absence, and activeTile 1 pre-selects palette slot 1 (grass, once a
 * document arrives — the "obvious brush" of the starter contract).
 */
export const EMPTY_SNAPSHOT: EditorSnapshot = {
  worldName: '',
  layers: [],
  activeLayerId: null,
  activeToolId: 'select',
  palette: [ERASER],
  activeTile: 1,
  activeMarker: 'player',
  markers: MARKER_KINDS,
  selection: null,
  entities: [],
  canUndo: false,
  canRedo: false,
  lastAction: null,
  lastActionSeq: 0,
  persistence: { state: 'unsaved', message: null },
  lesson: null,
}

/** The one store the session writes and React reads. */
export function createEditorStore(): StoreApi<EditorSnapshot> {
  return createStore<EditorSnapshot>(() => EMPTY_SNAPSHOT)
}

/**
 * The palette, derived from the active layer's tileset: entry 0 is always
 * the eraser (cell value 0 — "nothing here"), then the tileset's tiles as
 * values 1..n, each showing its top color — the same off-by-one convention
 * the cell data itself uses, surfaced instead of hidden. No active layer, or
 * a dangling tileset reference? The eraser alone: an honest palette for a
 * document with nothing paintable.
 */
export function paletteFromDoc(doc: World, activeLayerId: string | null): PaletteTile[] {
  const palette: PaletteTile[] = [ERASER]
  const layer = doc.layers.find((candidate) => candidate.id === activeLayerId)
  if (layer === undefined) return palette
  const tileset = doc.tilesets.find((candidate) => candidate.id === layer.tilesetId)
  if (tileset === undefined) return palette
  tileset.tiles.forEach((tile, index) => {
    palette.push({ value: index + 1, name: tile.name, color: tile.colors.top })
  })
  return palette
}

/**
 * Enrich a raw {@link Selection} into the plain data the inspector shows.
 * An entity selection re-reads name/marker/position from the CURRENT
 * document (the selection may be older than the last rename or move); an
 * entity that no longer exists — or has no readable position — mirrors as
 * null, because a panel showing a ghost is worse than a panel showing
 * nothing. A tile selection resolves its display name through the claiming
 * layer's tileset; empty ground (layerId null, or an empty cell) has no
 * tile name, honestly.
 */
export function selectionInfoFromDoc(doc: World, selection: Selection): SelectionInfo {
  if (selection === null) return null

  if (selection.kind === 'entity') {
    const entity = getEntity(doc, selection.id)
    if (entity === undefined) return null
    const point = entityWorldPoint(entity)
    if (point === null) return null
    return {
      kind: 'entity',
      id: entity.id,
      name: entity.name,
      marker: markerKind(entity),
      position: { x: point.x, y: point.y },
      elevation: point.z,
    }
  }

  const tile = selection.tile
  let tileName: string | null = null
  const layer = tile.layerId === null ? undefined : doc.layers.find((candidate) => candidate.id === tile.layerId)
  if (layer !== undefined) {
    const value = getCell(layer, tile.tx, tile.ty)
    if (value > 0) {
      const tileset = doc.tilesets.find((candidate) => candidate.id === layer.tilesetId)
      tileName = tileset?.tiles[value - 1]?.name ?? null
    }
  }
  return { kind: 'tile', tile, tileName }
}

/**
 * The world panel's entity list, in entityIds() order — THE deterministic
 * order every walk of the spreadsheet shares (@engine/core world.ts). The
 * panel showing the same order as iteration, serialization, and picking is
 * a small piece of the glass box: there is one order, and you are looking
 * at it.
 */
export function entitiesFromDoc(
  doc: World,
): Array<{ id: string; name: string; marker: string | null }> {
  const rows: Array<{ id: string; name: string; marker: string | null }> = []
  for (const id of entityIds(doc)) {
    const entity = doc.entities[id]
    if (entity === undefined) continue
    rows.push({ id, name: entity.name, marker: markerKind(entity) })
  }
  return rows
}
