/**
 * Pins the semantic-space brands to what the compiler ACTUALLY enforces, so
 * the docs can never overclaim again (review finding, spaces.ts):
 *
 * - a tagged vector refuses to cross spaces without a named conversion;
 * - a plain Vec2 fits any space — the tag is optional by design;
 * - arithmetic launders the brand (operations return plain Vec2) — accepted
 *   behavior, re-tag at boundaries.
 *
 * The @ts-expect-error lines are verified by `pnpm typecheck`, not vitest:
 * if the brand encoding ever stops rejecting cross-space assignment, the
 * typecheck gate fails.
 */
import { describe, expect, it } from 'vitest'
import type { ScreenVec, WorldVec } from '../src/index'
import { asScreen, asWorld, Vec2 } from '../src/index'

describe('semantic spaces', () => {
  it('tagging is free: same object back, nothing added at runtime', () => {
    const v = Vec2.make(3, 4)
    expect(asWorld(v)).toBe(v)
  })

  it('a tagged vector refuses to cross spaces; a plain Vec2 fits anywhere', () => {
    const w: WorldVec = asWorld(Vec2.make(1, 2))
    // @ts-expect-error a WorldVec must not be assignable where a ScreenVec is required
    const s: ScreenVec = w
    expect(s).toBe(w) // runtime: the very same object — brands are compile-time only

    const plain: Vec2 = Vec2.make(1, 2)
    const enters: ScreenVec = plain // no error: the tag is optional by design
    expect(enters).toBe(plain)
  })

  it('arithmetic launders the brand — re-tag where the space matters', () => {
    const w = asWorld(Vec2.make(1, 2))
    const moved = Vec2.add(w, Vec2.make(1, 0)) // plain Vec2: the brand is gone
    const rescreened: ScreenVec = asScreen(moved)
    expect(rescreened).toEqual({ x: 2, y: 2 })
  })
})
