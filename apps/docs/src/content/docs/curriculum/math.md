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
  deterministic-approximation upgrade path exists).
- **`createRng`** — seeded randomness (mulberry32), because replays, fairness, and tests all need
  "random" to mean *reproducibly* random.
- **Space brands** — `WorldVec` vs `ScreenVec` vs `TileVec`: mixing coordinate spaces is a compile
  error in engine code, and a teachable moment everywhere else.

The full literate reference — with live, editable demos embedded in these pages — lands when this
site becomes the executable curriculum in Phase 3. Until then, the source itself is the reference:
`packages/math/src/`.
