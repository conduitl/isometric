/**
 * The committed island world, loaded the same way a student's file would be.
 *
 * The fixture is a REAL .world.json sitting in fixtures/ — not a TypeScript
 * object pretending to be one. It goes through parseWorld like any file a kid
 * drags into the Load button, so the demo exercises the exact code path the
 * classroom will: text in, defensive ladder, World out. If the fixture ever
 * stops parsing, the app is broken and should say so at the top of its lungs.
 *
 * This module is deliberately the ONLY place that touches Vite's `?raw`
 * import (text-of-a-file-as-a-string is a bundler trick, not a platform
 * feature). Everything else asks loadIslandWorld() and stays bundler-agnostic.
 */

/// <reference types="vite/client" />

import type { World } from '@engine/core'
import { parseWorld } from '@engine/world-format'
import islandText from '../fixtures/island.world.json?raw'

/** The fixture's exact file text — what Save should reproduce byte for byte. */
export const ISLAND_WORLD_TEXT: string = islandText

/** What loading the fixture yields: the world AND parseWorld's warnings.
 * The fixture deliberately carries a component no engine version knows
 * ("secret"), so its parse produces a warning ON PURPOSE — the forward-
 * compatibility lesson. Handing the warnings to the caller instead of
 * swallowing them is what keeps that lesson visible. */
export interface IslandWorld {
  readonly world: World
  readonly warnings: readonly string[]
}

/**
 * Parse the committed island world. Throwing on failure is correct here —
 * a fixture that ships broken is a build mistake, not a user mistake, so it
 * gets a developer-loud error instead of the student-gentle LoadError path.
 */
export function loadIslandWorld(): IslandWorld {
  const result = parseWorld(islandText)
  if (!result.ok) {
    throw new Error(`three-windows: the committed island fixture failed to parse — ${result.error.message}`)
  }
  return { world: result.world, warnings: result.warnings }
}
