/**
 * The editor's non-React infrastructure, proven headless: camera math (the
 * zoom-about-a-point fixed-point property against the REAL top-down stack),
 * fast-channel semantics, the pure store builders, and the persistence glue
 * against both friendly and hostile storage.
 */

import type { World } from '@engine/core'
import { createWorld } from '@engine/core'
import { createRng, Vec2 } from '@engine/math'
import { createTopDown, createTransformStack } from '@engine/projection'
import { createTileLayer } from '@engine/tilemap'
import type { SlotStorage } from '@engine/world-format'
import { serializeWorld } from '@engine/world-format'
import { describe, expect, it, vi } from 'vitest'
import { createCameraController, fitZRange } from '../src/editor/camera'
import { createFastChannel } from '../src/editor/fast'
import { bootDoc, exportDoc, importDoc, restoreBackupDoc, saveDoc } from '../src/editor/persistence'
import { createStarterWorld } from '../src/editor/starter'
import { createViewport } from '../src/editor/viewport'
import {
  createEditorStore,
  EMPTY_SNAPSHOT,
  entitiesFromDoc,
  MARKER_KINDS,
  paletteFromDoc,
  selectionInfoFromDoc,
} from '../src/editor/store'
import type { CursorReadout } from '../src/editor/types'

const VIEW = { width: 640, height: 420, dpr: 1 }

/** A fitted controller over the real top-down projection stack. */
function makeCamera() {
  const stack = createTransformStack(createTopDown())
  const controller = createCameraController(stack, () => VIEW)
  controller.fit(createStarterWorld())
  return { stack, controller }
}

/** A world with one layer elevated to `elevation` — just enough shape for
 * fitZRange, which only reads each layer's elevation (plus settings.tileSize
 * and width/height for the unrelated ground-footprint fit). */
function worldWithElevation(elevation: number): World {
  const doc = createWorld()
  doc.layers.push(createTileLayer({ id: 'z', width: 4, height: 4, elevation, tilesetId: 'none' }))
  return doc
}

describe('camera controller', () => {
  it('fit() defines zoom() = 1', () => {
    const { controller } = makeCamera()
    expect(controller.zoom()).toBeCloseTo(1, 12)
  })

  it('zoomBy about a screen point keeps that point\'s world-image fixed (property)', () => {
    const { stack, controller } = makeCamera()
    // Seeded "arbitrary" inputs: reproducible forever, varied enough to
    // catch a wrong composition order (which fails for almost every point).
    const rng = createRng(1234)
    for (let round = 0; round < 50; round += 1) {
      const p = Vec2.make(rng.range(0, VIEW.width), rng.range(0, VIEW.height))
      const factor = rng.range(0.3, 3)
      const before = stack.screenToWorld(p, { kind: 'ground' })
      expect(before).not.toBeNull()
      if (before === null) continue
      controller.zoomBy(factor, p)
      const after = stack.worldToScreen(before)
      expect(after.x).toBeCloseTo(p.x, 6)
      expect(after.y).toBeCloseTo(p.y, 6)
    }
  })

  it('clamps the absolute multiplier into [0.25, 16]', () => {
    const { controller } = makeCamera()
    controller.zoomBy(1e6)
    expect(controller.zoom()).toBeCloseTo(16, 9)
    controller.zoomBy(1e-9)
    expect(controller.zoom()).toBeCloseTo(0.25, 9)
    controller.zoomBy(2)
    expect(controller.zoom()).toBeCloseTo(0.5, 9)
  })

  it('panBy slides every screen image by exactly (dx, dy)', () => {
    const { stack, controller } = makeCamera()
    const point = { x: 5, y: 7, z: 0 }
    const before = stack.worldToScreen(point)
    controller.panBy(13, -7)
    const after = stack.worldToScreen(point)
    expect(after.x).toBeCloseTo(before.x + 13, 9)
    expect(after.y).toBeCloseTo(before.y - 7, 9)
  })

  it('stays an axis-aligned positive scale+translate through any sequence', () => {
    const { stack, controller } = makeCamera()
    const rng = createRng(99)
    for (let round = 0; round < 30; round += 1) {
      controller.zoomBy(rng.range(0.5, 2), Vec2.make(rng.range(0, VIEW.width), rng.range(0, VIEW.height)))
      controller.panBy(rng.range(-40, 40), rng.range(-40, 40))
      // The tilemap cache's fast-path precondition: b and c EXACTLY zero
      // (composition of axis-aligned maps never manufactures rotation), and
      // positive scales (a mirror can't be blitted either).
      expect(stack.camera.b).toBe(0)
      expect(stack.camera.c).toBe(0)
      expect(stack.camera.a).toBeGreaterThan(0)
      expect(stack.camera.d).toBeGreaterThan(0)
    }
  })
})

describe('fitZRange', () => {
  it('the starter world (every layer at elevation 0) fits the [0, 2] floor', () => {
    expect(fitZRange(createStarterWorld())).toEqual([0, 2])
  })

  it('a layer elevated to z = 10 raises the ceiling to match — a 10-slice figure fits whole', () => {
    expect(fitZRange(worldWithElevation(10))).toEqual([0, 10])
  })

  it('the floor of 2 holds for a layer barely above ground', () => {
    expect(fitZRange(worldWithElevation(1))).toEqual([0, 2])
  })

  it('the tallest layer decides, not the last one', () => {
    const doc = createWorld()
    doc.layers.push(createTileLayer({ id: 'low', width: 4, height: 4, elevation: 3, tilesetId: 'none' }))
    doc.layers.push(createTileLayer({ id: 'high', width: 4, height: 4, elevation: 7, tilesetId: 'none' }))
    doc.layers.push(createTileLayer({ id: 'mid', width: 4, height: 4, elevation: 5, tilesetId: 'none' }))
    expect(fitZRange(doc)).toEqual([0, 7])
  })
})

describe('fast channel', () => {
  const readout: CursorReadout = { world: { x: 1, y: 2 }, tile: { tx: 1, ty: 2 }, zoom: 1 }

  it('starts empty, keeps the last readout, and notifies subscribers', () => {
    const channel = createFastChannel()
    expect(channel.last).toBeNull()
    const seen: CursorReadout[] = []
    const unsubscribe = channel.subscribe((r) => seen.push(r))
    channel.publish(readout)
    expect(seen).toEqual([readout])
    expect(channel.last).toBe(readout)
    unsubscribe()
    channel.publish({ world: null, tile: null, zoom: 2 })
    expect(seen).toHaveLength(1)
    expect(channel.last?.zoom).toBe(2)
  })

  it('a throwing listener does not break the others', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const channel = createFastChannel()
      channel.subscribe(() => {
        throw new Error('broken readout panel')
      })
      const seen: CursorReadout[] = []
      channel.subscribe((r) => seen.push(r))
      channel.publish(readout)
      expect(seen).toEqual([readout])
      expect(errors).toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })
})

describe('store builders', () => {
  it('createEditorStore seeds the empty snapshot', () => {
    expect(createEditorStore().getState()).toBe(EMPTY_SNAPSHOT)
  })

  it('MARKER_KINDS is the placer trio plus the built-in figurine', () => {
    expect(MARKER_KINDS).toEqual(['player', 'crate', 'tree', 'pip'])
  })

  it('paletteFromDoc: eraser in slot 0, then the active tileset in order', () => {
    const doc = createStarterWorld()
    const palette = paletteFromDoc(doc, 'ground')
    expect(palette[0]).toEqual({ value: 0, name: 'eraser', color: '#232936' })
    expect(palette[1]).toEqual({ value: 1, name: 'grass', color: '#4a7c3a' })
    expect(palette).toHaveLength(6)
    expect(palette.map((entry) => entry.value)).toEqual([0, 1, 2, 3, 4, 5])
    // No active layer: the honest palette is the eraser alone.
    expect(paletteFromDoc(doc, null)).toEqual([{ value: 0, name: 'eraser', color: '#232936' }])
  })

  it('selectionInfoFromDoc enriches an entity from the CURRENT document', () => {
    const doc = createStarterWorld()
    const info = selectionInfoFromDoc(doc, { kind: 'entity', id: 'e1', point: { x: 16.5, y: 12.5, z: 0 } })
    expect(info).toEqual({
      kind: 'entity',
      id: 'e1',
      name: 'player',
      marker: 'player',
      // The starter player stands on the CENTER of cell (16, 12).
      position: { x: 16.5, y: 12.5 },
      elevation: 0,
    })
    // A stale selection of a vanished entity mirrors as nothing, not a ghost.
    expect(selectionInfoFromDoc(doc, { kind: 'entity', id: 'e999', point: { x: 0, y: 0, z: 0 } })).toBeNull()
  })

  it('selectionInfoFromDoc names a tile through the claiming layer\'s tileset', () => {
    const doc = createStarterWorld()
    const pond = selectionInfoFromDoc(doc, {
      kind: 'tile',
      tile: { layerId: 'ground', tx: 6, ty: 5, elevation: 0 },
    })
    expect(pond).toEqual({
      kind: 'tile',
      tile: { layerId: 'ground', tx: 6, ty: 5, elevation: 0 },
      tileName: 'water',
    })
    const empty = selectionInfoFromDoc(doc, {
      kind: 'tile',
      tile: { layerId: null, tx: -3, ty: 0, elevation: 0 },
    })
    expect(empty).toEqual({
      kind: 'tile',
      tile: { layerId: null, tx: -3, ty: 0, elevation: 0 },
      tileName: null,
    })
  })

  it('entitiesFromDoc lists entities in THE deterministic order', () => {
    expect(entitiesFromDoc(createStarterWorld())).toEqual([{ id: 'e1', name: 'player', marker: 'player' }])
  })
})

// ---------------------------------------------------------------------------
// Viewport pointer discipline (headless: a hand-rolled canvas fake)
// ---------------------------------------------------------------------------

/** The minimal canvas the viewport actually touches: a rect to measure,
 * listener registration, and a capture call that may as well succeed.
 * `fire` invokes the registered handlers — the test's event loop. */
function fakeCanvas(width = 640, height = 420) {
  const handlers = new Map<string, Array<(event: unknown) => void>>()
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    addEventListener(type: string, handler: (event: unknown) => void): void {
      const list = handlers.get(type) ?? []
      list.push(handler)
      handlers.set(type, list)
    },
    removeEventListener(type: string, handler: (event: unknown) => void): void {
      const list = handlers.get(type) ?? []
      const at = list.indexOf(handler)
      if (at >= 0) list.splice(at, 1)
    },
    setPointerCapture(): void {},
    getContext: () => ({}),
  }
  const fire = (type: string, event: Record<string, unknown>): void => {
    for (const handler of [...(handlers.get(type) ?? [])]) handler(event)
  }
  return { canvas: canvas as unknown as HTMLCanvasElement, fire }
}

/** A pointer event literal with quiet defaults. */
function pointerEvent(pointerId: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { pointerId, button: 0, buttons: 1, clientX: 10, clientY: 10, shiftKey: false, ...extra }
}

describe('viewport pointer discipline', () => {
  it('ignores a second pointerdown while a gesture is live — and its up', () => {
    const { canvas, fire } = fakeCanvas()
    const phases: string[] = []
    const vp = createViewport({
      canvas,
      onPointer: (phase) => phases.push(phase),
      onWheel() {},
      onLeave() {},
      onResize() {},
      render() {},
    })

    fire('pointerdown', pointerEvent(1))
    // The second finger: no 'down' reaches the session, and pointer 1 keeps
    // owning the gesture (activePointer is not overwritten).
    fire('pointerdown', pointerEvent(2))
    expect(phases).toEqual(['down'])
    // The second finger's up must not end the FIRST finger's gesture.
    fire('pointerup', pointerEvent(2))
    expect(phases).toEqual(['down'])
    // The first finger's up ends it, exactly once.
    fire('pointerup', pointerEvent(1))
    expect(phases).toEqual(['down', 'up'])
    // Gesture over: the next down is welcome again, whoever it is.
    fire('pointerdown', pointerEvent(2))
    expect(phases).toEqual(['down', 'up', 'down'])
    vp.detach()
  })

  it('pointercancel routes like pointerup: a cancelled finger still ends its gesture', () => {
    const { canvas, fire } = fakeCanvas()
    const phases: string[] = []
    const vp = createViewport({
      canvas,
      onPointer: (phase) => phases.push(phase),
      onWheel() {},
      onLeave() {},
      onResize() {},
      render() {},
    })

    fire('pointerdown', pointerEvent(1))
    // The browser withdraws pointer 1 (system gesture, device removed):
    // its gesture ENDS — otherwise every later pointerdown would be
    // ignored forever by the one-gesture guard.
    fire('pointercancel', pointerEvent(1, { button: -1, buttons: 0 }))
    expect(phases).toEqual(['down', 'up'])
    // And only once: a late pointerup for the same pointer is a no-op.
    fire('pointerup', pointerEvent(1))
    expect(phases).toEqual(['down', 'up'])
    // A fresh gesture starts cleanly after the cancel.
    fire('pointerdown', pointerEvent(3))
    fire('pointerup', pointerEvent(3))
    expect(phases).toEqual(['down', 'up', 'down', 'up'])
    vp.detach()
  })
})

// ---------------------------------------------------------------------------
// Persistence, against in-memory and hostile storage
// ---------------------------------------------------------------------------

/** A friendly in-memory SlotStorage exposing its map for byte inspection. */
function memoryStorage(): SlotStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    read: (key) => map.get(key) ?? null,
    write: (key, value) => {
      map.set(key, value)
    },
    remove: (key) => {
      map.delete(key)
    },
  }
}

describe('persistence glue', () => {
  it('save → boot round-trips the document, with nothing to explain', () => {
    const storage = memoryStorage()
    const doc = createStarterWorld()
    expect(saveDoc(storage, doc)).toEqual({ ok: true })

    const boot = bootDoc(storage)
    expect(boot.usedBackup).toBe(false)
    expect(boot.message).toBeNull()
    expect(boot.world).not.toBeNull()
    if (boot.world !== null) expect(serializeWorld(boot.world)).toBe(serializeWorld(doc))
  })

  it('booting empty storage is a first run, not a problem', () => {
    expect(bootDoc(memoryStorage())).toEqual({ world: null, usedBackup: false, message: null })
  })

  it('a storage that throws on write fails the save and leaves the base untouched', () => {
    const storage = memoryStorage()
    expect(saveDoc(storage, createStarterWorld()).ok).toBe(true)
    const baseBytes = storage.map.get('world')
    expect(baseBytes).toBeDefined()

    const hostile: SlotStorage = {
      read: (key) => storage.read(key),
      write: () => {
        throw new Error('QuotaExceededError')
      },
      remove: (key) => storage.remove(key),
    }
    const renamed = createStarterWorld()
    renamed.meta.name = 'doomed save'
    const outcome = saveDoc(hostile, renamed)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.message.length).toBeGreaterThan(0)
    expect(storage.map.get('world')).toBe(baseBytes)
  })

  it('a rescued boot explains itself in student language', () => {
    const storage = memoryStorage()
    expect(saveDoc(storage, createStarterWorld()).ok).toBe(true)
    // Rot the base copy behind the ceremony's back; the backup slot is only
    // written on the SECOND save, so promote base to backup by saving again
    // first, then corrupt the base.
    expect(saveDoc(storage, createStarterWorld()).ok).toBe(true)
    storage.map.set('world', '{ torn mid-wr')

    const boot = bootDoc(storage)
    expect(boot.world).not.toBeNull()
    expect(boot.usedBackup).toBe(true)
    expect(boot.message).not.toBeNull()
    if (boot.message !== null) {
      expect(boot.message).toContain('backup')
      expect(boot.message).not.toContain('Zod')
      expect(boot.message).not.toMatch(/\n\s+at /)
    }
  })

  it('restoreBackupDoc reads the backup and leaves the base slot bytes untouched', () => {
    const storage = memoryStorage()
    const first = createStarterWorld()
    expect(saveDoc(storage, first).ok).toBe(true)
    const second = createStarterWorld()
    second.meta.name = 'newer world'
    expect(saveDoc(storage, second).ok).toBe(true)

    const baseBytes = storage.map.get('world')
    const restored = restoreBackupDoc(storage)
    expect(restored.ok).toBe(true)
    if (restored.ok) {
      expect(restored.usedBackup).toBe(true)
      // The backup is the PREVIOUS good save, even though the base is healthy.
      expect(restored.world.meta.name).toBe('my first world')
    }
    expect(storage.map.get('world')).toBe(baseBytes)
  })

  it('restoreBackupDoc refuses kindly when no backup exists', () => {
    const outcome = restoreBackupDoc(memoryStorage())
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.message).toContain('backup')
      expect(outcome.message).not.toContain('Zod')
    }
  })

  it('importDoc round-trips exportDoc, and rejects garbage in student language', () => {
    const doc = createStarterWorld()
    const imported = importDoc(exportDoc(doc))
    expect('world' in imported).toBe(true)
    if ('world' in imported) expect(serializeWorld(imported.world)).toBe(serializeWorld(doc))

    const rejected = importDoc('{ "definitely": "not a world')
    expect('message' in rejected).toBe(true)
    if ('message' in rejected) {
      expect(rejected.message.length).toBeGreaterThan(0)
      expect(rejected.message).not.toContain('Zod')
      expect(rejected.message).not.toContain('undefined')
      expect(rejected.message).not.toMatch(/\n\s+at /)
    }
  })
})
