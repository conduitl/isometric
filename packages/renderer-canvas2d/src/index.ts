/**
 * @engine/renderer-canvas2d — the from-scratch Canvas2D reference backend.
 *
 * This file is assigned reading. It is the shortest possible honest answer to
 * "how do draw commands become pixels?", written with the browser's built-in
 * 2D canvas API and nothing else. Every other backend the engine ever grows
 * (batched, GPU-accelerated, whatever) must produce the same picture this one
 * does — this is the reference the fancy ones are checked against.
 *
 * The one big idea to take away: **the canvas API is the math class you
 * already took.** `ctx.setTransform(a, b, c, d, tx, ty)` takes the six
 * numbers of a 2D affine matrix — the same six numbers as our Mat3 in
 * @engine/math — and from then on the browser multiplies EVERY point you
 * draw by that matrix before it touches a pixel:
 *
 *     x' = a·x + c·y + tx
 *     y' = b·x + d·y + ty
 *
 * Matrices are not an implementation detail down here; they are the API.
 *
 * A second, quieter lesson: the 2D context is a **state machine**. fillStyle,
 * lineWidth, font — you set them, and they stay set until someone changes
 * them. That is convenient in a sketch and a trap in an engine: if command A
 * sets a red fill and command B forgets to set its own, B silently comes out
 * red. So this backend sets every piece of state a command depends on, every
 * time, from the command itself (with documented defaults). Commands stay
 * independent: the same command list always paints the same picture, no
 * matter what ran before it.
 */

import type {
  CircleCmd,
  PolylineCmd,
  RectCmd,
  RendererBackend,
  TextCmd,
  ViewInfo,
} from '@engine/renderer'

/**
 * One full turn around a circle, in radians: τ = 2π.
 * `ctx.arc` wants "from angle, to angle", so a whole circle is 0 → τ.
 * (Radians measure angle by arc length on a unit circle, and the whole
 * circumference of a unit circle is 2π — that's the entire derivation.)
 */
const FULL_TURN = Math.PI * 2

/**
 * The default text style: a small monospace stack. Monospace because most of
 * the text this engine draws is debug/HUD numbers, and numbers that all take
 * the same width don't jiggle sideways as they change — 9.99 → 10.00 stays
 * put. 'ui-monospace' asks for the platform's native mono font; plain
 * 'monospace' is the always-available fallback.
 */
const DEFAULT_FONT = '13px ui-monospace, monospace'

/**
 * Creates a RendererBackend that draws onto the given canvas with the plain
 * Canvas2D API — the uncached reference path: no batching, no layer caches,
 * just one honest ctx call (or a few) per command.
 *
 * Throws if the browser refuses to hand over a 2D context, which in practice
 * only happens when the canvas is already claimed by a different context
 * type (e.g. WebGL) — a wiring bug worth hearing about immediately.
 */
export function createCanvas2dBackend(canvas: HTMLCanvasElement): RendererBackend {
  const maybeCtx = canvas.getContext('2d')
  if (maybeCtx === null) {
    throw new Error(
      'canvas2d backend: could not get a 2d context — is this canvas already ' +
        'bound to another context type (webgl, bitmaprenderer)?',
    )
  }
  const ctx = maybeCtx

  return {
    name: 'canvas2d',

    /**
     * Start a frame: make the backing store the right size, aim the transform,
     * wipe the slate.
     *
     * Sizing first. The view arrives in CSS pixels plus a device-pixel ratio
     * (dpr); the backing store must hold width×dpr by height×dpr REAL pixels
     * or the browser will stretch our image and blur it. We round because a
     * backing store can only contain whole pixels. Crucially, we only assign
     * canvas.width/height when the value actually changed: assigning these
     * properties — even to the same number — erases the canvas and resets all
     * context state, so an unconditional assignment would burn a full
     * reallocation every frame for nothing.
     *
     * Then the line this whole file exists to teach:
     *
     *     ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
     *
     * Those six arguments are exactly a Mat3 {a: dpr, b: 0, c: 0, d: dpr,
     * tx: 0, ty: 0} — a pure scale matrix. From now on the browser multiplies
     * every point we draw by this matrix, so a command at CSS pixel (100, 50)
     * lands on device pixel (100·dpr, 50·dpr). That multiplication is the
     * entire reason callers get to think in CSS pixels on a hiDPI screen:
     * the matrix absorbs the hardware.
     *
     * Finally the wipe: fill with the background color if the view carries
     * one, otherwise clear to transparent. Note both happen in CSS-pixel
     * coordinates — the transform is already set, so (0, 0, width, height)
     * covers the whole surface regardless of dpr.
     */
    beginFrame(view: ViewInfo): void {
      const deviceWidth = Math.round(view.width * view.dpr)
      const deviceHeight = Math.round(view.height * view.dpr)
      if (canvas.width !== deviceWidth) canvas.width = deviceWidth
      if (canvas.height !== deviceHeight) canvas.height = deviceHeight

      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)

      if (view.background !== undefined) {
        ctx.fillStyle = view.background
        ctx.fillRect(0, 0, view.width, view.height)
      } else {
        ctx.clearRect(0, 0, view.width, view.height)
      }
    },

    /**
     * A rectangle is the one shape canvas can draw without building a path:
     * fillRect paints the inside, strokeRect runs a pen around the edge.
     * Fill goes first so the stroke sits on top where the two overlap
     * (a stroke straddles the edge, half in, half out).
     */
    drawRect(cmd: RectCmd): void {
      if (cmd.fill !== undefined) {
        ctx.fillStyle = cmd.fill
        ctx.fillRect(cmd.x, cmd.y, cmd.width, cmd.height)
      }
      if (cmd.stroke !== undefined) {
        ctx.strokeStyle = cmd.stroke
        ctx.lineWidth = cmd.lineWidth ?? 1
        ctx.strokeRect(cmd.x, cmd.y, cmd.width, cmd.height)
      }
    },

    /**
     * Circles go through the path API: describe the outline first, then
     * decide what to do with it (fill, stroke, or both). `arc` sweeps from
     * angle 0 (pointing right, the positive x axis) through a full turn.
     * beginPath matters — without it, every circle would be glued onto the
     * previous command's path and refilled with it.
     */
    drawCircle(cmd: CircleCmd): void {
      ctx.beginPath()
      ctx.arc(cmd.x, cmd.y, cmd.radius, 0, FULL_TURN)
      if (cmd.fill !== undefined) {
        ctx.fillStyle = cmd.fill
        ctx.fill()
      }
      if (cmd.stroke !== undefined) {
        ctx.strokeStyle = cmd.stroke
        ctx.lineWidth = cmd.lineWidth ?? 1
        ctx.stroke()
      }
    },

    /**
     * A polyline is connect-the-dots: pen down at the first point (moveTo),
     * straight segment to each following point (lineTo). `closed` adds the
     * return segment to the STROKE; `fill` always treats the chain as a
     * polygon, open or not — canvas's fill() implicitly closes the path,
     * exactly like SVG. As with rects, fill before stroke so the outline
     * stays fully visible. An empty point list means there is nothing to
     * trace; we bail early.
     */
    drawPolyline(cmd: PolylineCmd): void {
      ctx.beginPath()
      let started = false
      for (const p of cmd.points) {
        if (started) {
          ctx.lineTo(p.x, p.y)
        } else {
          ctx.moveTo(p.x, p.y)
          started = true
        }
      }
      if (!started) return
      if (cmd.closed === true) ctx.closePath()

      if (cmd.fill !== undefined) {
        ctx.fillStyle = cmd.fill
        ctx.fill()
      }
      if (cmd.stroke !== undefined) {
        ctx.strokeStyle = cmd.stroke
        ctx.lineWidth = cmd.lineWidth ?? 1
        ctx.stroke()
      }
    },

    /**
     * Text is the clearest example of the state-machine trap, so every text
     * property is set explicitly on every call: font, horizontal alignment
     * (where does x point — left edge, center, right edge?), baseline (where
     * does y point — the top of the letters, their middle, or the ruled line
     * they stand on?), and color. Defaults: the monospace HUD font, left
     * aligned, alphabetic baseline, black ink.
     */
    drawText(cmd: TextCmd): void {
      ctx.font = cmd.font ?? DEFAULT_FONT
      ctx.textAlign = cmd.align ?? 'left'
      ctx.textBaseline = cmd.baseline ?? 'alphabetic'
      ctx.fillStyle = cmd.fill ?? '#000000'
      ctx.fillText(cmd.text, cmd.x, cmd.y)
    },

    /**
     * The blit: copy pixels that already exist. This is the other half of
     * the caching lesson — every other command above PAYS for its geometry
     * on every call (path building, filling, rasterizing), while drawImage
     * just copies a rectangle of finished pixels. A tile layer rendered once
     * into an offscreen canvas can be stamped onto the frame each frame for
     * (almost) free, at any scale — that stamp is this call.
     *
     * Canvas gives the operation two shapes and we use both. The 4-argument
     * form copies the WHOLE source into the dest rect; the 8-argument form
     * first crops a window out of the source (sx, sy, sw, sh — in the
     * source's own pixels) and stretches that window into the dest rect. A
     * crop is only meaningful as a complete rectangle, so we switch on all
     * four fields being present. Either way the dest rect runs through the
     * frame's transform like everything else, so callers keep thinking in
     * CSS pixels. `cmd.label` is for logs and replay hashes — the pixels
     * don't need it, so it is (correctly) unused here.
     */
    drawImage(cmd): void {
      if (
        cmd.sx !== undefined &&
        cmd.sy !== undefined &&
        cmd.sw !== undefined &&
        cmd.sh !== undefined
      ) {
        ctx.drawImage(cmd.source, cmd.sx, cmd.sy, cmd.sw, cmd.sh, cmd.dx, cmd.dy, cmd.dw, cmd.dh)
      } else {
        ctx.drawImage(cmd.source, cmd.dx, cmd.dy, cmd.dw, cmd.dh)
      }
    },

    /**
     * Nothing to do: Canvas2D is immediate-mode, meaning every draw call
     * above already landed on the canvas by the time it returned. The method
     * exists because the INTERFACE needs it — a batching backend queues work
     * during the frame and submits it all here. Keeping the hook in the
     * contract now is what lets such a backend slot in later without
     * changing a single caller.
     */
    endFrame(): void {
      // Intentionally empty — see the comment above.
    },
  }
}
