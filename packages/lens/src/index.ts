/**
 * @engine/lens — overlays that make the math visible.
 *
 * Reading order: types.ts (the contract and the public-APIs-only rule),
 * overlays.ts (cell highlights, arrows, the right-triangle distance
 * picture), spotlight.ts (the in-house DOM masked spotlight).
 */

export type { DrawLensOverlays, DomSpotlight } from './types'
export { drawLensOverlays } from './overlays'
export { createDomSpotlight } from './spotlight'
