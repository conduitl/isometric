/**
 * Raster targets — the pixel scratchpads the cache paints into.
 *
 * The cached fast path (render.ts) needs somewhere to render a layer ONCE so
 * later frames can blit the result. In a browser that somewhere is an
 * OffscreenCanvas. But this package must also run headless — node tests
 * verify the cache's geometry without any browser at all — so the renderer
 * never touches OffscreenCanvas directly. It paints through this small
 * interface, and the caller injects whichever implementation exists: the
 * real offscreen one in a browser, a call-recording fake in tests. (Same
 * move as the renderer seam itself, one level down.)
 */

import type { Vec2 } from '@engine/math'

/**
 * A fixed-size pixel surface the layer cache can paint into.
 *
 * `source` is what the blit hands to RendererBackend.drawImage — the raster
 * AS an image. It is null when there is no real pixel store behind the
 * target (headless fakes), which is the layer renderer's signal to skip
 * caching entirely and emit plain per-tile draw commands instead: geometry
 * stays testable and hashable with no browser in sight.
 *
 * The three paint methods are the minimum the tile geometry needs: erase a
 * rectangle (dirty cells must CLEAR before refilling — a repainted-to-empty
 * cell has to actually vanish), fill a rectangle (top-down cells), and fill
 * a polygon (iso diamonds and walls, profile slabs). All coordinates are in
 * this raster's own pixels.
 */
export interface RasterTarget {
  readonly width: number
  readonly height: number
  readonly source: CanvasImageSource | null
  clear(x: number, y: number, w: number, h: number): void
  fillRect(color: string, x: number, y: number, w: number, h: number): void
  fillPoly(color: string, points: readonly Vec2[]): void
}

/** Makes raster targets of a requested pixel size. Injected into createLayerRenderer. */
export type RasterFactory = (width: number, height: number) => RasterTarget

/**
 * The real, browser-backed factory: each call makes an OffscreenCanvas and
 * wraps its 2d context in the RasterTarget interface.
 *
 * Browser-only at CALL time, on purpose: this module must import cleanly in
 * node (tests import the package), so nothing here touches OffscreenCanvas
 * until a raster is actually requested. In node that request throws a
 * friendly error pointing at the right fix — inject a fake factory, whose
 * null `source` flips the layer renderer into its per-tile command path.
 */
export function createOffscreenRasterFactory(): RasterFactory {
  return (width, height) => {
    if (typeof OffscreenCanvas === 'undefined') {
      throw new Error(
        'createOffscreenRasterFactory: OffscreenCanvas only exists in a browser, and this ' +
          'code is running without one. For headless tests, inject a fake RasterFactory ' +
          'whose targets have source: null — the layer renderer will emit per-tile draw ' +
          'commands instead of caching.',
      )
    }
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (ctx === null) {
      throw new Error(
        'createOffscreenRasterFactory: the OffscreenCanvas refused to give a 2d context — ' +
          'is it already bound to another context type?',
      )
    }
    return {
      width,
      height,
      source: canvas,

      clear(x: number, y: number, w: number, h: number): void {
        ctx.clearRect(x, y, w, h)
      },

      fillRect(color: string, x: number, y: number, w: number, h: number): void {
        ctx.fillStyle = color
        ctx.fillRect(x, y, w, h)
      },

      // Same connect-the-dots walk as the Canvas2D backend's drawPolyline:
      // pen down at the first point, straight lines through the rest, close,
      // fill. Fewer than three points enclose no area — nothing to fill.
      fillPoly(color: string, points: readonly Vec2[]): void {
        if (points.length < 3) return
        ctx.beginPath()
        let started = false
        for (const p of points) {
          if (started) {
            ctx.lineTo(p.x, p.y)
          } else {
            ctx.moveTo(p.x, p.y)
            started = true
          }
        }
        ctx.closePath()
        ctx.fillStyle = color
        ctx.fill()
      },
    }
  }
}
