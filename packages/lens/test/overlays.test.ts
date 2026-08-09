/**
 * Overlay rendering, proven headlessly: every test drives drawLensOverlays
 * through the REAL top-down TransformStack (identity camera, scale 1 — so
 * world (x, y, z) lands at screen (x, −y), exact) into the null recording
 * backend, then reads back the command log. What would be drawn is plain
 * data, so the geometry assertions are hand-derived numbers, not screenshots.
 */

import { createWorld, spawn } from '@engine/core'
import type { Entity, World } from '@engine/core'
import { createTopDown, createTransformStack } from '@engine/projection'
import type { WorldPoint } from '@engine/projection'
import { createNullBackend } from '@engine/renderer'
import type { LensOverlaySpec } from '@engine/tutorial'
import { describe, expect, it } from 'vitest'
import { drawLensOverlays } from '../src/overlays'

/** Draw overlays into one recorded frame and return the commands between the
 * begin/end sandwich (the overlay ink and nothing else). The optional
 * entityOverride is the contract's fifth parameter — the editor's mid-drag
 * ghost — passed straight through. */
function draw(
  doc: World,
  overlays: LensOverlaySpec[],
  entityOverride?: { readonly id: string; readonly point: WorldPoint } | null,
): Array<Record<string, unknown>> {
  const backend = createNullBackend()
  const stack = createTransformStack(createTopDown())
  backend.beginFrame({ width: 640, height: 420, dpr: 1 })
  drawLensOverlays(backend, stack, doc, overlays, entityOverride)
  backend.endFrame()
  const frame = backend.frames[0]
  if (frame === undefined) throw new Error('no frame recorded')
  return frame.slice(1, -1) as Array<Record<string, unknown>>
}

function ofKind(commands: Array<Record<string, unknown>>, kind: string): Array<Record<string, unknown>> {
  return commands.filter((command) => command['kind'] === kind)
}

/** Point-list equality within 1e-9 — tight enough to pin the arithmetic,
 * loose enough to ignore float dust (and the −0 that y-flipping y = 0 makes). */
function expectPoints(actual: unknown, expected: Array<{ x: number; y: number }>): void {
  const points = actual as Array<{ x: number; y: number }>
  expect(points).toHaveLength(expected.length)
  for (const [i, want] of expected.entries()) {
    expect(points[i]!.x).toBeCloseTo(want.x, 9)
    expect(points[i]!.y).toBeCloseTo(want.y, 9)
  }
}

function spawnMarker(doc: World, kind: string, x: number, y: number, z = 0): Entity {
  return spawn(doc, {
    name: kind,
    components: { marker: { kind }, position: { x, y }, elevation: { z } },
  })
}

describe('cell-highlight', () => {
  it('emits one closed 4-point polyline at the projected ground corners', () => {
    const commands = draw(createWorld(), [{ kind: 'cell-highlight', tx: 2, ty: 3 }])
    expect(commands).toHaveLength(1)
    const [outline] = ofKind(commands, 'polyline')
    expect(outline).toMatchObject({ closed: true, stroke: '#ffd166', lineWidth: 2.5 })
    // Cell (2, 3), tileSize 1, z 0: corners (2,3) (3,3) (3,4) (2,4) → y-flip.
    expectPoints(outline!['points'], [
      { x: 2, y: -3 },
      { x: 3, y: -3 },
      { x: 3, y: -4 },
      { x: 2, y: -4 },
    ])
  })

  it('scales cell corners by the document tileSize', () => {
    const doc = createWorld({ settings: { tileSize: 2 } })
    const commands = draw(doc, [{ kind: 'cell-highlight', tx: 2, ty: 3 }])
    expectPoints(commands[0]!['points'], [
      { x: 4, y: -6 },
      { x: 6, y: -6 },
      { x: 6, y: -8 },
      { x: 4, y: -8 },
    ])
  })
})

describe('marker resolution', () => {
  it('draws at the entity LIVE position: mutate, draw again, the ring moved', () => {
    const doc = createWorld()
    const player = spawnMarker(doc, 'player', 1, 2)

    const before = ofKind(draw(doc, [{ kind: 'entity-highlight', marker: 'player' }]), 'circle')
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ x: 1, y: -2, radius: 14, stroke: '#ffd166', lineWidth: 2.5 })

    const position = player.components['position'] as { x: number; y: number }
    position.x = 5
    position.y = 6
    const after = ofKind(draw(doc, [{ kind: 'entity-highlight', marker: 'player' }]), 'circle')
    expect(after[0]).toMatchObject({ x: 5, y: -6 })
  })

  it('an unresolvable marker draws nothing this frame — no half-drawn pictures', () => {
    const doc = createWorld() // nobody home: every marker reference dangles
    const commands = draw(doc, [
      { kind: 'entity-highlight', marker: 'ghost' },
      { kind: 'arrow', from: { marker: 'ghost' }, to: { x: 1, y: 1 } },
      { kind: 'right-triangle', a: { marker: 'ghost' }, b: { x: 0, y: 0 } },
    ])
    expect(commands).toHaveLength(0)
  })
})

describe('arrow', () => {
  it('emits shaft + two head strokes, head geometry hand-derived without trig', () => {
    // World (0,0) → (3,4): screen (0,0) → (3,−4), length 5.
    // dir = (0.6, −0.8); perp = (−dir.y, dir.x) = (0.8, 0.6).
    // base = tip − 12·dir = (3 − 7.2, −4 + 9.6) = (−4.2, 5.6)
    // wings = base ± 5·perp = (−0.2, 8.6) and (−8.2, 2.6)
    const commands = draw(createWorld(), [
      { kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 3, y: 4 }, label: 'v' },
    ])
    const lines = ofKind(commands, 'polyline')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ stroke: '#8ab4ff', lineWidth: 2.5 })
    expectPoints(lines[0]!['points'], [
      { x: 0, y: 0 },
      { x: 3, y: -4 },
    ])
    expectPoints(lines[1]!['points'], [
      { x: -0.2, y: 8.6 },
      { x: 3, y: -4 },
    ])
    expectPoints(lines[2]!['points'], [
      { x: -8.2, y: 2.6 },
      { x: 3, y: -4 },
    ])

    // Label: midpoint (1.5, −2) stepped 10px along perp → (9.5, 4).
    const labels = ofKind(commands, 'text')
    expect(labels).toHaveLength(1)
    expect(labels[0]!['text']).toBe('v')
    expect(labels[0]!['x'] as number).toBeCloseTo(9.5, 9)
    expect(labels[0]!['y'] as number).toBeCloseTo(4, 9)
  })
})

describe('right-triangle', () => {
  it('labels the classroom 3-4-5 placement "3", "4", "5" by measurement alone', () => {
    const doc = createWorld()
    spawnMarker(doc, 'player', 16.5, 12.5)
    spawnMarker(doc, 'crate', 19.5, 16.5)
    const commands = draw(doc, [
      { kind: 'right-triangle', a: { marker: 'player' }, b: { marker: 'crate' } },
    ])

    const lines = ofKind(commands, 'polyline')
    const labels = ofKind(commands, 'text')
    expect(lines).toHaveLength(3)
    expect(labels).toHaveLength(3)

    // Screen: a = (16.5, −12.5), b = (19.5, −16.5), corner = (19.5, −12.5).
    expect(lines[0]).toMatchObject({ stroke: '#4ade80', lineWidth: 2.5 }) // east leg
    expectPoints(lines[0]!['points'], [
      { x: 16.5, y: -12.5 },
      { x: 19.5, y: -12.5 },
    ])
    expect(lines[1]).toMatchObject({ stroke: '#4ade80', lineWidth: 2.5 }) // north leg
    expectPoints(lines[1]!['points'], [
      { x: 19.5, y: -12.5 },
      { x: 19.5, y: -16.5 },
    ])
    expect(lines[2]).toMatchObject({ stroke: '#ffd166', lineWidth: 3 }) // hypotenuse
    expectPoints(lines[2]!['points'], [
      { x: 16.5, y: -12.5 },
      { x: 19.5, y: -16.5 },
    ])

    expect(labels.map((label) => label['text'])).toEqual(['3', '4', '5'])
  })

  it('honors explicit labels, including a partial override', () => {
    const doc = createWorld()
    const full = draw(doc, [
      {
        kind: 'right-triangle',
        a: { x: 0, y: 0 },
        b: { x: 3, y: 4 },
        labels: { dx: 'Δx', dy: 'Δy', hypotenuse: 'c' },
      },
    ])
    expect(ofKind(full, 'text').map((label) => label['text'])).toEqual(['Δx', 'Δy', 'c'])

    const partial = draw(doc, [
      { kind: 'right-triangle', a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, labels: { hypotenuse: 'c' } },
    ])
    expect(ofKind(partial, 'text').map((label) => label['text'])).toEqual(['3', '4', 'c'])
  })

  it('a collapsed due-east pair keeps the hypotenuse label clear of the leg labels', () => {
    // Lesson-02's authored ENTRY state: the crate due EAST of the player.
    // The triangle degenerates to a line — the right-angle corner coincides
    // with the crate and the hypotenuse lies exactly on the east leg. The
    // flip test's ≥ breaks the zero-dot tie toward flipping, sending the
    // hypotenuse label to the line's OTHER side (screen-up) while the dx
    // label sits below it and the dy label off to the right: three labels,
    // no overprint, even with no triangle left to point at.
    const doc = createWorld()
    spawnMarker(doc, 'player', 16.5, 12.5)
    spawnMarker(doc, 'crate', 19.5, 12.5)
    const commands = draw(doc, [
      { kind: 'right-triangle', a: { marker: 'player' }, b: { marker: 'crate' } },
    ])
    const labels = ofKind(commands, 'text')
    expect(labels.map((label) => label['text'])).toEqual(['3', '0', '3'])

    // The collapsed line sits at screen y −12.5. The dx label hangs LABEL_LIFT
    // below it; the hypotenuse label steps LABEL_PERP_OFFSET above it —
    // opposite sides, and at least the 10px label offset apart from BOTH leg
    // labels (the dy label rides the line itself, at the coincident corner).
    const [dxLabel, dyLabel, hypLabel] = labels
    expect(dxLabel!['y'] as number).toBeCloseTo(-12.5 + 6, 9)
    expect(dyLabel!['y'] as number).toBeCloseTo(-12.5, 9)
    expect(hypLabel!['y'] as number).toBeCloseTo(-12.5 - 10, 9)
    expect(Math.abs((hypLabel!['y'] as number) - (dxLabel!['y'] as number))).toBeGreaterThanOrEqual(10)
    expect(Math.abs((hypLabel!['y'] as number) - (dyLabel!['y'] as number))).toBeGreaterThanOrEqual(10)
  })

  it('formats measured labels to 2 decimals with trailing zeros dropped', () => {
    const doc = createWorld()
    // 1.5-2-2.5: every value exact, one with a genuine decimal to keep.
    const exact = draw(doc, [{ kind: 'right-triangle', a: { x: 0, y: 0 }, b: { x: 1.5, y: 2 } }])
    expect(ofKind(exact, 'text').map((label) => label['text'])).toEqual(['1.5', '2', '2.5'])

    // 3-3-√18: the hypotenuse rounds to 4.24 and keeps both decimals.
    const rounded = draw(doc, [{ kind: 'right-triangle', a: { x: 0, y: 0 }, b: { x: 3, y: 3 } }])
    expect(ofKind(rounded, 'text').map((label) => label['text'])).toEqual(['3', '3', '4.24'])
  })
})

describe('entity override — the editor drag ghost', () => {
  it('moves marker-resolved triangle and arrow endpoints to the override point', () => {
    // Mid-drag, the crate's COMMITTED components still say (19.5, 16.5); the
    // student is looking at a ghost at (10, 8). The override makes marker
    // resolution see the ghost too, so the whole distance picture — legs,
    // corner, hypotenuse, arrow tip, and the measured labels — moves with
    // the drag. This is lesson-02's flagship moment.
    const doc = createWorld()
    spawnMarker(doc, 'player', 16.5, 12.5)
    const crate = spawnMarker(doc, 'crate', 19.5, 16.5)
    const specs: LensOverlaySpec[] = [
      { kind: 'right-triangle', a: { marker: 'player' }, b: { marker: 'crate' } },
      { kind: 'arrow', from: { marker: 'player' }, to: { marker: 'crate' } },
    ]
    const commands = draw(doc, specs, { id: crate.id, point: { x: 10, y: 8, z: 0 } })
    const lines = ofKind(commands, 'polyline')
    expect(lines).toHaveLength(6) // 3 triangle sides + shaft + 2 head strokes

    // Triangle at the GHOST: a = (16.5, −12.5) untouched; b and the corner
    // (b.x, a.y) both moved to the override's coordinates.
    expectPoints(lines[0]!['points'], [
      { x: 16.5, y: -12.5 },
      { x: 10, y: -12.5 },
    ])
    expectPoints(lines[1]!['points'], [
      { x: 10, y: -12.5 },
      { x: 10, y: -8 },
    ])
    expectPoints(lines[2]!['points'], [
      { x: 16.5, y: -12.5 },
      { x: 10, y: -8 },
    ])
    // The labels re-measure against the ghost: dx 6.5, dy 4.5, √62.5 → 7.91.
    expect(ofKind(commands, 'text').map((label) => label['text'])).toEqual(['6.5', '4.5', '7.91'])

    // The arrow's shaft ends on the ghost too.
    expectPoints(lines[3]!['points'], [
      { x: 16.5, y: -12.5 },
      { x: 10, y: -8 },
    ])
  })

  it('an override for an entity the marker did not resolve changes nothing', () => {
    // Two crates: entityIds order makes the FIRST the marker's referent. An
    // override carrying the second crate's id must change nothing — the
    // override substitutes a point for the referent, it never re-elects one.
    const doc = createWorld()
    spawnMarker(doc, 'player', 16.5, 12.5)
    spawnMarker(doc, 'crate', 19.5, 16.5)
    const bystander = spawnMarker(doc, 'crate', 3, 3)
    const specs: LensOverlaySpec[] = [
      { kind: 'right-triangle', a: { marker: 'player' }, b: { marker: 'crate' } },
      { kind: 'entity-highlight', marker: 'crate' },
    ]
    const plain = draw(doc, specs)
    const overridden = draw(doc, specs, { id: bystander.id, point: { x: 10, y: 8, z: 0 } })
    expect(overridden).toEqual(plain)
  })
})
