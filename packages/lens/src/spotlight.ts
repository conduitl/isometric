/**
 * The DOM masked spotlight — dim the whole page EXCEPT the one thing the
 * lesson is pointing at (docs/DECISIONS.md R6: ~200 in-house lines beat a
 * tour-library dependency).
 *
 * ## Why four panels beat one masked element
 *
 * The spotlight needs two properties AT ONCE: clicks outside the hole must be
 * swallowed (the dimmed page reads as "not now"), and clicks INSIDE the hole
 * must reach the real element untouched — a student clicking the spotlit
 * button is performing the lesson's real action, and anything intercepting,
 * re-dispatching, or simulating that click would make the tutorial's central
 * gesture a fake. The one-element tricks each fail one half:
 *
 * - A full-screen div with an SVG/CSS mask still OCCUPIES the hole — the
 *   pixels are transparent but the element is there, eating the click (and
 *   the SVG variant buys a dependency on SVG geometry besides).
 * - A hole-sized div with a giant box-shadow inverts the failure: shadows are
 *   not hit-testable, so the dimmed region swallows nothing, and the div
 *   itself now sits over the hole.
 *
 * Four plain rectangles — top, bottom, left, right, framing the hole — get
 * both properties for free. Each panel is a real element with real
 * pointer-events, so outside clicks land on dimmer and stop. The hole is not
 * an element at all: it is the ABSENCE of one, so a click there is a plain
 * click on whatever the page put underneath. Nothing to intercept, nothing to
 * forward, nothing to get wrong. The outline ring that hugs the hole is
 * decoration only (`pointer-events: none`), invisible to hit-testing.
 *
 * ## Tracking
 *
 * The hole must FOLLOW its target: scroll (any ancestor — hence a capture
 * listener on window), window resize, and the target changing size on its own
 * (a ResizeObserver). Every signal funnels into one reposition() that
 * re-reads getBoundingClientRect and re-lays the panels; position: fixed
 * keeps viewport coordinates and rect coordinates the same space.
 *
 * All DOM access lives inside the functions — the module itself is
 * import-safe in node, like everything else in this package.
 */

import type { DomSpotlight } from './types'

/** The dimmer — deep-navy family (the editor viewport's #0d131e neighborhood)
 * at an opacity that greys the page without hiding it: "not now", not "gone". */
const DIM_COLOR = 'rgba(6, 9, 15, 0.62)'
/** Attention gold, same accent the lens overlays use. */
const RING_COLOR = '#ffd166'
/** Breathing room between the target's rect and the hole's edge, in px. */
const HOLE_MARGIN = 6
/** Above app chrome; the ring one step above the panels. */
const PANEL_Z = 9998

/**
 * Create a spotlight (one per app is plenty — one thing is pointed at, at a
 * time; the {@link DomSpotlight} contract in types.ts). show() builds the
 * mask on first call and retargets on later calls; hide() tears everything
 * down; dispose() is hide, idempotently.
 */
export function createDomSpotlight(): DomSpotlight {
  type PanelFrame = readonly [HTMLDivElement, HTMLDivElement, HTMLDivElement, HTMLDivElement]
  let panels: PanelFrame | null = null
  let ring: HTMLDivElement | null = null
  let target: HTMLElement | null = null
  let observer: ResizeObserver | null = null

  function makePanel(edge: string): HTMLDivElement {
    const panel = document.createElement('div')
    panel.dataset.lensSpotlight = 'panel'
    panel.dataset.edge = edge
    const style = panel.style
    style.position = 'fixed'
    style.background = DIM_COLOR
    style.pointerEvents = 'auto' // swallow clicks: the dimmed page is "not now"
    style.zIndex = String(PANEL_Z)
    return panel
  }

  function makeRing(): HTMLDivElement {
    const outline = document.createElement('div')
    outline.dataset.lensSpotlight = 'ring'
    const style = outline.style
    style.position = 'fixed'
    style.border = `2px solid ${RING_COLOR}`
    style.borderRadius = '8px'
    style.boxSizing = 'border-box' // the ring's box IS the hole; border draws inward
    style.pointerEvents = 'none' // decoration only — invisible to hit-testing
    style.zIndex = String(PANEL_Z + 1)
    return outline
  }

  function place(panel: HTMLDivElement, left: number, top: number, width: number, height: number): void {
    const style = panel.style
    style.left = `${left}px`
    style.top = `${top}px`
    // A target hanging past a viewport edge would ask for a negative panel;
    // clamp to zero — an empty panel is just the mask reaching that edge.
    style.width = `${Math.max(width, 0)}px`
    style.height = `${Math.max(height, 0)}px`
  }

  /** Re-read the target's rect and re-lay the four panels + ring around it. */
  function reposition(): void {
    if (target === null || panels === null || ring === null) return
    const rect = target.getBoundingClientRect()

    // A PHANTOM target — removed from the document, or display:none'd so
    // its rect collapses to zero-size — has no honest place on screen.
    // Laying the frame around its 0×0-at-(0,0) rect would shrink the hole
    // to a notch in the viewport's top-left corner while the four panels
    // click-block the entire page: a lesson pointing at chrome that just
    // unmounted would lock the student out. Hide the mask instead (display,
    // not teardown — the listeners and observer keep watching), and the
    // next reposition with a real rect — the target re-attaching, becoming
    // visible, a scroll or resize — restores it in place.
    const phantom = !target.isConnected || (rect.width === 0 && rect.height === 0)
    for (const panel of panels) panel.style.display = phantom ? 'none' : ''
    ring.style.display = phantom ? 'none' : ''
    if (phantom) return

    const hole = {
      left: rect.left - HOLE_MARGIN,
      top: rect.top - HOLE_MARGIN,
      right: rect.right + HOLE_MARGIN,
      bottom: rect.bottom + HOLE_MARGIN,
    }
    const viewW = window.innerWidth
    const viewH = window.innerHeight

    // The classic frame: top and bottom span the full width; left and right
    // fill the remaining band beside the hole. Together they tile everything
    // except the hole — which no element covers, by construction.
    const [top, bottom, left, right] = panels
    place(top, 0, 0, viewW, hole.top)
    place(bottom, 0, hole.bottom, viewW, viewH - hole.bottom)
    place(left, 0, hole.top, hole.left, hole.bottom - hole.top)
    place(right, hole.right, hole.top, viewW - hole.right, hole.bottom - hole.top)

    const style = ring.style
    style.left = `${hole.left}px`
    style.top = `${hole.top}px`
    style.width = `${hole.right - hole.left}px`
    style.height = `${hole.bottom - hole.top}px`
  }

  function show(next: HTMLElement): void {
    if (panels === null) {
      panels = [makePanel('top'), makePanel('bottom'), makePanel('left'), makePanel('right')]
      ring = makeRing()
      for (const panel of panels) document.body.appendChild(panel)
      document.body.appendChild(ring)
      // Capture phase: scroll events do not bubble, so a bubbling listener
      // on window would miss every scrollable ancestor between the target
      // and the page. Passive: reposition only reads and restyles — it
      // never needs preventDefault, so scrolling stays smooth.
      window.addEventListener('scroll', reposition, { capture: true, passive: true })
      window.addEventListener('resize', reposition, { passive: true })
    }
    if (observer === null) observer = new ResizeObserver(reposition)
    else observer.disconnect() // retarget: stop following the old element
    observer.observe(next)
    target = next
    reposition()
  }

  function hide(): void {
    if (panels === null) return
    window.removeEventListener('scroll', reposition, { capture: true })
    window.removeEventListener('resize', reposition)
    observer?.disconnect()
    observer = null
    for (const panel of panels) panel.remove()
    ring?.remove()
    panels = null
    ring = null
    target = null
  }

  // hide() already returns everything to the never-shown state and is a no-op
  // when nothing is shown — which makes dispose idempotent for free.
  return { show, hide, dispose: hide }
}
