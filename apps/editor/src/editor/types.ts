/**
 * The editor's seam contracts — LOCKED before any implementation exists.
 *
 * This file is the Phase 2 equivalent of a signed blueprint: every module in
 * src/editor/ implements exactly these interfaces, and the React shell in
 * src/ui/ consumes ONLY what they expose. The red team's highest-value
 * Phase 2 demand was that the undo substrate and the transient-edit protocol
 * be specified before any tool code exists (docs/ARCHITECTURE.md §6) — this
 * file is that specification, in the codebase where it cannot drift from
 * the code.
 *
 * ## The one-way flow
 *
 *     pointer/keyboard ─▶ tool ─▶ CommandBus ─▶ document ─▶ store snapshot ─▶ React
 *                          │                        ▲
 *                          └──── PreviewChannel ────┘   (uncommitted drags bypass undo)
 *
 * React never touches the document. It renders the throttled
 * {@link EditorSnapshot} and calls named methods on the {@link EditorSession}.
 * The document changes through exactly two doors: a dispatched
 * {@link EditorCommand} (undoable, event-emitting) or a {@link TileStroke}
 * (the brush's coalesced, undoable gesture). Everything else — hover,
 * cursor, drag previews — is transient state that never enters history.
 *
 * ## The split undo substrate (ARCHITECTURE §6, verbatim)
 *
 * - Entity- and settings-scale edits execute via Immer `produceWithPatches`
 *   against the id-keyed world document. History stores forward/inverse
 *   patch pairs; id-keyed paths (`entities.e42.name`) survive interleaved
 *   create/delete/undo.
 * - Tile-raster edits live OUTSIDE Immer: a brush stroke coalesces into one
 *   history entry storing affected cell runs (index, before, after). Undo
 *   memory stays proportional to commands, not brush pixels, and the
 *   paint-feel hot path never pays Immer's large-array worst case.
 *
 * Immer setup consequence, documented here because it is a contract, not a
 * preference: the app calls `enablePatches()` once, and `setAutoFreeze(false)`
 * — the world document deliberately shares its `layers` array (and each
 * layer's Uint16Array cells, which cannot be frozen at all) across produced
 * states, so tile mutation + cache invalidation keep working while entity
 * edits enjoy structural sharing.
 *
 * ## Who owns what
 *
 * - {@link EditorSession} owns the document, the bus, the tools, the canvas.
 * - {@link CommandBus} owns history and emits the builder.* events for
 *   everything that goes through it.
 * - The store (zustand vanilla, see {@link EditorSnapshot}) owns nothing:
 *   it is a MIRROR the session updates after every change, throttled by
 *   construction because only real changes write it — never per frame,
 *   never per pointer-move.
 * - Pointer-rate values (cursor readout, hover) ride the {@link FastChannel}
 *   straight to imperative DOM writes, bypassing React entirely
 *   (ARCHITECTURE §6: "linked numeric displays at rAF rate outside React's
 *   throttled store").
 */

import type { EntityId, World } from '@engine/core'
import type { Vec2 } from '@engine/math'
import type { TransformStack, WorldPoint } from '@engine/projection'
import type { LensOverlaySpec, TutorialUiState, ViewProjectionName } from '@engine/tutorial'
import type { StoreApi } from 'zustand/vanilla'
import type { AnchorId } from './anchors'
import type { BuilderEvent } from './events/builder'

// ---------------------------------------------------------------------------
// Picking shapes (shared vocabulary with the Phase 1 demo, editor-owned copy)
// ---------------------------------------------------------------------------

/** One picked cell: grid position, the elevation to draw it at, and which
 * layer claimed it (null = empty ground outside any layer's contents). */
export interface PickedTile {
  readonly layerId: string | null
  readonly tx: number
  readonly ty: number
  readonly elevation: number
}

/** What a click resolved to: a specific entity, or a specific cell. */
export type PickResult =
  | { readonly kind: 'entity'; readonly id: EntityId; readonly point: WorldPoint }
  | { readonly kind: 'tile'; readonly tile: PickedTile }

/** The selection every panel mirrors. Null = nothing selected. */
export type Selection = PickResult | null

// ---------------------------------------------------------------------------
// Commands — the only undoable door into the document
// ---------------------------------------------------------------------------

/**
 * Everything that can change the world document, as data. A command is a
 * REQUEST — the bus validates it against the current document and answers
 * with a {@link DispatchResult} instead of throwing (a stale panel asking to
 * move a deleted entity is an expected conversation, not a crash).
 *
 * Tile painting is deliberately NOT in this union: strokes go through
 * {@link CommandBus.beginTileStroke} so a drag can paint live, cell by cell,
 * and still coalesce into ONE history entry and ONE builder.tile-painted
 * event (gesture-level granularity — ARCHITECTURE §8).
 */
export type EditorCommand =
  | PlaceEntityCommand
  | MoveEntityCommand
  | RenameEntityCommand
  | DeleteEntityCommand
  | RenameWorldCommand

/** Spawn a marker entity at a world position. The id is minted by the
 * document's own counter (never chosen by the caller — D2). */
export interface PlaceEntityCommand {
  readonly kind: 'place-entity'
  /** marker.kind — 'player', 'crate', 'tree', … (palette-supplied). */
  readonly marker: string
  /** Display name; defaults to the marker kind. */
  readonly name?: string
  readonly position: { readonly x: number; readonly y: number }
  readonly elevation: number
}

/** Move an entity to a new ground position (and optionally a new storey).
 * One command per completed gesture — a drag commits exactly one of these
 * from its start/end state (see {@link PreviewChannel}). */
export interface MoveEntityCommand {
  readonly kind: 'move-entity'
  readonly id: EntityId
  readonly to: { readonly x: number; readonly y: number }
  readonly toElevation?: number
}

export interface RenameEntityCommand {
  readonly kind: 'rename-entity'
  readonly id: EntityId
  readonly name: string
}

export interface DeleteEntityCommand {
  readonly kind: 'delete-entity'
  readonly id: EntityId
}

/** Rename the world (meta.name) — the settings-scale edit of the Builder tier. */
export interface RenameWorldCommand {
  readonly kind: 'rename-world'
  readonly name: string
}

/** What dispatch answered. `label` is the human history label ("place crate",
 * "move e7") — the same string undo/redo announce. */
export type DispatchResult =
  | { readonly ok: true; readonly label: string }
  | { readonly ok: false; readonly reason: string }

/**
 * One live brush gesture. `paint` applies immediately (the cell changes on
 * screen this frame); `end` commits the whole gesture as ONE history entry
 * and ONE builder.tile-painted event; `cancel` reverts every cell painted in
 * this stroke and leaves no trace in history. A stroke that changed nothing
 * commits nothing. The keyboard's Enter-to-paint is a one-cell stroke —
 * begin, paint, end — so mouse and keyboard leave identical histories.
 */
export interface TileStroke {
  /** Paint one cell with the stroke's tile value. Returns true if the cell
   * actually changed (painting grass on grass is a no-op). Out-of-bounds
   * cells are ignored and return false. */
  paint(tx: number, ty: number): boolean
  end(): void
  cancel(): void
}

/**
 * The command bus: dispatch, stroke, history. One bus per session; every
 * mutation of the document goes through it, which is what makes the 500-
 * command fuzz-vs-replay-oracle gate (ROADMAP Phase 2) meaningful.
 */
export interface CommandBus {
  dispatch(command: EditorCommand): DispatchResult
  /** True while a tile stroke is open. Every UI door that can reach
   * dispatch/undo/redo (buttons as much as keyboard) must check this or
   * catch — a gesture is atomic, and the bus THROWS to enforce it. */
  strokeOpen(): boolean
  /** Begin a coalesced paint gesture on a layer with a tile value (0 = the
   * eraser). Returns null when the layer does not exist. While a stroke is
   * open, dispatch/undo/redo throw — a gesture is atomic by definition, and
   * the tools guarantee they never interleave one with anything else. */
  beginTileStroke(layerId: string, tile: number): TileStroke | null
  /** Undo/redo the newest/most-recently-undone entry. Returns its label, or
   * null when the stack is empty. Emits builder.command-undone/redone. */
  undo(): string | null
  redo(): string | null
  canUndo(): boolean
  canRedo(): boolean
  /** History is session-scoped (never persisted — ARCHITECTURE §6); loading
   * or importing a world clears it. */
  clearHistory(): void
}

/**
 * The document seat the bus writes into. The session implements this; the
 * bus stays ignorant of rendering, storage, and React.
 *
 * `replaceDoc` swaps the document OBJECT (entity/settings commands and their
 * undo/redo — Immer structural sharing keeps untouched branches, including
 * `layers` and every Uint16Array, reference-identical). `tilesTouched`
 * reports in-place cell mutation (strokes and their undo/redo) so the
 * viewport can mark itself dirty without a document swap.
 */
export interface DocumentHost {
  readonly doc: World
  replaceDoc(next: World): void
  tilesTouched(layerId: string): void
}

// ---------------------------------------------------------------------------
// The transient-edit preview protocol (specified before any tool code exists)
// ---------------------------------------------------------------------------

/**
 * Uncommitted edits: a drag writes HERE — rendered immediately, bypassing
 * undo — and pointer-release commits exactly one command built from the
 * gesture's start/end state; Esc discards (ARCHITECTURE §6). Phase 2 has one
 * preview kind (entity drag-move); Phase 4's dual-representation binding
 * reuses this same channel for numeric fields, which is why it is a named
 * protocol and not a private hack inside the select tool.
 */
export interface PreviewChannel {
  /** Begin dragging an entity. Null if the entity does not exist or a drag
   * is already live (one preview at a time — a second pointer is ignored). */
  beginEntityDrag(id: EntityId): EntityDragPreview | null
  /** The override the renderer honors: draw this entity at this point
   * instead of its committed components. Null when no drag is live. */
  readonly entityOverride: { readonly id: EntityId; readonly point: WorldPoint } | null
}

export interface EntityDragPreview {
  /** Move the ghost. Renders this frame; touches no history, no store. */
  update(point: WorldPoint): void
  /** Commit ONE move-entity command from start→end (a drag that ends where
   * it began commits nothing). The override clears either way. */
  commit(): void
  /** Esc: the entity snaps back; nothing happened as far as history,
   * events, or the store are concerned. */
  cancel(): void
}

// ---------------------------------------------------------------------------
// Tools — plugins through the same shaped door as engine plugins
// ---------------------------------------------------------------------------

export type ToolId = 'select' | 'brush' | 'placer'

/**
 * A tool plugin: the `{name, version, register}` handshake of
 * @engine/core's EnginePlugin, aimed at the session. register() calls
 * {@link EditorSession.addTool} with the tool's behavior — the same door a
 * third-party tool would use, so the door stays honest.
 */
export interface EditorToolPlugin {
  readonly name: string
  readonly version: string
  register(session: EditorSession): void
}

/**
 * A tool's behavior. The session routes viewport input here — already
 * translated out of screen space, because every tool thinks in world/tile
 * coordinates (the editor dogfoods the inverse walk on every event).
 */
export interface EditorTool {
  readonly id: ToolId
  /** Human name for the toolbar ("Select", "Tile brush", "Entity placer"). */
  readonly label: string
  /** Single-key shortcut, lowercase ('v', 'b', 'e') — shell-registered. */
  readonly shortcut: string
  onPointerDown(e: ToolPointerEvent): void
  onPointerMove(e: ToolPointerEvent): void
  onPointerUp(e: ToolPointerEvent): void
  /** Enter/Space pressed with the keyboard cell cursor at `tile` — the
   * keyboard twin of a click at that cell's center. */
  onCursorAct(tile: { readonly tx: number; readonly ty: number }): void
  /** The keyboard cell cursor MOVED to `tile` (arrow keys). Optional: the
   * select tool uses it to carry a keyboard-grabbed entity with the cursor
   * (grab with Enter on the selected entity, carry with arrows, drop with
   * Enter, Esc cancels) — the keyboard twin of a pointer drag, and the
   * reason lesson steps about moving things are never pointer-only. */
  onCursorMove?(tile: { readonly tx: number; readonly ty: number }): void
  /** Esc, or the user switched tools mid-gesture: abandon any live stroke
   * or drag (cancel, never commit). */
  onCancel(): void
  /** Settle (COMMIT) any live gesture — the friendly sibling of onCancel,
   * called before save() serializes: a half-painted stroke becomes a normal
   * committed entry rather than silently entering the file or being thrown
   * away. Tools without a live gesture no-op. Optional: absent means the
   * session falls back to onCancel. */
  onSettle?(): void
}

/** One viewport pointer event, pre-walked through the active projection's
 * inverse. `world` pins the active layer's elevation (the ground constraint
 * of the current storey); `tile` is the cell under the pointer on the active
 * layer, or null outside its bounds. */
export interface ToolPointerEvent {
  readonly screen: Vec2
  readonly world: WorldPoint | null
  readonly tile: { readonly tx: number; readonly ty: number } | null
  /** True while the primary button is down (drag-paint reads this). */
  readonly primary: boolean
  readonly shiftKey: boolean
}

// ---------------------------------------------------------------------------
// The store mirror (React's only window) and the fast channel (React bypass)
// ---------------------------------------------------------------------------

/** One palette entry: the cell VALUE painted (1-based into the tileset;
 * 0 is the eraser) plus what the palette button shows. */
export interface PaletteTile {
  readonly value: number
  readonly name: string
  readonly color: string
}

/** What the inspector knows about the selection — plain mirrored data, so
 * React renders without touching the document. */
export type SelectionInfo =
  | {
      readonly kind: 'entity'
      readonly id: EntityId
      readonly name: string
      readonly marker: string | null
      readonly position: { readonly x: number; readonly y: number }
      readonly elevation: number
    }
  | { readonly kind: 'tile'; readonly tile: PickedTile; readonly tileName: string | null }
  | null

/** Save/load status for the status bar and announcements. */
export interface PersistenceState {
  /** 'saved' | 'unsaved' | 'error'; 'restored' = this document came from a
   * backup or rescue slot and the user should know. */
  readonly state: 'saved' | 'unsaved' | 'restored' | 'error'
  /** Student-language detail for 'restored'/'error'; null otherwise. */
  readonly message: string | null
}

/** The lesson rail renders @engine/tutorial's TutorialUiState from Phase 3
 * on — the Phase 2 draft harness and its LessonUiState are gone; the real
 * resumable step machine publishes into the snapshot's `tutorial` slice. */
export type { TutorialUiState } from '@engine/tutorial'

/**
 * The throttled snapshot React renders. Updated by the session after real
 * changes only — never per frame, never per pointer-move. Slow-changing by
 * construction; anything pointer-rate belongs on the {@link FastChannel}.
 */
export interface EditorSnapshot {
  readonly worldName: string
  readonly layers: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly activeLayerId: string | null
  readonly activeToolId: ToolId
  /** The palette, derived from the active layer's tileset. */
  readonly palette: ReadonlyArray<PaletteTile>
  /** The cell value the brush paints (0 = eraser). */
  readonly activeTile: number
  /** The marker kind the placer places ('player', 'crate', 'tree', …). */
  readonly activeMarker: string
  readonly markers: ReadonlyArray<string>
  readonly selection: SelectionInfo
  /** Entity list for the world panel: id order is THE deterministic order. */
  readonly entities: ReadonlyArray<{ readonly id: EntityId; readonly name: string; readonly marker: string | null }>
  readonly canUndo: boolean
  readonly canRedo: boolean
  /** Last completed action's label — the aria-live announcement text
   * ("painted 6 tiles", "undid: place crate"). Null until something happens. */
  readonly lastAction: string | null
  /** Monotonic counter bumped with every lastAction change — two identical
   * consecutive labels still differ here, so the announcer can force a DOM
   * mutation and screen readers re-announce repeats ("painted 1 tile",
   * again). */
  readonly lastActionSeq: number
  readonly persistence: PersistenceState
  /** The lesson rail's slice, published by the tutorial engine through the
   * host seam. Null = no lesson running. */
  readonly tutorial: TutorialUiState | null
  /** The active VIEW lens: null = the world's primary projection; a name =
   * the X-ray re-projection the student switched to. Mirrors the toolbar's
   * view buttons (aria-pressed) and never touches the document. */
  readonly viewProjection: ViewProjectionName | null
  /** The document's own primary projection, mirrored so the toolbar can
   * answer "which view button is pressed when viewProjection is null?"
   * without touching the document (null means "the primary" — this names
   * which one that is). */
  readonly primaryProjection: ViewProjectionName
}

/** Pointer-rate readout: written on every hover/cursor move, consumed by
 * imperative DOM writes in the status bar. Never enters the zustand store. */
export interface CursorReadout {
  /** World-plane position under the pointer (active-layer elevation pinned),
   * or null when the pointer is outside the canvas. */
  readonly world: { readonly x: number; readonly y: number } | null
  readonly tile: { readonly tx: number; readonly ty: number } | null
  /** Camera zoom as a plain multiplier (1 = fit). */
  readonly zoom: number
}

export interface FastChannel {
  publish(readout: CursorReadout): void
  subscribe(listener: (readout: CursorReadout) => void): () => void
  readonly last: CursorReadout | null
}

// ---------------------------------------------------------------------------
// Persistence outcomes
// ---------------------------------------------------------------------------

export type SaveOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string }

export type LoadOutcome =
  | { readonly ok: true; readonly usedBackup: boolean }
  | { readonly ok: false; readonly message: string }

// ---------------------------------------------------------------------------
// The session — the one object main.tsx builds and React talks to
// ---------------------------------------------------------------------------

/**
 * The assembled editor. main.tsx creates one, registers the built-in tool
 * plugins, boots the document (storage, else the starter world), and hands
 * the session to React. React calls methods; the session updates the store;
 * React re-renders. That loop is the whole integration.
 */
export interface EditorSession {
  readonly doc: World
  readonly bus: CommandBus
  readonly store: StoreApi<EditorSnapshot>
  readonly fast: FastChannel
  readonly preview: PreviewChannel
  /** The active projection's stack (world's primaryProjection). Picking and
   * overlays read it; the camera inside is the editor's pan/zoom state. */
  readonly stack: TransformStack

  // --- tools ---
  addTool(tool: EditorTool): void
  /** Install a tool plugin (calls plugin.register(session)). Same-name
   * double-install throws, like Engine.use. */
  use(plugin: EditorToolPlugin): EditorSession
  setActiveTool(id: ToolId): void

  // --- palette / layers / selection ---
  setActiveLayer(id: string): void
  setActiveTile(value: number): void
  setActiveMarker(kind: string): void
  /** Set the selection (tools and panels both land here); mirrors into the
   * snapshot and emits builder.selection-changed on real changes. */
  select(selection: Selection): void
  /** Set the transient hover ghost (render-only; null clears). */
  hover(tile: PickedTile | null): void

  // --- keyboard cell cursor (arrow keys move it; Enter acts through the
  //     active tool; it doubles as the hover ghost while keyboard-driven) ---
  readonly cursor: { readonly tx: number; readonly ty: number } | null
  moveCursor(dx: number, dy: number): void
  /** Enter (and a Space tap, on keyup — see endSpacePan): route the cursor
   * cell to the active tool's onCursorAct. */
  actAtCursor(): void
  /** Esc: abandon any live gesture — the active tool's onCancel plus any
   * live preview drag. Commits nothing, emits nothing. */
  cancelGesture(): void

  // --- camera ---
  /** Multiply zoom by `factor` about a screen point (wheel) or the view
   * center (keyboard +/−). Camera stays axis-aligned scale+translate — the
   * tilemap cache's fast-path precondition. */
  zoomBy(factor: number, aboutScreen?: Vec2): void
  panBy(dxScreen: number, dyScreen: number): void
  /** Refit the whole world in the viewport (also the boot framing). */
  resetCamera(): void
  /** Hold-Space pan, the Figma grammar: standby begins on keydown, and
   * while it holds, a pointer drag pans the camera instead of reaching the
   * active tool (the pan owns its whole gesture — releasing Space mid-drag
   * does not hand the tail to a tool that never saw its 'down'). */
  beginSpacePan(): void
  /** Standby ends on keyup. Returns whether any pan rode the hold, so the
   * caller can treat an untouched TAP of Space as the keyboard "act" it
   * has always been (EngineViewport acts on keyup exactly when this
   * answers false). */
  endSpacePan(): boolean

  // --- viewport ---
  /** Adopt a canvas: size it (ResizeObserver + DPR), own its rAF loop
   * (render-on-demand — a dirty flag, not a free-running loop), route its
   * pointer events to the active tool. Returns detach. */
  attach(canvas: HTMLCanvasElement): () => void
  /** Mark the scene dirty; the next animation frame repaints once. */
  requestRender(): void

  // --- persistence (the two-slot ceremony of @engine/world-format) ---
  /** Save the document — UNLESS the live document is a lesson fixture
   * (origin 'fixture'): a fixture is a borrowed backdrop, and writing it
   * into the student's save slot would destroy their world. While a fixture
   * is live, save() refuses with a student-language message and touches no
   * storage; the tutorial host parks the student's own world when a fixture
   * loads and brings it back afterward. */
  save(): SaveOutcome
  restoreBackup(): LoadOutcome
  exportText(): string
  importText(text: string): LoadOutcome
  /** Replace the document (load/import/new/fixture). Clears history,
   * selection, preview; rebuilds renderers; emits builder.world-loaded.
   * Origin 'fixture' marks the document as a borrowed lesson backdrop:
   * save() refuses while it is live (see save), and the flag clears the
   * moment any other origin arrives. */
  loadWorld(
    world: World,
    origin: 'boot' | 'load' | 'import' | 'restore' | 'new' | 'fixture' | 'park-restore',
  ): void
  /** True while the live document is a lesson fixture (origin 'fixture'). */
  readonly fixtureActive: boolean
  /** Speak through the editor's ONE voice: set lastAction (bumping
   * lastActionSeq) so the status bar's live region announces it. The
   * tutorial host uses this for step changes and revealed hints — screen
   * readers hear the rail move without a second competing live region. */
  announce(label: string): void

  // --- the view lens + tutorial surface (Phase 3) ---
  /** Switch the VIEW lens: re-project the same document through another
   * projection (ARCHITECTURE §4's curated X-ray lens — "same world,
   * different matrix" as a live experience). Null returns to the world's
   * primary projection. The document is untouched; picking, tools, and the
   * cursor keep working through the active stack (that they CAN is itself
   * honest — the math never needed the art). Emits
   * builder.view-projection-changed on real changes; rebuilds the stack and
   * refits the camera. */
  setViewProjection(name: ViewProjectionName | null): void
  readonly viewProjection: ViewProjectionName | null
  /** Replace the tutorial overlay set (drawn by @engine/lens above the
   * scene, under the selection outlines). The tutorial host routes
   * show-overlays effects here; an empty array clears. Render-only. */
  setOverlays(overlays: ReadonlyArray<LensOverlaySpec>): void

  // --- builder.* events (the engine↔UI boundary emitter; lessons listen) ---
  onEvent(listener: (event: BuilderEvent) => void): () => void

  // --- anchors (static passthrough so ui/ has one import site) ---
  anchor(id: AnchorId): AnchorId

  dispose(): void
}

// ---------------------------------------------------------------------------
// Starter document contract (what a first-run editor opens)
// ---------------------------------------------------------------------------

/**
 * The starter world, pinned as a contract so tests and the e2e flow can rely
 * on it: name "my first world", top-down primary projection, tileSize 1,
 * seed 7; one tileset 'terrain' (grass, water, sand, stone, path — grass
 * first so palette slot 1 is the obvious brush); one 32×24 ground layer
 * (elevation 0, band 0, id 'ground') pre-filled with grass, a water pond at
 * tx 5–8 × ty 4–6, and a one-cell sand rim around it (tx 4–9 × ty 3–7 minus
 * the pond) — lesson `tile-at` targets must avoid that whole region so a
 * fresh boot never pre-satisfies them; one 'player' marker entity standing
 * at (16.5, 12.5), the CENTER of cell (16, 12), because cell-dwellers stand
 * on centers (the tileToWorld +0.5 lesson). Friendly, not blank — the first
 * thing a kid sees should already look like a world.
 */
export type StarterWorld = World

/** localStorage base key for the editor's save slots ('editor:world' →
 * 'editor:world', 'editor:world.backup', 'editor:world.tmp' via the slot
 * ceremony's own suffixing). */
export const SAVE_BASE_KEY = 'world'
export const SAVE_PREFIX = 'editor:'
