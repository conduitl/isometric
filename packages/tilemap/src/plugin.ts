/**
 * The tilemap plugin — the engine's plugin seam, used for real.
 *
 * Everything third parties will ever install goes through the same tiny
 * handshake: `{ name, version, register(engine) }`, handed to `engine.use()`
 * (docs/ARCHITECTURE.md §6). Tilemap is deliberately the FIRST package to
 * walk through that door, because a seam with no traffic is just a wish —
 * same reason the renderer grew a null backend on day one.
 *
 * v1 registration is intentionally small: one component schema. Phase 2
 * moves the real machinery in here as the editor arrives — brush and fill
 * painting ops as undoable commands, layer renderers wired up as
 * renderMirror systems, and tile picking through the active projection's
 * inverse. The seam is proven now so that growth is additions, not surgery.
 */

import type { Engine, EnginePlugin } from '@engine/core'

/**
 * Build the tilemap plugin. Registering it gives worlds the `tilePosition`
 * component: "this entity is pinned to tile cell (tx, ty)". Registered
 * schemas drive validation, the auto-generated inspector, and screen-reader
 * labels — one definition, three payoffs (docs/ARCHITECTURE.md §3).
 */
export function tilemapPlugin(): EnginePlugin {
  return {
    name: 'tilemap',
    version: '0.1.0',
    register(engine: Engine): void {
      engine.registry.register({
        name: 'tilePosition',
        defaults: () => ({ tx: 0, ty: 0 }),
        validate: (value) => {
          if (typeof value !== 'object' || value === null) {
            return 'tilePosition should be an object like { tx: 3, ty: 4 }'
          }
          const { tx, ty } = value as { tx?: unknown; ty?: unknown }
          if (!Number.isInteger(tx) || !Number.isInteger(ty)) {
            return (
              'tilePosition needs whole numbers for tx and ty — tile cells have no ' +
              'fractions (a thing at (3.5, 4) would sit between two cells)'
            )
          }
          return null
        },
        meta: {
          unit: 'tile cells',
          description: 'Which cell of the tile grid this entity is pinned to: column tx, row ty.',
        },
      })
    },
  }
}
