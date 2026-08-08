/**
 * @engine/renderer — the owned renderer seam.
 *
 * Three things live here, and only three:
 *
 *   - **the interface** (types.ts): flat, already-projected, screen-space draw
 *     commands. All curriculum math happens above this line; all pixels happen
 *     below it.
 *   - **the null backend** (null-backend.ts): records commands as plain data
 *     instead of drawing — the headless second implementation that powers
 *     replay-hash tests and keeps the interface honest.
 *   - **surface helpers** (surface.ts): canvas sizing, hiDPI, and resize
 *     notifications — browser-only at call time, safe to import in Node.
 *
 * Real pixel-producing backends (Canvas2D, and later others) live in their
 * own packages and depend on this one, never the other way around.
 */

export type {
  ViewInfo,
  RectCmd,
  CircleCmd,
  PolylineCmd,
  TextCmd,
  RendererBackend,
} from './types'

export type { NullBackend } from './null-backend'
export { createNullBackend } from './null-backend'

export type { SurfaceSize, Surface } from './surface'
export { createSurface } from './surface'
