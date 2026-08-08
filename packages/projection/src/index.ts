/**
 * @engine/projection — the curriculum centerpiece: projections as DATA,
 * picking as the inverse walk, depth as an ordering relation.
 *
 * Depends ONLY on @engine/math, so this package can be taught standalone.
 * Reading order: types.ts (what a Projection IS — the A·(x,y) + e·z
 * formula and the one-number-back picking story), then projections.ts (the
 * three lenses with their derivations), then stack.ts (camera ∘ projection
 * as a named pipeline), then depth.ts (the painter's sort).
 */

export type { WorldPoint, ProjectionName, InverseConstraint, Projection } from './types'
export { DEPTH_BAND_STRIDE } from './types'
export { createProfile, createTopDown, createIso } from './projections'
export type { TransformStage, TransformStack } from './stack'
export { createTransformStack, fitCamera } from './stack'
export type { DepthSortable } from './depth'
export { paintersOrder } from './depth'
