/**
 * The editor camera — pan and zoom as pure Mat3 arithmetic, with one lesson
 * at its heart: zooming about a point.
 *
 * ## Zoom about a point, derived
 *
 * The camera is a matrix; "zoom in on where my cursor is" is a sentence
 * about matrices. Scaling alone (S(f)) zooms about the ORIGIN — the top-left
 * corner of the screen — which is never where anyone is looking. To zoom
 * about an arbitrary screen point p, do what every "rotate about a point"
 * recipe does: move p to the origin, do the simple thing there, move back:
 *
 *     zoomAbout(p, f) = T(p) · S(f) · T(−p)
 *
 * Check it keeps p fixed by following p through, inner map first:
 * T(−p) sends p to 0; S(f) fixes 0 (scaling is linear — the origin never
 * moves); T(p) sends 0 back to p. Every OTHER point q ends up at
 * p + f·(q − p): its offset from the cursor, stretched by f — which is
 * exactly what "the world grows around my cursor" means. The new camera
 * PREPENDS this to the old one (screen-side, so it acts on what you see):
 *
 *     camera′ = T(p) · S(f) · T(−p) · camera
 *
 * Pan is the degenerate cousin: camera′ = T(dx, dy) · camera.
 *
 * ## The axis-aligned invariant (a stated precondition, not a hope)
 *
 * Cameras here are ALWAYS compositions of axis-aligned positive scalings
 * and translations: fitCamera produces one (translation ∘ scaling), and
 * this controller only ever prepends more of the same. In Mat3 terms, `b`
 * and `c` stay exactly 0 and `a`, `d` stay positive — look at the compose
 * formula: b′ = outer.b·inner.a + outer.d·inner.b is 0 when both b's are 0,
 * identically, no rounding involved. That invariant is the tilemap cache's
 * fast-path precondition (@engine/tilemap render.ts: a blit can reproduce
 * what an axis-aligned camera does to the cache, and nothing else) — break
 * it and every layer silently falls back to per-tile drawing. The infra
 * tests assert b = c = 0 after arbitrary pan/zoom sequences.
 *
 * ## Why a controller and not pure functions all the way down
 *
 * Zoom is REPORTED relative to the fit ("1 = the whole world framed"), and
 * the fit scale is not recoverable from the camera matrix in general — after
 * a resize, the same matrix means a different relative zoom. So the
 * controller remembers `fitScale` from the last fit() and prices every
 * zoomBy against it, clamping the ABSOLUTE multiplier into [0.25, 16]:
 * a student can neither lose their world to infinity nor to a single pixel.
 */

import { Mat3, Vec2 } from '@engine/math'
import type { World } from '@engine/core'
import { fitCamera } from '@engine/projection'
import type { TransformStack } from '@engine/projection'

/** Absolute zoom bounds, as multiples of the fitted scale: a quarter of the
 * whole-world view out, 16× in — comfortable cell-editing range at 256². */
const MIN_ZOOM = 0.25
const MAX_ZOOM = 16

/** The world's elevation range for camera fitting: ground to two units up —
 * the same headroom the Phase 1 demo used, so plateaus and the things
 * standing on them stay inside the fitted frame. */
const Z_RANGE = [0, 2] as const

// ---------------------------------------------------------------------------
// Zoom feel — THE dials. Tune here, nowhere else.
// ---------------------------------------------------------------------------

/**
 * One classic mouse-wheel notch multiplies the zoom by this. The wheel
 * handler scales the exponent by the event's actual deltaY (see
 * {@link wheelZoomFactor}), so a trackpad's stream of tiny deltas and a
 * mouse wheel's chunky notches both add up to the same zoom for the same
 * finger travel — raise for snappier, lower for calmer, and both inputs
 * follow together.
 */
export const WHEEL_ZOOM_PER_NOTCH = 3

/** What "one notch" means in deltaY pixels — the classic wheel click.
 * Chromium reports 100 per notch; this is the denominator that turns a
 * raw deltaY into a notch count. */
export const WHEEL_NOTCH_DELTA = 100

/** How far a SINGLE wheel event may zoom, in notches — a wild trackpad
 * fling (deltaY in the thousands) becomes at most this many, so one
 * gesture can never teleport the zoom across its whole range. */
export const WHEEL_MAX_NOTCHES = 9

/** The keyboard's +/− step (EngineViewport): one press, this factor. */
export const KEY_ZOOM_STEP = 1.25

/**
 * Turn a wheel event's deltaY into a zoom factor, PROPORTIONALLY: the
 * exponent is the delta measured in notches, clamped to ±WHEEL_MAX_NOTCHES,
 * and negative deltaY (scrolling up) zooms IN. deltaY −100 gives exactly
 * WHEEL_ZOOM_PER_NOTCH; −50 gives its square root, so two half-notches
 * compose to one whole one. That composition property is the fix for the
 * old "way too sensitive" behavior: a fixed 1.25× per EVENT treated a
 * trackpad's dozens of tiny events per gesture as dozens of full notches.
 */
export function wheelZoomFactor(deltaY: number): number {
  const notches = Math.max(
    -WHEEL_MAX_NOTCHES,
    Math.min(WHEEL_MAX_NOTCHES, deltaY / WHEEL_NOTCH_DELTA),
  )
  return WHEEL_ZOOM_PER_NOTCH ** -notches
}

/** The camera controller the session drives (zoomBy/panBy/resetCamera). */
export interface CameraController {
  /** Frame the whole document: fitCamera over the largest layer's world
   * footprint. Also (re)defines what zoom() = 1 means. */
  fit(doc: World): void
  /** Multiply zoom by `factor` about a screen point (default: the view
   * center), clamping the absolute multiplier into [0.25, 16]. */
  zoomBy(factor: number, aboutScreen?: Vec2): void
  /** Slide the picture by (dx, dy) screen pixels. */
  panBy(dxScreen: number, dyScreen: number): void
  /** Current zoom as a plain multiplier of the last fit (1 = fit). */
  zoom(): number
}

/**
 * Build the controller around the session's stack. `getViewSize` is asked at
 * call time (not captured) because the canvas resizes underneath the camera
 * — the fit must always measure the view as it IS.
 */
export function createCameraController(
  stack: TransformStack,
  getViewSize: () => { width: number; height: number },
): CameraController {
  // What zoom() = 1 means. Before the first fit() the stack's own scale
  // stands in (identity camera → 1), so zoom readouts are sane even if the
  // boot order ever renders before fitting.
  let fitScale = stack.camera.a > 0 ? stack.camera.a : 1

  return {
    fit(doc: World): void {
      const { width, height } = getViewSize()
      // A canvas that hasn't been laid out yet has no size to fit into;
      // the resize observer will land shortly and the session refits then.
      if (width <= 0 || height <= 0) return

      // The world's ground footprint: the largest layer decides, in world
      // units (layer dims × tileSize) — same fitting box as the Phase 1 demo.
      const tileSize = doc.settings.tileSize
      let worldW = 0
      let worldH = 0
      for (const layer of doc.layers) {
        worldW = Math.max(worldW, layer.width * tileSize)
        worldH = Math.max(worldH, layer.height * tileSize)
      }

      const camera = fitCamera({
        viewWidth: width,
        viewHeight: height,
        worldMin: Vec2.zero,
        worldMax: Vec2.make(worldW, worldH),
        zRange: Z_RANGE,
        projection: stack.projection,
      })
      stack.setCamera(camera)
      fitScale = camera.a // uniform by fitCamera's own contract (a === d)
    },

    zoomBy(factor: number, aboutScreen?: Vec2): void {
      const camera = stack.camera
      // Clamp the ABSOLUTE multiplier, then back out the factor actually
      // applied — so "zoom in" pressed at the ceiling does nothing instead
      // of drifting the translation while the scale stays pinned.
      const current = camera.a / fitScale
      const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor))
      const applied = target / current
      if (applied === 1) return

      const size = getViewSize()
      const p = aboutScreen ?? Vec2.make(size.width / 2, size.height / 2)
      // camera′ = T(p) · S(f) · T(−p) · camera — the header's derivation,
      // composed inner-first exactly as written.
      stack.setCamera(
        Mat3.compose(
          Mat3.translation(p.x, p.y),
          Mat3.compose(
            Mat3.scaling(applied, applied),
            Mat3.compose(Mat3.translation(-p.x, -p.y), camera),
          ),
        ),
      )
    },

    panBy(dxScreen: number, dyScreen: number): void {
      stack.setCamera(Mat3.compose(Mat3.translation(dxScreen, dyScreen), stack.camera))
    },

    zoom(): number {
      return stack.camera.a / fitScale
    },
  }
}
