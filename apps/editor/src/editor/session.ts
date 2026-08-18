/**
 * The editor session — the one object main.tsx builds and React talks to.
 *
 * Everything Wave A built is a part on a bench: the command bus, the store
 * builders, the scene renderer, the viewport, the camera controller, the
 * persistence glue, the fast channel, the event emitter. This file is the
 * assembly — it wires them into the one-way flow the locked contract draws
 * (types.ts):
 *
 *     pointer/keyboard ─▶ tool ─▶ CommandBus ─▶ document ─▶ snapshot ─▶ React
 *                          │                        ▲
 *                          └──── PreviewChannel ────┘
 *
 * The session's own discipline, in three sentences:
 *
 * 1. **The document changes through the bus, and the bus tells the session
 *    through its DocumentHost seat** — replaceDoc for entity/settings edits,
 *    tilesTouched for in-place cell mutation. Nothing else writes the doc,
 *    except loadWorld, which swaps it wholesale and says so with an event.
 * 2. **The emitter is the ONE event spine.** The bus emits into it, lessons
 *    and panels subscribe through onEvent — and the session itself is just
 *    another subscriber: it turns events into announcement strings
 *    (describeEvent below), flips persistence to 'unsaved' when the
 *    document changed, refreshes the snapshot, and requests a repaint.
 *    One spine, no side channels.
 * 3. **The snapshot is throttled by construction**: it is rebuilt after real
 *    changes (events, selection, palette switches) — never per frame, never
 *    per pointer-move. Pointer-rate values ride the fast channel instead.
 *
 * Boot happens inside the factory, through the same internal path as
 * loadWorld (origin 'boot'): storage first, the starter world as the
 * friendly fallback. A session is therefore never document-less — every
 * consumer, React included, meets a fully-formed world.
 */

import type { TileLayer, World } from '@engine/core'
import { getEntity } from '@engine/core'
import type { Vec2 } from '@engine/math'
import { createIso, createProfile, createTopDown, createTransformStack } from '@engine/projection'
import type { Projection, TransformStack } from '@engine/projection'
import type { RendererBackend } from '@engine/renderer'
import { createCanvas2dBackend } from '@engine/renderer-canvas2d'
import { createOffscreenRasterFactory, tileToWorld } from '@engine/tilemap'
import type { RasterFactory } from '@engine/tilemap'
import type { LensOverlaySpec, ViewProjectionName } from '@engine/tutorial'
import { createLocalStorageSlots } from '@engine/world-format'
import type { SlotStorage } from '@engine/world-format'
import { anchor } from './anchors'
import type { AnchorId } from './anchors'
import { createCameraController, wheelZoomFactor } from './camera'
import type { CameraController } from './camera'
import { createCommandBus } from './commands/bus'
import { createBuilderEmitter } from './events/builder'
import type { BuilderEvent } from './events/builder'
import { createFastChannel } from './fast'
import { bootDoc, exportDoc, importDoc, restoreBackupDoc, saveDoc } from './persistence'
import { pointerToCell, sameTile } from './picking'
import { createPreviewChannel } from './preview'
import { createSceneRenderer } from './render'
import { createStarterWorld } from './starter'
import {
  createEditorStore,
  entitiesFromDoc,
  MARKER_KINDS,
  paletteFromDoc,
  selectionInfoFromDoc,
} from './store'
import { SAVE_PREFIX } from './types'
import type {
  DocumentHost,
  EditorSession,
  EditorTool,
  EditorToolPlugin,
  LoadOutcome,
  PersistenceState,
  PickedTile,
  SaveOutcome,
  Selection,
  ToolId,
  ToolPointerEvent,
} from './types'
import { createViewport } from './viewport'
import type { Viewport } from './viewport'

// ---------------------------------------------------------------------------
// The announcement table
// ---------------------------------------------------------------------------

/**
 * Event → announcement string: THE one table the aria-live region (via
 * snapshot.lastAction) and the tests both read, so what a screen reader
 * hears and what a test asserts can never drift apart. Returns null for
 * events that are not completed actions (selection changes are navigation,
 * not work — announcing every click would bury the announcements that
 * matter).
 *
 * The doc rides along because entity-moved carries only an id, and
 * "moved player" beats "moved e1" — the bus emits AFTER the document
 * updated, so the entity is always there to name.
 */
export function describeEvent(event: BuilderEvent, doc: World): string | null {
  switch (event.type) {
    case 'builder.tile-painted': {
      const n = event.cells.length
      return `${event.tile === 0 ? 'erased' : 'painted'} ${n} ${n === 1 ? 'tile' : 'tiles'}`
    }
    case 'builder.entity-placed':
      return `placed ${event.marker}`
    case 'builder.entity-moved':
      return `moved ${getEntity(doc, event.id)?.name ?? event.id}`
    case 'builder.entity-renamed':
      return `renamed ${event.from} to '${event.to}'`
    case 'builder.entity-deleted':
      return `deleted ${event.name}`
    case 'builder.selection-changed':
      return null
    case 'builder.command-undone':
      return `undid: ${event.label}`
    case 'builder.command-redone':
      return `redid: ${event.label}`
    case 'builder.world-saved':
      return 'saved world'
    case 'builder.world-loaded':
      return 'loaded world'
    case 'builder.world-renamed':
      return `renamed world to '${event.to}'`
    case 'builder.view-projection-changed':
      // Emitted by setViewProjection on real lens switches (Phase 3): the
      // student hears which matrix they are now looking through.
      return `switched to ${event.to} view`
  }
}

/** The events after which the document no longer matches its last save —
 * the session flips persistence to 'unsaved' when one of these arrives.
 * (Undo/redo count: un-doing your way back to the saved bytes is possible
 * but not knowable cheaply, so the honest answer is "changed".) */
const DOCUMENT_CHANGING_EVENTS: ReadonlySet<BuilderEvent['type']> = new Set([
  'builder.tile-painted',
  'builder.entity-placed',
  'builder.entity-moved',
  'builder.entity-renamed',
  'builder.entity-deleted',
  'builder.world-renamed',
  'builder.command-undone',
  'builder.command-redone',
])

/** Restore-backup's status-bar sentence, shared by restoreBackup() and the
 * 'restore' origin of loadWorld. */
const RESTORED_MESSAGE = 'Restored the backup copy — this is your previous save.'

/** The status-bar sentence right after a park-restore (origin 'park-restore',
 * types.ts): the restored document's bytes exist in NO save slot — the park
 * key was spent bringing them back, and the save slot still holds whatever
 * was last saved. Calling this 'saved' would open a silent data-loss window
 * (a student who closes the tab here loses their world believing it kept);
 * 'unsaved' plus this sentence tells the one action that closes it. */
const PARK_RESTORED_MESSAGE = 'back from the lesson — press Ctrl+S to keep your world'

/** The status-bar sentence while a lesson fixture is the live document —
 * the short badge form of the parked-world story, kept up for as long as
 * the fixture is live (edits to the fixture included). */
const FIXTURE_MESSAGE = 'lesson world — your own world is parked and safe'

/** save()'s refusal while a fixture is live (types.ts pins this): the full
 * student-language sentence, returned AND shown, so a kid pressing Ctrl+S
 * on the showcase island learns their world is fine — not that they just
 * overwrote it with lesson scenery. */
const FIXTURE_SAVE_REFUSED_MESSAGE =
  'This is a lesson world you are visiting — your own world is parked and safe. ' +
  'Head back to it before saving.'

/** Every door a document can arrive through (types.ts pins the public
 * union): the five persistent origins the frozen event vocabulary knows,
 * plus the two app-side ones — 'fixture' (a borrowed lesson backdrop) and
 * 'park-restore' (the parked world coming back after one). */
type LoadOrigin = 'boot' | 'load' | 'import' | 'restore' | 'new' | 'fixture' | 'park-restore'

// ---------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------

/** What createEditorSession accepts: a storage to save into and a raster
 * factory for the tile caches. The defaults are the real browser ones;
 * tests inject an in-memory storage and a pixel-less raster fake. */
export interface CreateEditorSessionOptions {
  readonly storage?: SlotStorage
  readonly raster?: RasterFactory
}

/** Assemble (and boot) one editor session. See the file header. */
export function createEditorSession(opts: CreateEditorSessionOptions = {}): EditorSession {
  const storage = opts.storage ?? createLocalStorageSlots(SAVE_PREFIX)
  const raster = opts.raster ?? createOffscreenRasterFactory()

  // --- state ----------------------------------------------------------------
  // Definite-assignment (!): boot at the bottom of this factory assigns all
  // three before the session object ever escapes.
  let doc!: World
  let stack!: TransformStack
  let cameraController!: CameraController

  let viewport: Viewport | null = null
  let backend: RendererBackend | null = null
  /** Boot/loadWorld want the world framed, but the canvas may not be laid
   * out yet (or attached at all). The flag survives until a positive size
   * shows up — at attach, or at the first ResizeObserver report. */
  let needsFit = false

  let selection: Selection = null
  let hoverTile: PickedTile | null = null
  let cursor: { tx: number; ty: number } | null = null
  /** Space-pan (the Figma grammar): while the spacebar is held the session
   * stands by to PAN — the next pointerdown grabs the camera instead of the
   * active tool. Three pieces because three questions differ: is the bar
   * held right now (standby), did any pan actually start during this hold
   * (engaged — endSpacePan reports it so an untouched tap can still act),
   * and is a pan drag live at this instant (the gesture, which keeps the
   * pointer until 'up' even if the bar lifts first). */
  let spacePanStandby = false
  let spacePanEngaged = false
  let panGesture: { last: Vec2 } | null = null
  /** Brush by default: a first-run kid should paint on the very first
   * click, not puzzle over an inert select tool. */
  let activeToolId: ToolId = 'brush'
  let activeLayerId: string | null = null
  /** Palette slot 1 — grass in the starter tileset, the obvious brush. */
  let activeTile = 1
  let activeMarker: string = MARKER_KINDS[0] ?? 'player'
  /** The VIEW lens (ARCHITECTURE §4's curated X-ray): null = the document's
   * own primary projection; a name = the re-projection the student (or a
   * lesson effect) switched to. Never serialized — a lens is an opinion
   * about looking, not a fact about the world. */
  let viewProjection: ViewProjectionName | null = null
  /** The tutorial's overlay set, drawn by @engine/lens each frame. Render-
   * only transient state, exactly like hover: no snapshot, no history. */
  let overlays: ReadonlyArray<LensOverlaySpec> = []
  let lastAction: string | null = null
  /** Bumped with EVERY lastAction change (types.ts): two identical labels
   * in a row still differ here, so the announcer can force a DOM mutation
   * and screen readers re-announce "painted 1 tile" the second time too. */
  let lastActionSeq = 0
  let persistence: PersistenceState = { state: 'unsaved', message: null }
  /** True while the live document is a lesson fixture (origin 'fixture') —
   * a borrowed backdrop the tutorial host swapped in. While it is raised,
   * save() refuses (writing the fixture into the student's save slot would
   * destroy their world); it clears the moment ANY other origin arrives
   * (types.ts pins both halves). */
  let fixtureActive = false
  /** The last pointer-derived readout, kept so camera changes can republish
   * a fresh zoom without inventing a pointer position. */
  let lastPointer: {
    world: { x: number; y: number } | null
    tile: { tx: number; ty: number } | null
  } = { world: null, tile: null }
  let disposed = false

  const store = createEditorStore()
  const fast = createFastChannel()
  const emitter = createBuilderEmitter()
  const sceneRenderer = createSceneRenderer({ raster })
  const tools = new Map<ToolId, EditorTool>()
  const pluginNames: string[] = []
  /** Every live emitter unsubscribe (the session's own listener included),
   * so dispose() can drop them all. */
  const eventSubscriptions = new Set<() => void>()

  // --- small helpers --------------------------------------------------------

  const activeLayer = (): TileLayer | null =>
    doc.layers.find((layer) => layer.id === activeLayerId) ?? null

  /** The canvas's current size, or zero when nothing is attached — zero
   * makes the camera controller's fit() decline politely. */
  const viewSize = (): { width: number; height: number } =>
    viewport !== null ? viewport.size() : { width: 0, height: 0 }

  /** Mark the scene dirty. A no-op before attach, and safely so: every
   * state change also lands in the snapshot (or in the document itself),
   * so the FIRST real render after attach paints current state — nothing
   * a skipped repaint could have shown is ever lost. */
  function requestRender(): void {
    viewport?.requestRender()
  }

  function publishFast(): void {
    fast.publish({ world: lastPointer.world, tile: lastPointer.tile, zoom: cameraController.zoom() })
  }

  /** The projection the document asked for, with the same default factory
   * parameters the Phase 1 demo uses (apps/three-windows/src/main.ts) — the
   * editor and the demo must agree on what "topdown" looks like. */
  function projectionFor(name: World['settings']['primaryProjection']): Projection {
    switch (name) {
      case 'topdown':
        return createTopDown()
      case 'iso':
        return createIso()
      case 'profile':
        return createProfile()
    }
  }

  /** The projection the picture currently lives in: the VIEW lens when one
   * is set, else the document's own primary. Everything downstream —
   * picking, tools, the cursor, overlays — reads the stack this name built,
   * which is why they all keep working through a lens switch: the math
   * never needed the art (ARCHITECTURE §4). */
  const effectiveProjection = (): ViewProjectionName => viewProjection ?? doc.settings.primaryProjection

  /** (Re)build the stack and its camera controller around a projection —
   * loadWorld's move (a new world may carry a new primary) and
   * setViewProjection's (same world, different matrix). */
  function rebuildStack(name: ViewProjectionName): void {
    stack = createTransformStack(projectionFor(name))
    cameraController = createCameraController(stack, viewSize)
  }

  /** Frame the whole world in the fresh stack — or defer until the canvas
   * has real space (attach/onResize land the pending fit). Republishes the
   * fast readout either way: the zoom the status bar shows must belong to
   * the camera that now exists, not its predecessor. */
  function refitCamera(): void {
    needsFit = true
    if (viewport !== null) {
      const size = viewport.size()
      if (size.width > 0 && size.height > 0) {
        cameraController.fit(doc)
        needsFit = false
      }
    }
    publishFast()
  }

  /** Keep the brush value inside the current palette after the palette
   * itself changed (layer switch, world load). Falls back to slot 1 (the
   * first real tile) — or the eraser when the palette has nothing else. */
  function clampActiveTile(): void {
    const palette = paletteFromDoc(doc, activeLayerId)
    if (activeTile < 0 || activeTile >= palette.length) {
      activeTile = palette.length > 1 ? 1 : 0
    }
  }

  // --- the snapshot ---------------------------------------------------------

  /**
   * Rebuild the full EditorSnapshot from the document plus the session's ui
   * state, through Wave A's pure builders. One deliberate omission: the
   * `tutorial` slice is NOT written — zustand's setState merges shallowly,
   * so leaving the key out preserves whatever the tutorial engine (which
   * owns that slice and publishes it through the host's own setState) last
   * published.
   */
  function refreshSnapshot(): void {
    store.setState({
      worldName: doc.meta.name,
      layers: doc.layers.map((layer) => ({ id: layer.id, name: layer.name })),
      activeLayerId,
      activeToolId,
      palette: paletteFromDoc(doc, activeLayerId),
      activeTile,
      activeMarker,
      markers: MARKER_KINDS,
      selection: selectionInfoFromDoc(doc, selection),
      entities: entitiesFromDoc(doc),
      canUndo: bus.canUndo(),
      canRedo: bus.canRedo(),
      lastAction,
      lastActionSeq,
      persistence,
      viewProjection,
      primaryProjection: doc.settings.primaryProjection,
    })
  }

  // --- the document seat and the bus ---------------------------------------

  const host: DocumentHost = {
    get doc(): World {
      return doc
    },
    replaceDoc(next: World): void {
      doc = next
      refreshSnapshot()
      requestRender()
    },
    tilesTouched(): void {
      // Cells changed in place; the layer renderer notices through its own
      // revision bookkeeping — the session only needs to schedule a frame.
      requestRender()
    },
  }

  const bus = createCommandBus({ host, emit: (event) => emitter.emit(event) })

  const preview = createPreviewChannel({
    getDoc: () => doc,
    dispatch: (command) => bus.dispatch(command),
    requestRender,
  })

  // --- the session as its own event subscriber ------------------------------

  function handleBuilderEvent(event: BuilderEvent): void {
    const announcement = describeEvent(event, doc)
    if (announcement !== null) {
      lastAction = announcement
      lastActionSeq += 1
    }
    if (DOCUMENT_CHANGING_EVENTS.has(event.type)) {
      // While a fixture is live, edits to it are still honestly 'unsaved' —
      // but the message stays up: the story the status bar must keep telling
      // is "your own world is parked and safe", not silence.
      persistence = { state: 'unsaved', message: fixtureActive ? FIXTURE_MESSAGE : null }
    }
    refreshSnapshot()
    requestRender()
  }
  eventSubscriptions.add(emitter.on(handleBuilderEvent))

  // --- document arrival (boot / load / import / restore / new) --------------

  /**
   * The ONE path every document arrives through, boot included. Order
   * matters and is pinned: gestures are cancelled FIRST (the bus refuses
   * clearHistory while a stroke is open — rightly), the world state is
   * swapped and every per-document cache dropped, and only THEN does the
   * world-loaded event fire — so a listener that reads the session mid-event
   * sees the new world, whole.
   */
  function loadWorldInternal(
    world: World,
    origin: LoadOrigin,
    usedBackup: boolean,
    nextPersistence: PersistenceState,
  ): void {
    // Abandon any live gesture and its preview: tools own their gesture
    // state, so onCancel reaches the stroke or drag wherever it lives.
    tools.get(activeToolId)?.onCancel()
    // Then sweep the preview channel itself: an override the ACTIVE tool
    // does not own (a panel-begun drag, or a tool switched away mid-drag)
    // must not ghost an entity of the OLD world over the new one.
    preview.clear()

    doc = world
    // Origin 'fixture' RAISES the borrowed-backdrop flag; every other origin
    // clears it — the one-line rule that makes "save refuses while a fixture
    // is live" impossible to leave stuck on (types.ts: fixtureActive).
    fixtureActive = origin === 'fixture'
    bus.clearHistory()
    selection = null
    hoverTile = null
    cursor = null
    lastPointer = { world: null, tile: null }

    // A new document arrives in its OWN primary lens: the view lens was an
    // opinion about looking at the OLD world, and carrying it across would
    // show the new world through a borrowed matrix nobody chose for it —
    // a student loading their top-down map mid-iso-lesson should meet their
    // map, not a leftover X-ray of it.
    viewProjection = null

    // New layer objects (and possibly a new projection): the renderer cache
    // keyed by layer identity would silently go stale without this.
    sceneRenderer.reset()
    rebuildStack(doc.settings.primaryProjection)

    // Frame the new world (or defer to attach/onResize) and republish the
    // readout: the zoom must be the fresh camera's, and coordinates are
    // null honestly — lastPointer died with the old world a few lines up.
    refitCamera()

    activeLayerId = doc.layers[0]?.id ?? null
    clampActiveTile()
    persistence = nextPersistence

    emitter.emit({
      type: 'builder.world-loaded',
      worldId: doc.meta.worldId,
      // The frozen event vocabulary (D4) predates the app-side 'fixture'
      // and 'park-restore' origins, and frozen payloads do not widen for
      // app conveniences: to a decade of lesson data a fixture arrival IS
      // a fresh unsaved stage, so the event says 'new' — and a park-restore
      // IS a load (a whole stored world arriving on stage), so the event
      // says 'load'. Both distinctions live app-side (fixtureActive +
      // save()'s refusal; the park-restore persistence badge), where they
      // are enforced.
      origin: origin === 'fixture' ? 'new' : origin === 'park-restore' ? 'load' : origin,
      usedBackup,
    })
    refreshSnapshot()
    requestRender()
  }

  /** What arriving from each public origin means for the save state. Boot
   * is listed as 'saved' because the only boot that reaches the PUBLIC
   * loadWorld is a from-storage boot; the factory's starter fallback passes
   * its own 'unsaved' through the internal path directly. */
  function persistenceFor(origin: LoadOrigin): PersistenceState {
    switch (origin) {
      case 'boot':
      case 'load':
        return { state: 'saved', message: null }
      case 'restore':
        return { state: 'restored', message: RESTORED_MESSAGE }
      case 'import':
      case 'new':
        // An imported (or brand-new) world has not been saved HERE yet.
        return { state: 'unsaved', message: null }
      case 'fixture':
        // A borrowed lesson backdrop: 'unsaved' is the honest badge (this
        // document is not in the save slot), and the message tells the
        // story that matters — the student's own world is parked, not lost.
        return { state: 'unsaved', message: FIXTURE_MESSAGE }
      case 'park-restore':
        // The parked world coming back after a lesson detour: its bytes may
        // exist in NO save slot (the park key was just spent), so 'saved'
        // would be a lie with a data-loss window behind it. 'unsaved', and
        // the message names the one action that closes the window.
        return { state: 'unsaved', message: PARK_RESTORED_MESSAGE }
    }
  }

  // --- selection / hover / cursor -------------------------------------------

  function select(next: Selection): void {
    // Dedupe: reselecting the same thing is silent (the event contract says
    // selection-changed fires once per CHANGE).
    if (next === null && selection === null) return
    if (next !== null && selection !== null) {
      if (next.kind === 'entity' && selection.kind === 'entity' && next.id === selection.id) return
      if (next.kind === 'tile' && selection.kind === 'tile' && sameTile(next.tile, selection.tile)) {
        return
      }
    }
    selection = next
    refreshSnapshot()
    emitter.emit({
      type: 'builder.selection-changed',
      selection:
        next === null
          ? null
          : next.kind === 'entity'
            ? { kind: 'entity', id: next.id }
            : { kind: 'tile', tx: next.tile.tx, ty: next.tile.ty, layerId: next.tile.layerId },
    })
    requestRender()
  }

  function hover(tile: PickedTile | null): void {
    // Render-only transient state: no snapshot, no event — just a repaint
    // when the ghost actually moved cells.
    if (sameTile(hoverTile, tile)) return
    hoverTile = tile
    requestRender()
  }

  function moveCursor(dx: number, dy: number): void {
    const layer = activeLayer()
    if (layer === null) return
    if (cursor === null) {
      // First use SUMMONS the cursor at the layer's center; the summoning
      // keypress spends itself on appearing, not on moving.
      cursor = { tx: Math.floor(layer.width / 2), ty: Math.floor(layer.height / 2) }
    } else {
      cursor = {
        tx: Math.min(layer.width - 1, Math.max(0, cursor.tx + dx)),
        ty: Math.min(layer.height - 1, Math.max(0, cursor.ty + dy)),
      }
    }
    // The keyboard's readout mirrors the mouse's: the cursor "points at"
    // its cell's center, in world units.
    const center = tileToWorld(doc.settings, cursor.tx, cursor.ty)
    lastPointer = { world: { x: center.x, y: center.y }, tile: { ...cursor } }
    publishFast()
    // The active tool hears the move AFTER the cursor state settled — the
    // select tool's keyboard carry rides this (types.ts: onCursorMove).
    tools.get(activeToolId)?.onCursorMove?.({ ...cursor })
    requestRender()
  }

  // --- the viewport ---------------------------------------------------------

  function attach(canvas: HTMLCanvasElement): () => void {
    if (viewport !== null) {
      throw new Error(
        'attach: a canvas is already attached — one viewport per session; detach it first',
      )
    }
    backend = createCanvas2dBackend(canvas)

    const vp = createViewport({
      canvas,
      onPointer(phase, raw): void {
        // Space-pan intercepts BEFORE tools ever hear the pointer: a down
        // during standby begins a camera pan, and the pan then owns the
        // whole gesture — releasing the spacebar mid-drag does not hand a
        // half-finished gesture to a tool that never saw its 'down'
        // (Figma's grammar: the pan runs until the mouse lets go).
        if (phase === 'down' && spacePanStandby) {
          spacePanEngaged = true
          panGesture = { last: raw.screen }
          hover(null) // a frozen ghost sliding with the world would lie
          viewport?.setCursor('grabbing')
          return
        }
        if (panGesture !== null) {
          if (phase === 'move') {
            panBy(raw.screen.x - panGesture.last.x, raw.screen.y - panGesture.last.y)
            panGesture.last = raw.screen
          } else if (phase === 'up') {
            panGesture = null
            viewport?.setCursor(spacePanStandby ? 'grab' : '')
          }
          return
        }

        // The enrichment every tool relies on: screen → world/tile through
        // the active projection's inverse, pinned to the active layer.
        const enriched = pointerToCell(doc, stack, raw.screen, activeLayer())
        const event: ToolPointerEvent = {
          screen: raw.screen,
          world: enriched.world,
          tile: enriched.tile,
          primary: raw.primary,
          shiftKey: raw.shiftKey,
        }
        const tool = tools.get(activeToolId)
        if (phase === 'down') tool?.onPointerDown(event)
        else if (phase === 'move') tool?.onPointerMove(event)
        else tool?.onPointerUp(event)

        if (phase === 'move') {
          lastPointer = {
            world: enriched.world === null ? null : { x: enriched.world.x, y: enriched.world.y },
            tile: enriched.tile,
          }
          publishFast()
        }
      },
      onWheel(deltaY, aboutScreen): void {
        // deltaY 0 means "no scroll" (trackpads emit it on pure-horizontal
        // gestures and at momentum end) — it must not read as "zoom out".
        if (deltaY === 0) return
        // Proportional, not fixed-per-event: the factor scales with the
        // delta (camera.ts wheelZoomFactor — the zoom-feel dials live
        // there), so trackpad streams and wheel notches feel the same.
        zoomBy(wheelZoomFactor(deltaY), aboutScreen)
      },
      onLeave(): void {
        hover(null)
        lastPointer = { world: null, tile: null }
        publishFast()
      },
      onResize(): void {
        // A pending fit (boot/loadWorld before layout) lands on the first
        // resize that reports real space. The viewport itself requests a
        // render after every resize callback, so none is needed here.
        if (needsFit) {
          const size = vp.size()
          if (size.width > 0 && size.height > 0) {
            cameraController.fit(doc)
            needsFit = false
            // The fit just redefined zoom = 1: the readout must say so.
            publishFast()
          }
        }
      },
      render(size): void {
        if (backend === null) return // detached mid-frame: nothing to draw onto
        sceneRenderer.render(backend, doc, stack, size, {
          selection,
          hoverTile,
          cursorTile: cursor,
          entityOverride: preview.entityOverride,
          activeLayerId,
          overlays,
          // The grid stays ON this phase: the v1 editor always shows it —
          // cells are the editing vocabulary, and hiding them is a later
          // preference, not a Phase 2 option.
          grid: true,
        })
      },
    })
    viewport = vp

    // The canvas may already be laid out; if so, the pending fit lands now
    // instead of waiting for the first ResizeObserver report.
    if (needsFit) {
      const size = vp.size()
      if (size.width > 0 && size.height > 0) {
        cameraController.fit(doc)
        needsFit = false
        // The fit just redefined zoom = 1: the readout must say so.
        publishFast()
      }
    }
    vp.requestRender()

    return function detach(): void {
      if (viewport !== vp) return // already detached (detach is idempotent)
      vp.detach()
      viewport = null
      backend = null
      // A pan cannot outlive its canvas: a later re-attach must start with
      // a clean pointer story, not a gesture stranded mid-hold.
      panGesture = null
      spacePanStandby = false
      spacePanEngaged = false
    }
  }

  // --- camera ---------------------------------------------------------------

  /** The spacebar went down: stand by to pan. Idempotent — key auto-repeat
   * hammers keydown, and only the FIRST press of a hold may reset the
   * engagement record (a repeat mid-drag must not erase it). */
  function beginSpacePan(): void {
    if (spacePanStandby) return
    spacePanStandby = true
    spacePanEngaged = false
    if (panGesture === null) viewport?.setCursor('grab')
  }

  /** The spacebar came up: leave standby and report whether any pan rode
   * this hold — the caller uses false to treat an untouched tap as the
   * keyboard "act" it has always been. A pan drag that is still live keeps
   * the pointer (and its grabbing cursor) until pointerup. */
  function endSpacePan(): boolean {
    const engaged = spacePanEngaged
    spacePanStandby = false
    spacePanEngaged = false
    if (panGesture === null) viewport?.setCursor('')
    return engaged
  }

  function zoomBy(factor: number, aboutScreen?: Vec2): void {
    cameraController.zoomBy(factor, aboutScreen)
    publishFast()
    requestRender()
  }

  function panBy(dxScreen: number, dyScreen: number): void {
    cameraController.panBy(dxScreen, dyScreen)
    publishFast()
    requestRender()
  }

  function resetCamera(): void {
    cameraController.fit(doc)
    needsFit = false
    publishFast()
    requestRender()
  }

  // --- persistence ----------------------------------------------------------

  function save(): SaveOutcome {
    // The fixture refusal comes BEFORE everything — the gesture settle
    // included: refusing must have zero side effects on the document
    // (types.ts pins this), and settling would commit a live stroke into a
    // borrowed backdrop nobody keeps. Storage is never touched; only the
    // persistence mirror changes, so the status bar can say why.
    if (fixtureActive) {
      persistence = { state: 'unsaved', message: FIXTURE_SAVE_REFUSED_MESSAGE }
      refreshSnapshot()
      return { ok: false, message: FIXTURE_SAVE_REFUSED_MESSAGE }
    }

    // Settle the active tool's live gesture FIRST — commit it (onSettle),
    // so a half-painted stroke or mid-air drag enters the file as a normal
    // history entry with its event, never as silent bytes. A tool without
    // onSettle falls back to onCancel: serializing a half-gesture is the
    // one outcome the contract forbids (types.ts: EditorTool.onSettle).
    const active = tools.get(activeToolId)
    if (active !== undefined) {
      if (active.onSettle !== undefined) active.onSettle()
      else active.onCancel()
    }

    const outcome = saveDoc(storage, doc)
    if (outcome.ok) {
      persistence = { state: 'saved', message: null }
      // The listener (handleBuilderEvent) refreshes the snapshot and sets
      // lastAction from this event — same spine as every other action.
      emitter.emit({ type: 'builder.world-saved', worldId: doc.meta.worldId })
    } else {
      persistence = { state: 'error', message: outcome.message }
      refreshSnapshot()
    }
    return outcome
  }

  function restoreBackup(): LoadOutcome {
    const result = restoreBackupDoc(storage)
    if (!result.ok) return { ok: false, message: result.message }
    loadWorldInternal(result.world, 'restore', true, {
      state: 'restored',
      message: RESTORED_MESSAGE,
    })
    return { ok: true, usedBackup: true }
  }

  function importText(text: string): LoadOutcome {
    const result = importDoc(text)
    if ('message' in result) return { ok: false, message: result.message }
    loadWorldInternal(result.world, 'import', false, { state: 'unsaved', message: null })
    return { ok: true, usedBackup: false }
  }

  // --- the session object ---------------------------------------------------

  const session: EditorSession = {
    get doc(): World {
      return doc
    },
    bus,
    store,
    fast,
    preview,
    get stack(): TransformStack {
      return stack
    },

    addTool(tool: EditorTool): void {
      if (tools.has(tool.id)) {
        throw new Error(
          `addTool: a tool with id '${tool.id}' is already registered — ` +
            'two tools answering the same pointer would fight over every gesture',
        )
      }
      tools.set(tool.id, tool)
    },

    use(plugin: EditorToolPlugin): EditorSession {
      if (pluginNames.includes(plugin.name)) {
        throw new Error(
          `use: a plugin named '${plugin.name}' is already installed — installing it twice ` +
            'would register its tools twice',
        )
      }
      // Claim the name BEFORE register() runs (Engine.use's own discipline):
      // a buggy plugin that re-enters use() with its own name fails loudly
      // instead of recursing.
      pluginNames.push(plugin.name)
      plugin.register(session)
      return session
    },

    setActiveTool(id: ToolId): void {
      if (id === activeToolId) return
      // The outgoing tool's live gesture dies with the switch — cancelled,
      // never committed (a half-stroke committed by a toolbar click would
      // be an edit nobody made on purpose).
      tools.get(activeToolId)?.onCancel()
      activeToolId = id
      refreshSnapshot()
      requestRender()
    },

    setActiveLayer(id: string): void {
      if (id === activeLayerId) return
      const layer = doc.layers.find((candidate) => candidate.id === id)
      if (layer === undefined) {
        throw new Error(`setActiveLayer: no layer '${id}' in this world`)
      }
      // Mirror setActiveTool: the live gesture dies with the storey switch,
      // cancelled, never committed — a stroke opened on one layer must not
      // keep painting (or half-commit) after the ground moved under it.
      tools.get(activeToolId)?.onCancel()
      activeLayerId = id
      // The cursor lives on the active layer; a smaller layer must not
      // strand it outside its own bounds.
      if (cursor !== null) {
        cursor = {
          tx: Math.min(layer.width - 1, Math.max(0, cursor.tx)),
          ty: Math.min(layer.height - 1, Math.max(0, cursor.ty)),
        }
      }
      clampActiveTile()
      refreshSnapshot()
      requestRender()
    },

    setActiveTile(value: number): void {
      const palette = paletteFromDoc(doc, activeLayerId)
      if (!Number.isInteger(value) || value < 0 || value >= palette.length) {
        throw new Error(
          `setActiveTile: ${value} is not a value in the current palette (0..${palette.length - 1})`,
        )
      }
      activeTile = value
      refreshSnapshot()
    },

    setActiveMarker(kind: string): void {
      if (!MARKER_KINDS.includes(kind)) {
        throw new Error(
          `setActiveMarker: '${kind}' is not a marker kind (${MARKER_KINDS.join(', ')})`,
        )
      }
      activeMarker = kind
      refreshSnapshot()
    },

    select,
    hover,

    get cursor(): { tx: number; ty: number } | null {
      return cursor === null ? null : { ...cursor }
    },

    moveCursor,

    actAtCursor(): void {
      if (cursor === null) return
      tools.get(activeToolId)?.onCursorAct({ ...cursor })
    },

    cancelGesture(): void {
      // Tools own their live gesture state (stroke or preview drag); Esc
      // reaches it through the one door every gesture shares.
      tools.get(activeToolId)?.onCancel()
      // Then sweep the preview channel: an override the active tool does
      // not own (panel-begun, or orphaned by a mid-drag tool switch) must
      // die on Esc too — Esc means "no ghosts", whoever made them.
      preview.clear()
    },

    zoomBy,
    panBy,
    resetCamera,
    beginSpacePan,
    endSpacePan,

    attach,
    requestRender,

    save,
    restoreBackup,
    exportText(): string {
      return exportDoc(doc)
    },
    importText,

    loadWorld(world: World, origin: LoadOrigin): void {
      loadWorldInternal(world, origin, false, persistenceFor(origin))
    },

    get fixtureActive(): boolean {
      return fixtureActive
    },

    announce(label: string): void {
      // The tutorial host's door into the editor's ONE voice (types.ts):
      // the same lastAction/lastActionSeq the builder-event listener
      // writes, so the status bar's single live region speaks rail changes
      // too — and deliberately NO builder event, because nothing happened
      // to the world (a step advancing is the rail's news, not the
      // document's, and lessons must never gate on their own narration).
      lastAction = label
      lastActionSeq += 1
      refreshSnapshot()
    },

    setViewProjection(name: ViewProjectionName | null): void {
      if (name === viewProjection) return // same lens: nothing to do, nothing to say
      const from = effectiveProjection()
      viewProjection = name
      const to = effectiveProjection()
      if (from !== to) {
        // Mirror setActiveLayer: the live gesture dies with the matrix
        // switch, cancelled, never committed — a stroke or drag opened
        // under the old projection would otherwise keep recording through
        // a stack that no longer exists (its cells and ghost mapped by a
        // dead matrix). The preview sweep catches overrides the ACTIVE
        // tool does not own, exactly as loadWorld does.
        tools.get(activeToolId)?.onCancel()
        preview.clear()
        // Same world, different matrix: the layer raster cache is a picture
        // OF a projection (each LayerRenderer baked its geometry at creation),
        // so it must be dropped before the stack rebuilds around the new
        // effective projection and the camera refits the world into it.
        sceneRenderer.reset()
        rebuildStack(to)
        refitCamera()
        // The EFFECTIVE names, only on real changes: asking for the primary
        // by its own name (or clearing an already-null lens) changes no
        // matrix and therefore says nothing — lessons gate on this event,
        // and a no-op switch is not a switch.
        emitter.emit({ type: 'builder.view-projection-changed', from, to })
      }
      refreshSnapshot()
      requestRender()
    },

    get viewProjection(): ViewProjectionName | null {
      return viewProjection
    },

    setOverlays(next: ReadonlyArray<LensOverlaySpec>): void {
      // Render-only, like hover: the lesson's picture changes on screen this
      // frame and touches nothing else — no snapshot, no history, no event.
      overlays = next
      requestRender()
    },

    onEvent(listener: (event: BuilderEvent) => void): () => void {
      const off = emitter.on(listener)
      const wrapped = (): void => {
        off()
        eventSubscriptions.delete(wrapped)
      }
      eventSubscriptions.add(wrapped)
      return wrapped
    },

    anchor(id: AnchorId): AnchorId {
      return anchor(id)
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      if (viewport !== null) {
        viewport.detach()
        viewport = null
        backend = null
      }
      for (const off of [...eventSubscriptions]) off()
      eventSubscriptions.clear()
    },
  }

  // --- boot -----------------------------------------------------------------
  // Inside the factory, through the same internal path as loadWorld: the
  // session never exists without a document. Storage first; the starter
  // world greets a first run (or a storage whose every slot failed —
  // bootDoc's ladder already said everything sayable about that).
  const booted = bootDoc(storage)
  if (booted.world !== null) {
    loadWorldInternal(
      booted.world,
      'boot',
      booted.usedBackup,
      booted.usedBackup
        ? { state: 'restored', message: booted.message }
        : { state: 'saved', message: null },
    )
  } else {
    loadWorldInternal(createStarterWorld(), 'boot', false, { state: 'unsaved', message: null })
  }

  return session
}
