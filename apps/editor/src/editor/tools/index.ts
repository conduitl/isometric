/**
 * The built-in tools, gathered for main.tsx: three plugins through the same
 * `{name, version, register}` door a third-party tool would use (the door
 * stays honest by having no back entrance — see @engine/core's Engine.use).
 *
 * Order is the toolbar's order: select, brush, placer — but note the
 * session's DEFAULT active tool is the brush, not the first plugin: a
 * first-run kid should paint on their very first click (session.ts pins
 * that choice).
 */

import type { EditorToolPlugin } from '../types'
import { brushToolPlugin } from './brush'
import { placerToolPlugin } from './placer'
import { selectToolPlugin } from './select'

export { createBrushTool, brushToolPlugin } from './brush'
export { createPlacerTool, placerToolPlugin } from './placer'
export { createSelectTool, selectToolPlugin, DRAG_THRESHOLD_PX } from './select'

/** Every built-in tool plugin, in select/brush/placer order. main.tsx walks
 * this list through session.use(...) — one line per tool, same as any
 * third-party plugin would install. */
export const builtinToolPlugins: readonly EditorToolPlugin[] = [
  selectToolPlugin,
  brushToolPlugin,
  placerToolPlugin,
]
