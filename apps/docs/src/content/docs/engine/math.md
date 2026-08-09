---
title: The math package
description: '@engine/math is assigned reading — the code is the curriculum.'
---

`@engine/math` is a zero-dependency library where every exported function carries its derivation in
its doc comment, pitched at a curious teenager. It is deliberately small enough to read end to end:

- **`Vec2`** — vectors as plain `{ x, y }` data: add, scale, dot ("how much do these point the same
  way"), length (Pythagoras), normalize, perp, lerp.
- **`Mat3`** — 2D affine transforms as the *same six numbers* the browser's
  `ctx.setTransform(a, b, c, d, tx, ty)` takes. Compose, apply, invert (with the honest story of
  why a zero determinant can't be undone).
- **`Scalar`** — lerp, clamp, and the trig wrappers every other package must use (so a
  deterministic-approximation upgrade path exists — see
  [Determinism](/engine/determinism/)).
- **`createRng`** — seeded randomness (mulberry32), because replays, fairness, and tests all need
  "random" to mean *reproducibly* random.
- **Space brands** — `WorldVec` vs `ScreenVec` vs `TileVec`: mixing coordinate spaces is a compile
  error in engine code, and a teachable moment everywhere else.

Why no `gl-matrix`, no `mathjs`, no dependency at all? Because a dependency may never sit where the
curriculum lives — no external library can be asked to keep its derivations in its doc comments or
to stay readable by a 14-year-old. Readability here is a shipping requirement, not a style
preference: this package froze at semver 1.0 only *after* the editor and the first lesson had
consumed it in anger, because every engine team learns its vector API is wrong the first time a
real caller uses it.

The source is the reference: `packages/math/src/`, starting with `scalar.ts` (one-number tools),
then `vec2.ts` (positions and directions), then `mat3.ts` (transforms), then `rng.ts` (repeatable
randomness), then `spaces.ts` (making the compiler catch coordinate-space mixups). The [projection
demo](/engine/projections/) on this site runs on these exact sources.
