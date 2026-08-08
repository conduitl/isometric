/**
 * The renderer seam — the line every pixel crosses, and the line no math crosses.
 *
 * Everything above this interface (projections, cameras, the world model) does
 * curriculum math and produces plain **screen-space draw commands**: "a rect at
 * (120, 40)", "a circle at (300, 200)". Everything below it (Canvas2D today,
 * maybe WebGL tomorrow) just turns those commands into pixels. Because commands
 * are flat data — no scene graph, no backend objects leaking upward — we can:
 *
 *   1. swap the backend without touching a single line of game or editor code,
 *   2. record commands as plain JSON and hash them in tests ("what WOULD have
 *      been drawn?"), which is how replay determinism is proven, and
 *   3. keep all the interesting math inspectable in one place, above the seam.
 *
 * Units: **all coordinates here are CSS pixels** — the "logical" pixels your
 * page is laid out in. A hiDPI screen packs several device pixels into each
 * CSS pixel; the backend handles that conversion using `dpr` (see ViewInfo),
 * so callers never think about physical pixels at all.
 */

import type { Vec2 } from '@engine/math'

/**
 * Everything a backend needs to know to start a frame: how big the drawing
 * area is in CSS pixels, and how many device pixels sit behind each CSS pixel.
 *
 * `dpr` (device pixel ratio) is the hiDPI story in one number: on a MacBook
 * it is typically 2, meaning a 800×450 CSS-pixel canvas is really backed by
 * 1600×900 hardware pixels. The backend scales everything by `dpr` so that
 * callers can keep drawing in CSS pixels and still get crisp output.
 *
 * `background`, when given, is a CSS color the backend paints over the whole
 * view before any command runs; when omitted the frame starts transparent.
 */
export interface ViewInfo {
  readonly width: number
  readonly height: number
  readonly dpr: number
  readonly background?: string
}

/**
 * An axis-aligned rectangle: top-left corner at (x, y), extending `width`
 * right and `height` down (screen space is y-down — the y-flip from math-class
 * y-up coordinates happened upstream, inside a projection matrix).
 *
 * `fill` paints the inside, `stroke` outlines the edge with a `lineWidth`
 * thick pen (default 1). Both are optional and independent; a command with
 * neither draws nothing — no ink, no marks.
 */
export interface RectCmd {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly fill?: string
  readonly stroke?: string
  readonly lineWidth?: number
}

/**
 * A circle centered at (x, y) with the given radius, in CSS pixels.
 * Same fill/stroke rules as RectCmd: each optional, each independent.
 */
export interface CircleCmd {
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly fill?: string
  readonly stroke?: string
  readonly lineWidth?: number
}

/**
 * A chain of straight line segments through `points`, in order. This is the
 * workhorse of overlays: grids, arrows, graphs, selection outlines — anything
 * you would sketch with a ruler.
 *
 * `stroke` draws the segments; `closed: true` adds one more stroked segment
 * from the last point back to the first. `fill` always paints the interior
 * of the polygon as if the chain were closed (the fill implicitly closes an
 * open chain — the same rule SVG uses), whether or not `closed` is set.
 * Fewer than two points means there is no segment to draw, so the command
 * is a no-op.
 */
export interface PolylineCmd {
  readonly points: readonly Vec2[]
  readonly stroke?: string
  readonly fill?: string
  readonly lineWidth?: number
  readonly closed?: boolean
}

/**
 * A run of text anchored at (x, y). `align` says how the text sits
 * horizontally relative to x (does x mark the left edge, the center, or the
 * right edge?), and `baseline` says how it sits vertically relative to y —
 * 'alphabetic' is the invisible line most letters stand on, the same line you
 * write on in a ruled notebook. `font` is a CSS font string; backends supply
 * a readable monospace default when it is omitted.
 */
export interface TextCmd {
  readonly x: number
  readonly y: number
  readonly text: string
  readonly fill?: string
  readonly font?: string
  readonly align?: 'left' | 'center' | 'right'
  readonly baseline?: 'top' | 'middle' | 'alphabetic'
}

/**
 * The contract every backend implements — the whole renderer API in six
 * methods. A frame is a sandwich: one `beginFrame` (size the surface, clear
 * it), any number of draw calls in between, one `endFrame` (a chance for
 * batching backends to actually submit their work; immediate-mode backends
 * do nothing there).
 *
 * Keeping this surface tiny is deliberate: it is the exact list of things a
 * new backend must implement, so "swap the renderer" stays a bounded,
 * provable job instead of an open-ended rewrite. The null backend and the
 * Canvas2D backend both implement it from day one, which keeps the interface
 * honest — an interface with only one implementation is just a wish.
 */
export interface RendererBackend {
  readonly name: string
  beginFrame(view: ViewInfo): void
  drawRect(cmd: RectCmd): void
  drawCircle(cmd: CircleCmd): void
  drawPolyline(cmd: PolylineCmd): void
  drawText(cmd: TextCmd): void
  endFrame(): void
}
