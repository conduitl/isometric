/**
 * Canvas lifecycle helpers: sizing, hiDPI, and resize notifications.
 *
 * A `<canvas>` secretly has TWO sizes, and mixing them up is the single most
 * common cause of blurry games on the web:
 *
 *   - its **CSS size** — how many layout pixels it occupies on the page
 *     (set by stylesheets, flexbox, the window resizing…), and
 *   - its **backing-store size** — how many real pixels of image memory it
 *     owns (`canvas.width` / `canvas.height`).
 *
 * On a hiDPI ("Retina") screen the browser packs several device pixels into
 * each CSS pixel; the ratio is `window.devicePixelRatio` (dpr). If the
 * backing store only has one pixel per CSS pixel on a dpr-2 screen, the
 * browser stretches your image 2× and everything looks soft. Crisp rendering
 * needs both numbers: draw into `cssSize × dpr` real pixels, then let a
 * scale-by-dpr transform map your CSS-pixel coordinates onto them (that
 * transform lives in the backend's beginFrame — see @engine/renderer-canvas2d
 * for the matrix behind it).
 *
 * This module watches both numbers for you:
 *   - CSS size changes are observed with a ResizeObserver on the canvas
 *     (fires for window resizes, flexbox reflow, dev-tools docking — anything
 *     that moves the element's box), and
 *   - dpr changes (dragging the window to a different monitor, browser zoom)
 *     are caught with a matchMedia listener. There is no direct "dpr changed"
 *     event in the platform, but `matchMedia('(resolution: 2dppx)')` fires
 *     when the answer to "is the ratio exactly 2?" flips — so we ask about
 *     the CURRENT ratio and re-arm a fresh query each time it stops matching.
 *
 * Browser-only at CALL time: nothing here touches window/document until you
 * call createSurface, so importing this module in Node (for tests) is safe.
 */

/** A canvas's current size: CSS pixels for layout, plus the device-pixel ratio. */
export interface SurfaceSize {
  readonly width: number
  readonly height: number
  readonly dpr: number
}

/**
 * A live view onto one canvas element: query its current size, subscribe to
 * "the size or dpr just changed" notifications, and tear everything down.
 */
export interface Surface {
  readonly canvas: HTMLCanvasElement
  size(): SurfaceSize
  /** Subscribe to size/dpr changes; returns an unsubscribe function. */
  onResize(cb: () => void): () => void
  /** Stop all observers and drop all subscribers. The surface is dead after this. */
  dispose(): void
}

/**
 * Wraps a canvas element in a Surface that tracks its CSS size and the
 * screen's device-pixel ratio.
 *
 * The intended loop: on every onResize ping (and once at startup), read
 * `size()` and pass it to the backend's beginFrame — the backend compares
 * `width × dpr` against its backing store and reallocates only when they
 * actually differ, so resize spam is cheap.
 *
 * `size()` reads getBoundingClientRect, which reports fractional CSS pixels;
 * we pass the fraction through rather than rounding here, because deciding
 * how to snap to whole device pixels is the backend's job.
 */
export function createSurface(canvas: HTMLCanvasElement): Surface {
  const listeners = new Set<() => void>()
  let disposed = false

  function notify(): void {
    for (const cb of listeners) cb()
  }

  // Fires whenever the element's layout box changes size, no matter why.
  const observer = new ResizeObserver(() => {
    notify()
  })
  observer.observe(canvas)

  // The dpr watcher. A media query can only answer yes/no about one specific
  // ratio, so each time the ratio changes we throw the old query away and arm
  // a new one asking about the NEW ratio — a self-re-arming tripwire.
  let dprQuery: MediaQueryList | null = null

  function onDprChange(): void {
    armDprWatcher()
    notify()
  }

  function armDprWatcher(): void {
    if (dprQuery !== null) {
      dprQuery.removeEventListener('change', onDprChange)
    }
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    dprQuery.addEventListener('change', onDprChange)
  }

  armDprWatcher()

  return {
    canvas,

    size(): SurfaceSize {
      const rect = canvas.getBoundingClientRect()
      return { width: rect.width, height: rect.height, dpr: window.devicePixelRatio }
    },

    onResize(cb: () => void): () => void {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      observer.disconnect()
      if (dprQuery !== null) {
        dprQuery.removeEventListener('change', onDprChange)
        dprQuery = null
      }
      listeners.clear()
    },
  }
}
