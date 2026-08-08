---
title: Running the project
description: Commands for building, testing, and running the engine monorepo.
---

Requirements: Node ≥ 22 and pnpm 10.

```bash
pnpm install
pnpm test        # full suite, incl. replay-hash determinism proofs
pnpm lint        # incl. the determinism bans (no Date.now / Math.random / raw trig)
pnpm typecheck
pnpm build
pnpm dev:demo    # the Phase 0 demo: deterministic bouncing ball, profile view
```

## The Phase 0 demo

`pnpm dev:demo` serves a deterministic profile-view scene: a bouncing ball and a swaying platform,
with the ball's velocity (green) and gravity (orange) drawn as vectors. The controls are the point:

- **Pause** freezes the world.
- **Step tick** advances exactly one fixed timestep.
- **Step substage** runs *one named stage* of the next tick (`platform → integrate → collide`), so
  you can watch the velocity vector change **before** the position does — that ordering is
  semi-implicit Euler, and seeing it is the lesson.

Same seed, same inputs, same world — every run. That claim is enforced by tests, not asserted by
docs.
