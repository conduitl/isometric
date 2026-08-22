/**
 * The overlay renderer — the math pictures a lesson draws on top of the scene.
 *
 * Everything here obeys the package's two rules (see types.ts): overlays are
 * drawn through the SAME public seams every scene render uses — RendererBackend
 * commands for ink, TransformStack.worldToScreen for geometry — and the specs
 * being drawn are data authored in lessons (@engine/tutorial), never code. The
 * caller hands us an already-open frame (the scene painted first, then us on
 * top), so this module never calls beginFrame/endFrame; it only adds ink.
 *
 * ## Resolution before drawing
 *
 * A spec endpoint is either a fixed world point or a `{ marker }` reference.
 * Marker references resolve against the LIVE document at draw time: the first
 * entity, in the engine's one deterministic order (entityIds), whose
 * `marker.kind` matches. That "at draw time" is the pedagogy — the triangle
 * between player and crate follows the crate through a drag, so the student
 * watches 3-4-5 stop being 3-4-5 the moment the crate moves. An endpoint that
 * resolves to nothing makes its WHOLE overlay draw nothing this frame:
 * entities come and go, and a half-drawn triangle would lie.
 *
 * One more voice in resolution: the caller's entityOverride (the editor's
 * mid-drag ghost). While a drag is live the referent's COMMITTED components
 * still hold the old position — the student is looking at the preview. If
 * marker resolution read only the components, the triangle would sit frozen
 * on the stale point until pointer-up and the "watch the numbers move while
 * you drag" moment would never happen. So when the marker-resolved entity's
 * id matches the override, the override point wins — the same substitution
 * the scene renderer makes for the marker dot itself, so lesson ink and
 * ghost always agree about where the entity is.
 *
 * ## The no-trig arrowhead (a small lesson in itself)
 *
 * An arrowhead looks like it needs an angle — atan2, then two rotated
 * strokes. It never does. Normalize the shaft's screen direction
 * `dir = (to − from) / |to − from|`, take its perpendicular
 * `perp = (−dir.y, dir.x)` (perpendicular because the dot product
 * dir·perp = −dx·dy + dy·dx = 0 — rotation by 90° is just a coordinate
 * swap-and-negate), and the two wing points are pure arithmetic:
 *
 *     wing = tip − HEAD_LENGTH·dir ± HEAD_HALF_WIDTH·perp
 *
 * Walk back along the shaft, step out sideways. No angle was ever needed —
 * which is exactly why raw trig is banned out here and nothing breaks.
 *
 * ## Labels
 *
 * The backend's text command has no halo/outline support, so labels rely on
 * color contrast alone (light ink over the dark viewport family) — a dark
 * halo is a nice-to-have for a future backend rev, noted and skipped.
 */

import type { Entity, World } from '@engine/core'
import { entityIds } from '@engine/core'
import type { Vec2 } from '@engine/math'
import type { TransformStack, WorldPoint } from '@engine/projection'
import type { RendererBackend } from '@engine/renderer'
import type { LensOverlaySpec, OverlayPoint } from '@engine/tutorial'
import type { DrawLensOverlays } from './types'

// --- The v1 overlay palette — the editor's existing family, reused so lesson
// ink reads as part of the same instrument, not a sticker on top. -----------

/** Attention gold — the editor's keyboard-cursor color; highlights + hypotenuse. */
const ACCENT = '#ffd166'
/** Selection blue — the editor's selection stroke; arrows point, they don't alarm. */
const ARROW_COLOR = '#8ab4ff'
/** Marker green — the editor's tree-marker fill; the two measured ground legs. */
const LEG_COLOR = '#4ade80'
/** The editor's label ink — readable on the deep-navy viewport. */
const LABEL_COLOR = '#e4eaf4'
/** One point larger than the editor's 11px marker font: lesson text leads. */
const LABEL_FONT = '12px ui-monospace, monospace'

/** Outline/ring/leg stroke width — heavier than scene furniture (1–2) on purpose. */
const STROKE_WIDTH = 2.5
/** The hypotenuse is the star of the distance picture; slightly heavier still. */
const HYPOTENUSE_WIDTH = 3
/** Entity ring radius in CSS px — clears the editor's 7px marker dot + its label. */
const RING_RADIUS = 14
/** Arrowhead: walk this far back along the shaft… */
const HEAD_LENGTH = 12
/** …then step this far out to each side. */
const HEAD_HALF_WIDTH = 5
/** Breathing room between a shape and its label, in CSS px. */
const LABEL_LIFT = 6
/** How far a midpoint label steps off its line, along the perpendicular. */
const LABEL_PERP_OFFSET = 10
/** Below this many screen px, a direction has no direction. */
const EPSILON = 1e-9

/**
 * Read an entity's place in the world from its components — position gives
 * ground (x, y), elevation gives z, missing z means standing on the ground.
 * Components are opaque blobs at this boundary, so every field is checked
 * before it is believed. (Pattern copied from the editor's picking module,
 * apps/editor/src/editor/picking.ts `entityWorldPoint` — same defensive
 * reads, same "no readable position means not in the world's geometry".)
 */
function entityPoint(entity: Entity): WorldPoint | null {
  const position = entity.components['position']
  if (position === null || typeof position !== 'object') return null
  const { x, y } = position as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number') return null

  let z = 0
  const elevation = entity.components['elevation']
  if (elevation !== null && typeof elevation === 'object') {
    const raw = (elevation as { z?: unknown }).z
    if (typeof raw === 'number') z = raw
  }
  return { x, y, z }
}

/** The caller's mid-drag substitution, normalized: draw THIS entity THERE.
 * (The optional/nullable fifth parameter of the DrawLensOverlays contract,
 * collapsed to plain null-or-value before any resolution happens.) */
type EntityOverride = { readonly id: string; readonly point: WorldPoint } | null

/**
 * Resolve one spec endpoint to a world point, or null for "draws nothing this
 * frame". Fixed points pass through (z defaults to 0 — the ground). A marker
 * reference takes the FIRST entity in entityIds order whose `marker.kind`
 * matches; if that referent has no readable position the answer is null, not
 * "keep scanning" — the first match IS the referent, and a referent without
 * geometry is honestly unresolvable.
 *
 * The override speaks LAST, and only about the referent: once the marker has
 * picked its entity, an override carrying that entity's id substitutes the
 * drag ghost's point for the committed components (see the header essay).
 * An override for any OTHER entity changes nothing — resolution still
 * belongs to the marker, never to whoever happens to be mid-drag.
 */
function resolvePoint(doc: World, point: OverlayPoint, override: EntityOverride): WorldPoint | null {
  if ('marker' in point) {
    for (const id of entityIds(doc)) {
      const entity = doc.entities[id]
      if (entity === undefined) continue
      const marker = entity.components['marker']
      if (marker === null || typeof marker !== 'object') continue
      if ((marker as { kind?: unknown }).kind !== point.marker) continue
      if (override !== null && override.id === id) return override.point
      return entityPoint(entity)
    }
    return null
  }
  return { x: point.x, y: point.y, z: point.z ?? 0 }
}

/**
 * Print a measured number the way a student would write it: rounded to two
 * decimals, trailing zeros dropped. 3 → '3', 4.2 → '4.2', √18 → '4.24' —
 * so the 3-4-5 triangle labels itself "3, 4, 5", not "3.00, 4.00, 5.00".
 */
function formatMeasure(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '')
}

/** One label, house font and ink. */
function drawLabel(
  backend: RendererBackend,
  x: number,
  y: number,
  text: string,
  align: 'left' | 'center' | 'right',
  baseline: 'top' | 'middle' | 'alphabetic',
): void {
  backend.drawText({ x, y, text, fill: LABEL_COLOR, font: LABEL_FONT, align, baseline })
}

/**
 * The cell's outline at its ELEVATION — four corners at `spec.z ?? 0`
 * (default the ground), tileSize from the doc's settings, projected and
 * closed. (Corner walk copied from the editor's `tileOutline` in
 * apps/editor/src/editor/render.ts, ground branch: the same four corners
 * that top-down turns into a square and iso into a 2:1 diamond — that this
 * code cannot tell which IS the lesson.) A raised `z` rings the top face of
 * a slab or a voxel slice, not a phantom outline on the floor beneath it.
 * The optional label sits above the outline in screen space: centered on
 * the corners' centroid, lifted past their topmost projected point.
 */
function drawCellHighlight(
  backend: RendererBackend,
  stack: TransformStack,
  tileSize: number,
  spec: Extract<LensOverlaySpec, { kind: 'cell-highlight' }>,
): void {
  const x0 = spec.tx * tileSize
  const x1 = (spec.tx + 1) * tileSize
  const y0 = spec.ty * tileSize
  const y1 = (spec.ty + 1) * tileSize
  const z = spec.z ?? 0
  const corners: WorldPoint[] = [
    { x: x0, y: y0, z },
    { x: x1, y: y0, z },
    { x: x1, y: y1, z },
    { x: x0, y: y1, z },
  ]
  const points = corners.map((corner) => stack.worldToScreen(corner))
  backend.drawPolyline({ points, stroke: ACCENT, lineWidth: STROKE_WIDTH, closed: true })

  if (spec.label !== undefined) {
    let sumX = 0
    let minY = Infinity
    for (const p of points) {
      sumX += p.x
      if (p.y < minY) minY = p.y
    }
    drawLabel(backend, sumX / points.length, minY - LABEL_LIFT, spec.label, 'center', 'alphabetic')
  }
}

/** A gold ring at the resolved entity's projected point, label above. */
function drawEntityHighlight(
  backend: RendererBackend,
  stack: TransformStack,
  doc: World,
  spec: Extract<LensOverlaySpec, { kind: 'entity-highlight' }>,
  override: EntityOverride,
): void {
  const point = resolvePoint(doc, { marker: spec.marker }, override)
  if (point === null) return
  const s = stack.worldToScreen(point)
  backend.drawCircle({ x: s.x, y: s.y, radius: RING_RADIUS, stroke: ACCENT, lineWidth: STROKE_WIDTH })
  if (spec.label !== undefined) {
    drawLabel(backend, s.x, s.y - RING_RADIUS - LABEL_LIFT, spec.label, 'center', 'alphabetic')
  }
}

/**
 * A labeled arrow: shaft, then the trig-free arrowhead of the header essay —
 * two short strokes from `tip − HEAD_LENGTH·dir ± HEAD_HALF_WIDTH·perp` back
 * to the tip. A zero-length arrow draws nothing at all: with no direction
 * there is no head, and a headless dot would not be an arrow.
 */
function drawArrow(
  backend: RendererBackend,
  stack: TransformStack,
  doc: World,
  spec: Extract<LensOverlaySpec, { kind: 'arrow' }>,
  override: EntityOverride,
): void {
  const fromWorld = resolvePoint(doc, spec.from, override)
  const toWorld = resolvePoint(doc, spec.to, override)
  if (fromWorld === null || toWorld === null) return

  const from = stack.worldToScreen(fromWorld)
  const tip = stack.worldToScreen(toWorld)
  const dx = tip.x - from.x
  const dy = tip.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < EPSILON) return

  // Normalize, then rotate 90° by swap-and-negate — see the header essay.
  const dirX = dx / length
  const dirY = dy / length
  const perpX = -dirY
  const perpY = dirX

  backend.drawPolyline({ points: [from, tip], stroke: ARROW_COLOR, lineWidth: STROKE_WIDTH })

  const baseX = tip.x - HEAD_LENGTH * dirX
  const baseY = tip.y - HEAD_LENGTH * dirY
  for (const side of [1, -1]) {
    const wing: Vec2 = { x: baseX + side * HEAD_HALF_WIDTH * perpX, y: baseY + side * HEAD_HALF_WIDTH * perpY }
    backend.drawPolyline({ points: [wing, tip], stroke: ARROW_COLOR, lineWidth: STROKE_WIDTH })
  }

  if (spec.label !== undefined) {
    drawLabel(
      backend,
      (from.x + tip.x) / 2 + perpX * LABEL_PERP_OFFSET,
      (from.y + tip.y) / 2 + perpY * LABEL_PERP_OFFSET,
      spec.label,
      'center',
      'middle',
    )
  }
}

/**
 * The distance picture: east leg a→(b.x, a.y), north leg (b.x, a.y)→b, and
 * the hypotenuse a→b — exactly three polylines, exactly three labels.
 *
 * HONESTY BOX — the triangle draws on the plane z = a.z, both endpoints
 * flattened onto it. v1 lessons run on flat ground where a.z = b.z = 0 and
 * this is simply the true ground-plane picture; when a and b genuinely differ
 * in elevation the ground triangle is only two legs of a THREE-dimensional
 * story, and the honest general drawing (a second right triangle standing on
 * the hypotenuse) waits for the elevation lessons that need it.
 *
 * Default labels are the MEASURED values — |b.x − a.x|, |b.y − a.y|, and the
 * hypotenuse √(dx² + dy²) — printed via formatMeasure, so the classroom
 * placement labels itself "3, 4, 5" with nobody typing those strings. The dx
 * label sits below its leg's midpoint, dy to the right of its leg's midpoint,
 * and the hypotenuse label steps off its midpoint along the perpendicular
 * pointing AWAY from the right-angle corner, so it lands outside the triangle.
 */
function drawRightTriangle(
  backend: RendererBackend,
  stack: TransformStack,
  doc: World,
  spec: Extract<LensOverlaySpec, { kind: 'right-triangle' }>,
  override: EntityOverride,
): void {
  const a = resolvePoint(doc, spec.a, override)
  const b = resolvePoint(doc, spec.b, override)
  if (a === null || b === null) return

  const z = a.z
  const sa = stack.worldToScreen({ x: a.x, y: a.y, z })
  const sb = stack.worldToScreen({ x: b.x, y: b.y, z })
  const sc = stack.worldToScreen({ x: b.x, y: a.y, z }) // the right-angle corner

  backend.drawPolyline({ points: [sa, sc], stroke: LEG_COLOR, lineWidth: STROKE_WIDTH })
  backend.drawPolyline({ points: [sc, sb], stroke: LEG_COLOR, lineWidth: STROKE_WIDTH })
  backend.drawPolyline({ points: [sa, sb], stroke: ACCENT, lineWidth: HYPOTENUSE_WIDTH })

  const dx = Math.abs(b.x - a.x)
  const dy = Math.abs(b.y - a.y)
  const labels = spec.labels ?? {}
  const dxText = labels.dx ?? formatMeasure(dx)
  const dyText = labels.dy ?? formatMeasure(dy)
  const hypText = labels.hypotenuse ?? formatMeasure(Math.hypot(dx, dy))

  drawLabel(backend, (sa.x + sc.x) / 2, (sa.y + sc.y) / 2 + LABEL_LIFT, dxText, 'center', 'top')
  drawLabel(backend, (sc.x + sb.x) / 2 + LABEL_LIFT, (sc.y + sb.y) / 2, dyText, 'left', 'middle')

  const midX = (sa.x + sb.x) / 2
  const midY = (sa.y + sb.y) / 2
  const hypLen = Math.hypot(sb.x - sa.x, sb.y - sa.y)
  let offX = 0
  let offY = 0
  if (hypLen > EPSILON) {
    // Same swap-and-negate perpendicular as the arrowhead; flipped if it
    // points toward the corner, so the label always clears the triangle.
    // The flip test is ≥, not >, for the collapsed triangle's sake: with the
    // pair purely east (lesson-02's authored entry — crate due east of the
    // player), the corner lands ON the hypotenuse and the dot product is
    // exactly zero. Strict > left the label unflipped there, printing it on
    // top of the east leg's own label; breaking the tie toward flipping
    // sends it to the line's other side, clear of both leg labels.
    let perpX = -(sb.y - sa.y) / hypLen
    let perpY = (sb.x - sa.x) / hypLen
    if (perpX * (sc.x - midX) + perpY * (sc.y - midY) >= 0) {
      perpX = -perpX
      perpY = -perpY
    }
    offX = perpX * LABEL_PERP_OFFSET
    offY = perpY * LABEL_PERP_OFFSET
  }
  drawLabel(backend, midX + offX, midY + offY, hypText, 'center', 'middle')
}

/**
 * Draw a set of lesson overlays above an already-rendered scene — the
 * {@link DrawLensOverlays} contract of types.ts. Call it with the frame still
 * open (between the scene's draws and endFrame); it only adds ink. Overlays
 * draw in spec order, and each unresolvable overlay skips silently — this
 * frame; next frame it resolves again from scratch. The optional
 * entityOverride is the editor's mid-drag ghost (header essay): marker
 * endpoints that resolve to that entity draw at the override point.
 */
export const drawLensOverlays: DrawLensOverlays = (backend, stack, doc, overlays, entityOverride) => {
  const tileSize = doc.settings.tileSize
  const override = entityOverride ?? null
  for (const spec of overlays) {
    switch (spec.kind) {
      case 'cell-highlight':
        drawCellHighlight(backend, stack, tileSize, spec)
        break
      case 'entity-highlight':
        drawEntityHighlight(backend, stack, doc, spec, override)
        break
      case 'arrow':
        drawArrow(backend, stack, doc, spec, override)
        break
      case 'right-triangle':
        drawRightTriangle(backend, stack, doc, spec, override)
        break
    }
  }
}
