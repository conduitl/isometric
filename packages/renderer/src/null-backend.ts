/**
 * The null backend: a renderer that draws nothing and remembers everything.
 *
 * It implements the full RendererBackend contract but, instead of putting
 * pixels anywhere, it appends every call to a log as a plain object:
 *
 *   [ { kind: 'begin', width: 800, height: 450, dpr: 1 },
 *     { kind: 'rect', x: 10, y: 20, width: 30, height: 40, fill: '#f00' },
 *     { kind: 'end' } ]
 *
 * Why bother with a renderer that can't render? Two big reasons:
 *
 *   1. **Tests without a browser.** "What would be drawn" becomes plain data,
 *      so a headless test can render a scene, hash the command log, and assert
 *      that the same seed produces byte-identical frames — the replay-hashing
 *      proof at the heart of Phase 0 (docs/ROADMAP.md).
 *   2. **Two implementations keep the interface honest.** Every future backend
 *      swap (Canvas2D → Pixi → WebGL) is only safe because the seam has been
 *      exercised by more than one implementation since day one.
 *
 * Commands are recorded verbatim — each entry is the command object spread
 * into a new object with a `kind` tag added, nothing normalized, nothing
 * defaulted. If a field was omitted by the caller it is absent from the
 * record too, so the log is exactly what crossed the seam.
 */

import type {
  CircleCmd,
  PolylineCmd,
  RectCmd,
  RendererBackend,
  TextCmd,
  ViewInfo,
} from './types'

/**
 * A RendererBackend that records draw commands instead of drawing them.
 *
 * `frames` is the log: one inner array per beginFrame/endFrame pair, each
 * starting with a `{ kind: 'begin', ...view }` entry and ending with
 * `{ kind: 'end' }`. `clear()` empties the log so one backend instance can
 * be reused across test cases.
 */
export interface NullBackend extends RendererBackend {
  readonly frames: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>
  clear(): void
}

/**
 * Creates a fresh null backend with an empty command log.
 *
 * The frame-sandwich rule (beginFrame → draws → endFrame) is enforced with
 * loud errors rather than silently tolerated: a draw call outside an open
 * frame is always a bug in the caller, and a recording backend is exactly the
 * right place to catch it early — in a fast headless test instead of as a
 * mysteriously blank canvas later.
 */
export function createNullBackend(): NullBackend {
  const frames: Array<Array<Record<string, unknown>>> = []
  let current: Array<Record<string, unknown>> | null = null

  function record(entry: Record<string, unknown>): void {
    if (current === null) {
      throw new Error(
        'null backend: draw call outside a frame — a frame is a sandwich: ' +
          'beginFrame first, draw calls in the middle, endFrame last',
      )
    }
    current.push(entry)
  }

  return {
    name: 'null',

    get frames(): ReadonlyArray<ReadonlyArray<Record<string, unknown>>> {
      return frames
    },

    beginFrame(view: ViewInfo): void {
      if (current !== null) {
        throw new Error(
          'null backend: beginFrame while a frame is already open — call endFrame first',
        )
      }
      current = [{ kind: 'begin', ...view }]
      frames.push(current)
    },

    drawRect(cmd: RectCmd): void {
      record({ kind: 'rect', ...cmd })
    },

    drawCircle(cmd: CircleCmd): void {
      record({ kind: 'circle', ...cmd })
    },

    drawPolyline(cmd: PolylineCmd): void {
      record({ kind: 'polyline', ...cmd })
    },

    drawText(cmd: TextCmd): void {
      record({ kind: 'text', ...cmd })
    },

    endFrame(): void {
      if (current === null) {
        throw new Error('null backend: endFrame without a matching beginFrame')
      }
      current.push({ kind: 'end' })
      current = null
    },

    clear(): void {
      frames.length = 0
      current = null
    },
  }
}
