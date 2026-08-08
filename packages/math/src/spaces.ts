/**
 * Coordinate-space brands — using the type checker to catch a whole family
 * of bugs before the game even runs.
 *
 * A Vec2 is just two numbers, but WHICH space those numbers live in changes
 * everything: (3, 2) in world space is a spot three meters right of origin,
 * two meters up; (3, 2) in screen space is nearly the top-left pixel of the
 * canvas; (3, 2) in tile space is a grid cell. Mixing them up — passing a
 * world position to a screen-drawing call without converting — is one of the
 * most common bugs in game code, and the compiler can't see it because every
 * Vec2 looks identical.
 *
 * Unless we tell it. Each type below is Vec2 plus an optional "brand": a
 * property keyed by a symbol that only this module knows, whose declared
 * value differs per space ('world' vs 'screen' vs 'tile'). The rules that
 * fall out of TypeScript's structural typing:
 *
 * - A raw Vec2 fits ANY space (the brand is optional, so a plain vector has
 *   nothing conflicting) — the math library stays usable everywhere.
 * - A tagged vector REFUSES to cross spaces: a WorldVec claims its brand is
 *   'world', which does not match a slot demanding 'screen'. The assignment
 *   is a compile error, which is the whole point.
 *
 * The brands VANISH AT RUNTIME. No property is ever actually created; the
 * symbol is `declare`d, never defined, and asWorld/asScreen/asTile return
 * the very same object they were given. This is a zero-cost, compile-time-
 * only discipline — the shipped JavaScript is identical to not using brands
 * at all. Crossing spaces on purpose is what Mat3 is for: a worldToScreen
 * matrix takes WorldVecs in one side and hands ScreenVecs out the other.
 */

import type { Vec2 } from './vec2'

// Declared but never defined: this symbol exists only in the type system.
// Nobody can construct the brand property at runtime — the tag cannot be
// forged, only asserted in types. Because the tag is OPTIONAL by design, a
// plain Vec2 (or a literal in an annotated position) fits any space; what
// the brands reject is a vector already tagged with one space crossing into
// another without an explicit, named conversion.
declare const SpaceTag: unique symbol

/** A Vec2 in WORLD space: y-up, measured in meters, origin at the world's anchor. */
export type WorldVec = Vec2 & { readonly [SpaceTag]?: 'world' }

/** A Vec2 in SCREEN space: y-down, measured in CSS pixels, origin at the canvas's top-left. */
export type ScreenVec = Vec2 & { readonly [SpaceTag]?: 'screen' }

/** A Vec2 in TILE space: integer-ish grid coordinates, one unit per map tile. */
export type TileVec = Vec2 & { readonly [SpaceTag]?: 'tile' }

/**
 * Assert "this vector is in world space." Pure type-level paint — returns
 * the same object, costs nothing at runtime. Use it at the boundary where a
 * vector's space becomes known (e.g. right after building a spawn point).
 *
 * Honest scope: brands police BOUNDARIES — assignments and function
 * signatures — not arithmetic. Every Vec2/Mat3 operation returns an
 * unbranded Vec2, so the first add/scale/lerp washes the paint off; re-tag
 * the result where its space matters. Dev-build runtime space tags
 * (docs/ARCHITECTURE.md §8) are the planned runtime complement.
 */
export const asWorld = (v: Vec2): WorldVec => v

/**
 * Assert "this vector is in screen space." Same zero-cost trick as asWorld —
 * typically applied to pointer/mouse coordinates as they enter the engine.
 */
export const asScreen = (v: Vec2): ScreenVec => v

/**
 * Assert "this vector is in tile space." Same zero-cost trick as asWorld —
 * typically applied to grid coordinates coming out of map data.
 */
export const asTile = (v: Vec2): TileVec => v
