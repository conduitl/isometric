/**
 * The viewport — the one module that touches the canvas element.
 *
 * Everything DOM lives here, and only at call time: the module itself
 * imports cleanly in node (tests import the editor core without a browser),
 * and createViewport is the single point where the editor meets pointer
 * events, ResizeObserver, devicePixelRatio, and requestAnimationFrame. The
 * session plugs behavior in through plain callbacks; nothing in here knows
 * what a tool, a camera, or a document is.
 *
 * ## Render on demand — the dirty flag
 *
 * There is no free-running loop. requestRender sets the dirty state by
 * scheduling ONE animation frame (a second request while one is pending is
 * a no-op — the pending frame IS the dirty flag); the callback clears it
 * and calls render exactly once. An idle editor therefore draws zero frames
 * per second — near-zero idle CPU is a Chromebook battery feature
 * (docs/RISKS.md), and the difference between "laptop lasts the school day"
 * and "cart of dead Chromebooks by lunch".
 *
 * ## Pointer discipline
 *
 * pointerdown captures the pointer (setPointerCapture), so a drag that
 * leaves the canvas keeps reporting moves and ends with a proper 'up' —
 * strokes and drags never strand mid-gesture because the cursor grazed a
 * panel. 'up' fires once per gesture: pointerup normally, or
 * lostpointercapture when the browser revokes the capture out from under us
 * (tab switch, system gesture); whichever arrives first wins and the other
 * is ignored. Coordinates are CSS pixels relative to the canvas rect — the
 * exact space every draw command already lives in, so picking starts where
 * drawing ended.
 */

import { Vec2 } from '@engine/math'

/** The canvas's drawing area in CSS pixels, plus the device-pixel ratio. */
export interface ViewportSize {
  readonly width: number
  readonly height: number
  readonly dpr: number
}

/** One pointer report: canvas-relative CSS-px position, whether the primary
 * button is involved, and the shift modifier (tools read it for add-to-
 * selection style variants). */
export interface ViewportPointerEvent {
  readonly screen: Vec2
  readonly primary: boolean
  readonly shiftKey: boolean
}

/** What the session plugs into the viewport. */
export interface CreateViewportOptions {
  readonly canvas: HTMLCanvasElement
  onPointer(phase: 'down' | 'move' | 'up', e: ViewportPointerEvent): void
  onWheel(deltaY: number, aboutScreen: Vec2): void
  onLeave(): void
  onResize(): void
  render(size: ViewportSize): void
}

/** The handle the session keeps: mark dirty, tear down, measure, and dress
 * the pointer (the space-pan grab cursor). */
export interface Viewport {
  requestRender(): void
  detach(): void
  size(): ViewportSize
  /** Set the canvas's CSS cursor ('' restores the default). The canvas is
   * this module's property, so even a one-line style write stays here. */
  setCursor(value: string): void
}

/**
 * Adopt a canvas: own its size cache, its dirty-flag rAF loop, and its
 * event wiring. Returns the handle; detach() removes every listener and
 * cancels any pending frame — after it, the viewport is inert and the
 * canvas is nobody's.
 */
export function createViewport(opts: CreateViewportOptions): Viewport {
  const { canvas } = opts

  const measure = (): ViewportSize => {
    const rect = canvas.getBoundingClientRect()
    // devicePixelRatio via globalThis, read at call time: no window access
    // at import time, and a canvas dragged to a different-density screen
    // re-measures honestly on the next resize.
    const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1
    return { width: rect.width, height: rect.height, dpr }
  }

  let cached = measure()
  let detached = false
  let frameHandle: number | null = null

  const requestRender = (): void => {
    // A pending frame IS the dirty flag: one more request changes nothing,
    // and a request DURING render (frameHandle already cleared) schedules
    // the next frame — no change is ever lost, no frame ever doubled.
    if (detached || frameHandle !== null) return
    frameHandle = requestAnimationFrame(() => {
      frameHandle = null
      opts.render(cached)
    })
  }

  const pointAt = (event: { clientX: number; clientY: number }): Vec2 => {
    const rect = canvas.getBoundingClientRect()
    return Vec2.make(event.clientX - rect.left, event.clientY - rect.top)
  }

  // The pointer whose gesture is live — so 'up' fires exactly once even
  // though both pointerup and lostpointercapture will try to report it.
  let activePointer: number | null = null

  const onPointerDown = (event: PointerEvent): void => {
    // One gesture at a time: while a pointer's gesture is live, another
    // pointer's down is IGNORED — never adopted, never allowed to overwrite
    // activePointer. A second finger on a touchscreen must not restart (or
    // steal the 'up' of) a stroke the first finger is mid-way through.
    if (activePointer !== null) return
    // Capture keeps the drag alive outside the canvas. Guarded: exotic
    // pointers (and bare-bones test DOMs) may lack capture support, and a
    // stroke should degrade to uncaptured, not crash.
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch {
      // Uncaptured is a lesser experience, never an error.
    }
    activePointer = event.pointerId
    opts.onPointer('down', {
      screen: pointAt(event),
      primary: event.button === 0,
      shiftKey: event.shiftKey,
    })
  }

  const onPointerMove = (event: PointerEvent): void => {
    opts.onPointer('move', {
      screen: pointAt(event),
      // On moves the buttons BITMASK is the truth (button is -1 for moves);
      // bit 0 is the primary button — drag-paint reads exactly this.
      primary: (event.buttons & 1) === 1,
      shiftKey: event.shiftKey,
    })
  }

  const endPointer = (event: PointerEvent): void => {
    if (activePointer === null || event.pointerId !== activePointer) return
    activePointer = null
    opts.onPointer('up', {
      screen: pointAt(event),
      primary: event.button === 0,
      shiftKey: event.shiftKey,
    })
  }

  const onWheel = (event: WheelEvent): void => {
    // The wheel zooms the world, never scrolls the page — preventDefault
    // needs the listener registered non-passive below.
    event.preventDefault()
    // Normalize deltaMode so the handler always receives PIXELS: the pinned
    // browser (Chromium) reports mode 0, but line/page modes exist in the
    // wild and a deltaY of 3 lines must not read as 3 pixels of zoom.
    const deltaPx =
      event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 800 : event.deltaY
    opts.onWheel(deltaPx, pointAt(event))
  }

  const onPointerLeave = (): void => {
    opts.onLeave()
  }

  // Size changes arrive from layout, not from us: the observer re-measures,
  // tells the session (which refits or re-aims nothing — its choice), and
  // marks the scene dirty. Guarded for bare test DOMs without the API.
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          cached = measure()
          opts.onResize()
          requestRender()
        })
  observer?.observe(canvas)

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', endPointer)
  // pointercancel routes like pointerup: when the browser withdraws a
  // pointer (touch handed to a system gesture, device removed) its gesture
  // must still END — otherwise the guard above would ignore every later
  // pointerdown forever. lostpointercapture covers captured pointers; this
  // covers the ones whose setPointerCapture never took.
  canvas.addEventListener('pointercancel', endPointer)
  canvas.addEventListener('lostpointercapture', endPointer)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  // Style writes guarded like capture: bare-bones test DOMs may carry no
  // style object, and a missing cursor is a lesser experience, not a crash.
  const setCursor = (value: string): void => {
    const style = (canvas as { style?: { cursor: string } }).style
    if (style !== undefined) style.cursor = value
  }

  return {
    requestRender,

    setCursor,

    detach(): void {
      if (detached) return
      detached = true
      setCursor('') // never leave a grab cursor on a canvas nobody owns
      observer?.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endPointer)
      canvas.removeEventListener('pointercancel', endPointer)
      canvas.removeEventListener('lostpointercapture', endPointer)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
      if (frameHandle !== null) {
        cancelAnimationFrame(frameHandle)
        frameHandle = null
      }
    },

    size(): ViewportSize {
      return cached
    },
  }
}
