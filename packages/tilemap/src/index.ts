/**
 * @engine/tilemap — tile layers and the cached fast path. The first REAL
 * plugin package.
 *
 * Reading order for the curious:
 *
 *   - layer.ts — the flat-array grid and THE taught formula
 *     (index = y·width + x), plus tile↔world conversions and the
 *     revision/dirty bookkeeping that makes cache invalidation cheap.
 *   - raster.ts — the small pixel-surface seam that lets the cache render
 *     into an OffscreenCanvas in browsers and into recording fakes in tests.
 *   - render.ts — why caching works: render a layer once in view-plane
 *     coordinates, blit it through the camera every frame. The reason a
 *     256×256 world survives a school Chromebook (docs/RISKS.md).
 *   - plugin.ts — the {name, version, register} handshake every future
 *     plugin will copy.
 */

export { MAX_LAYER_SIZE, cellIndex, createTileLayer, getCell, layerRevision, setCell, tileToWorld, worldToTile } from './layer'
export type { CreateTileLayerOptions } from './layer'

export { createOffscreenRasterFactory } from './raster'
export type { RasterFactory, RasterTarget } from './raster'

export { createLayerRenderer, PROFILE_SLAB_HEIGHT } from './render'
export type { LayerRenderer, LayerRendererOptions } from './render'

export { tilemapPlugin } from './plugin'
