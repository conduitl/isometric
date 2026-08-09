/*
 * THE PHASE GATE: 500 interleaved commands vs a replay oracle
 * (docs/ARCHITECTURE.md §6, docs/ROADMAP.md Phase 2).
 *
 * The claim under test: after ANY interleaving of entity commands, brush
 * strokes, undo, redo, and save-load round-trips, the live document equals
 * what you get by replaying just the CURRENTLY-EFFECTIVE operations from
 * the last save-load point. If undo/redo bookkeeping ever drifts — a patch
 * applied twice, a stroke run half-reverted, a redo stack not cleared —
 * the two documents diverge and the byte comparison catches it.
 *
 * The oracle is deliberately dumber than the bus: it keeps the serialized
 * text of the last save-load point (the baseline) plus a list of committed
 * ops. Undo moves the newest op to a redo buffer; redo moves it back; a
 * new commit empties the buffer. To check, it parses the baseline FRESH
 * (new objects, new Uint16Arrays — no shared state with the live doc) and
 * replays the ops through a second, independent bus. Replay mints the same
 * entity ids because ids come from the document's own nextEntityId counter
 * — and undo rewinds that counter via inverse patches (docs/DECISIONS.md
 * D2 is what makes a command log replayable at all).
 *
 * The whole fuzz also runs TWICE with one seed: the substrate itself must
 * be deterministic, or none of the other guarantees are testable.
 */

import { createWorld, entityIds, spawn } from '@engine/core'
import type { EntityId, World } from '@engine/core'
import { createRng } from '@engine/math'
import type { Rng } from '@engine/math'
import { createTileLayer } from '@engine/tilemap'
import { parseWorld, serializeWorld } from '@engine/world-format'
import { describe, expect, it } from 'vitest'
import { createCommandBus } from '../src/editor/commands/bus'
import type { BuilderEvent } from '../src/editor/events/builder'
import type { CommandBus, DocumentHost, EditorCommand } from '../src/editor/types'

// --- rig -------------------------------------------------------------------

interface Rig {
  readonly host: DocumentHost
  readonly bus: CommandBus
  /** Events emitted by the LAST dispatch/stroke — the applied/no-op tell. */
  readonly emitted: BuilderEvent[]
}

function createRig(initial: World): Rig {
  let doc = initial
  const emitted: BuilderEvent[] = []
  const host: DocumentHost = {
    get doc() {
      return doc
    },
    replaceDoc(next: World) {
      doc = next
    },
    tilesTouched() {},
  }
  const bus = createCommandBus({ host, emit: (event) => emitted.push(event) })
  return { host, bus, emitted }
}

/** The deterministic starting world: two layers (different sizes and
 * storeys), a five-tile tileset, two marker entities. */
function startWorld(): World {
  const world = createWorld({ name: 'fuzz world', settings: { seed: 77 } })
  world.tilesets.push({
    id: 'terrain',
    name: 'terrain',
    tiles: [
      { name: 'grass', colors: { top: '#4caf50' } },
      { name: 'water', colors: { top: '#2196f3' } },
      { name: 'sand', colors: { top: '#ffe082' } },
      { name: 'stone', colors: { top: '#9e9e9e' } },
      { name: 'path', colors: { top: '#bcaaa4' } },
    ],
  })
  world.layers.push(createTileLayer({ id: 'ground', width: 20, height: 14, tilesetId: 'terrain' }))
  world.layers.push(
    createTileLayer({ id: 'upper', width: 10, height: 8, elevation: 1, layerBand: 1, tilesetId: 'terrain' }),
  )
  spawn(world, {
    name: 'player',
    components: { position: { x: 10, y: 7 }, elevation: { z: 0 }, marker: { kind: 'player' } },
  })
  spawn(world, {
    name: 'crate',
    components: { position: { x: 4, y: 3 }, elevation: { z: 0 }, marker: { kind: 'crate' } },
  })
  return world
}

// --- the oracle's op log ---------------------------------------------------

type EffectiveOp =
  | { readonly kind: 'command'; readonly command: EditorCommand }
  | {
      readonly kind: 'stroke'
      readonly layerId: string
      readonly tile: number
      /** EVERY paint call of the gesture, replayed verbatim — the no-op and
       * out-of-bounds paints must no-op identically on replay. */
      readonly cells: ReadonlyArray<{ readonly tx: number; readonly ty: number }>
    }

/** Parse the baseline fresh and replay the effective ops through an
 * independent bus. Returns the oracle's document. */
function replayOps(baselineText: string, ops: ReadonlyArray<EffectiveOp>): World {
  const parsed = parseWorld(baselineText)
  if (!parsed.ok) throw new Error(`oracle baseline failed to parse: ${parsed.error.message}`)
  const rig = createRig(parsed.world)
  for (const op of ops) {
    if (op.kind === 'command') {
      const result = rig.bus.dispatch(op.command)
      if (!result.ok) {
        throw new Error(`oracle replay rejected a committed command: ${result.reason}`)
      }
    } else {
      const stroke = rig.bus.beginTileStroke(op.layerId, op.tile)
      if (stroke === null) throw new Error(`oracle replay lost layer "${op.layerId}"`)
      for (const cell of op.cells) stroke.paint(cell.tx, cell.ty)
      stroke.end()
    }
  }
  return rig.host.doc
}

// --- fuzz generation -------------------------------------------------------

const MARKERS = ['player', 'crate', 'tree'] as const
const NAMES = ['scout', 'boulder', 'old oak', 'door', 'chest', 'lantern'] as const

function randomEntityId(rng: Rng, doc: World): EntityId | null {
  const ids = entityIds(doc)
  if (ids.length === 0) return null
  return ids[rng.int(0, ids.length)] as EntityId
}

function randomPlace(rng: Rng): EditorCommand {
  const marker = MARKERS[rng.int(0, MARKERS.length)] as string
  const named = rng.next() < 0.3
  return {
    kind: 'place-entity',
    marker,
    ...(named ? { name: NAMES[rng.int(0, NAMES.length)] as string } : {}),
    position: { x: rng.int(0, 20), y: rng.int(0, 14) },
    elevation: rng.int(0, 3),
  }
}

/** One random command against the CURRENT document. Falls back to placing
 * when an entity is needed and none exist. May generate no-ops (moving to
 * the same cell, renaming to the same name) — deliberately, because the
 * bus must not record those and the oracle must agree. */
function randomCommand(rng: Rng, doc: World, roll: number): EditorCommand {
  if (roll < 0.32) return randomPlace(rng)
  const id = randomEntityId(rng, doc)
  if (id === null) return randomPlace(rng)
  if (roll < 0.62) {
    const withElevation = rng.next() < 0.4
    return {
      kind: 'move-entity',
      id,
      to: { x: rng.int(0, 20), y: rng.int(0, 14) },
      ...(withElevation ? { toElevation: rng.int(0, 3) } : {}),
    }
  }
  if (roll < 0.84) {
    return { kind: 'rename-entity', id, name: NAMES[rng.int(0, NAMES.length)] as string }
  }
  return { kind: 'delete-entity', id }
}

// --- the fuzz itself -------------------------------------------------------

const STEP_COUNT = 500

/**
 * Run the whole 500-step fuzz for one seed, checking the oracle every 25
 * steps and at the end. Returns the final canonical serialization so the
 * determinism test can compare two runs.
 */
function runFuzz(seed: number): string {
  const rng = createRng(seed)
  let live = createRig(startWorld())
  let baseline = serializeWorld(live.host.doc)
  let effective: EffectiveOp[] = []
  let redoBuffer: EffectiveOp[] = []

  const checkOracle = (): void => {
    const oracleDoc = replayOps(baseline, effective)
    expect(serializeWorld(oracleDoc)).toBe(serializeWorld(live.host.doc))
  }

  for (let step = 1; step <= STEP_COUNT; step += 1) {
    const roll = rng.next()

    if (roll < 0.44) {
      // --- entity/settings command (place/move/rename/delete) ---
      const command = randomCommand(rng, live.host.doc, roll / 0.44)
      live.emitted.length = 0
      const result = live.bus.dispatch(command)
      expect(result.ok).toBe(true) // generation only produces valid requests
      if (live.emitted.length > 0) {
        // Applied (a no-op emits nothing and must not enter the log).
        effective.push({ kind: 'command', command })
        redoBuffer = []
      }
    } else if (roll < 0.47) {
      // --- rename-world ---
      const command: EditorCommand = {
        kind: 'rename-world',
        name: `world ${NAMES[rng.int(0, NAMES.length)] as string}`,
      }
      live.emitted.length = 0
      const result = live.bus.dispatch(command)
      expect(result.ok).toBe(true)
      if (live.emitted.length > 0) {
        effective.push({ kind: 'command', command })
        redoBuffer = []
      }
    } else if (roll < 0.69) {
      // --- one brush stroke: a random walk, occasionally cancelled ---
      const layers = live.host.doc.layers
      const layer = layers[rng.int(0, layers.length)]
      if (layer === undefined) throw new Error('fuzz world lost its layers')
      const tile = rng.int(0, 6) // 0 = eraser, 1..5 = the terrain tiles
      const cells: Array<{ tx: number; ty: number }> = []
      // Start sometimes just outside the layer so out-of-bounds paints are
      // part of the fuzz, and walk one king-move at a time.
      let tx = rng.int(-1, layer.width + 1)
      let ty = rng.int(-1, layer.height + 1)
      const walkLength = rng.int(1, 13)
      for (let i = 0; i < walkLength; i += 1) {
        cells.push({ tx, ty })
        tx += rng.int(-1, 2)
        ty += rng.int(-1, 2)
      }
      const cancel = rng.next() < 0.15
      live.emitted.length = 0
      const stroke = live.bus.beginTileStroke(layer.id, tile)
      if (stroke === null) throw new Error(`fuzz lost layer "${layer.id}"`)
      for (const cell of cells) stroke.paint(cell.tx, cell.ty)
      if (cancel) {
        stroke.cancel() // cancelled gestures never happened — not logged
      } else {
        stroke.end()
        if (live.emitted.length > 0) {
          // ≥1 cell actually changed → exactly one committed history entry.
          effective.push({ kind: 'stroke', layerId: layer.id, tile, cells })
          redoBuffer = []
        }
      }
    } else if (roll < 0.83) {
      // --- undo ---
      const label = live.bus.undo()
      if (label === null) {
        expect(effective).toHaveLength(0)
      } else {
        const op = effective.pop()
        if (op === undefined) throw new Error('bus undid something the oracle never logged')
        redoBuffer.push(op)
      }
    } else if (roll < 0.93) {
      // --- redo ---
      const label = live.bus.redo()
      if (label === null) {
        expect(redoBuffer).toHaveLength(0)
      } else {
        const op = redoBuffer.pop()
        if (op === undefined) throw new Error('bus redid something the oracle never buffered')
        effective.push(op)
      }
    } else {
      // --- save-load round-trip: serialize → parse → adopt the PARSED doc
      // as the live doc via a fresh host, history cleared — mirroring what
      // session.loadWorld will do. The oracle's baseline resets with it. ---
      const text = serializeWorld(live.host.doc)
      const parsed = parseWorld(text)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw new Error('fuzz save-load failed to parse its own save')
      live = createRig(parsed.world)
      live.bus.clearHistory() // a fresh bus is already empty; loadWorld clears anyway
      baseline = text
      effective = []
      redoBuffer = []
    }

    if (step % 25 === 0) checkOracle()
  }

  checkOracle()
  return serializeWorld(live.host.doc)
}

// --- the gate --------------------------------------------------------------

describe('the 500-command fuzz vs the replay oracle (Phase 2 gate)', () => {
  it('agrees with the oracle at every 25-step checkpoint and at the end', () => {
    runFuzz(0x20260808)
  })

  it('a second seed, for luck (different interleaving, same law)', () => {
    runFuzz(424242)
  })

  it('the substrate itself is deterministic: same seed, same final bytes', () => {
    const first = runFuzz(7)
    const second = runFuzz(7)
    expect(second).toBe(first)
  })
})
