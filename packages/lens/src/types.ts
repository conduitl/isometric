/**
 * The lens layer's contract — LOCKED for Phase 3.
 *
 * A lens overlay is a small mathematical picture drawn ON TOP of the scene:
 * a highlighted cell, a labeled arrow, the right-triangle that makes
 * "distance" mean something. Two rules keep this package honest:
 *
 * 1. **Public APIs only.** Overlays are drawn through the same
 *    RendererBackend commands and the same TransformStack every scene
 *    render uses. There is no private channel into the renderer — so any
 *    private shortcut someone adds later breaks visible features
 *    immediately, which is the point (ARCHITECTURE §8: dogfooding keeps
 *    the API honest).
 * 2. **Overlay SPECS are data.** The spec types live in @engine/tutorial
 *    (lessons declare them in onEnter effects); this package only renders
 *    them. Dynamic endpoints ({ marker }) resolve against the live document
 *    at draw time, so a triangle between player and crate follows the drag.
 *
 * The DOM spotlight is the one non-canvas citizen: a masked overlay that
 * dims the page except a hole over a piece of editor chrome (targeted by
 * data-anchor id — D5's registry is the only legal address space). It is
 * in-house on purpose (docs/DECISIONS.md R6: ~200 lines beats a
 * dependency).
 */

import type { World } from '@engine/core'
import type { TransformStack, WorldPoint } from '@engine/projection'
import type { RendererBackend } from '@engine/renderer'
import type { LensOverlaySpec } from '@engine/tutorial'

/**
 * Draw a set of overlay specs above an already-rendered scene. Marker
 * endpoints resolve against `doc` (first entity with the marker, at its
 * position + elevation); an overlay whose marker resolves to nothing draws
 * nothing this frame — entities come and go, and a half-drawn triangle
 * would lie. tileSize scales cell-addressed overlays into world units.
 */
export type DrawLensOverlays = (
  backend: RendererBackend,
  stack: TransformStack,
  doc: World,
  overlays: ReadonlyArray<LensOverlaySpec>,
  /** The editor's transient-drag override: while an entity is mid-drag, its
   * committed components still hold the OLD position, but the student sees
   * the ghost — so marker resolution must too, or the right-triangle's
   * "watch the numbers move while you drag" moment never happens. When the
   * marker-resolved entity's id matches, draw at the override point. */
  entityOverride?: { readonly id: string; readonly point: WorldPoint } | null,
) => void

/** The DOM masked spotlight. show() dims everything except a rounded hole
 * over the target element (plus a breathing-room margin) and keeps the hole
 * tracking the element on scroll/resize until hide(). One spotlight at a
 * time; show() while shown retargets. The overlay never intercepts pointer
 * events over the HOLE (the student must be able to click the thing being
 * pointed at); everywhere else it swallows clicks so the dimmed page reads
 * as "not now". */
export interface DomSpotlight {
  show(target: HTMLElement): void
  hide(): void
  dispose(): void
}
