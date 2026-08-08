---
title: What this is
description: The mission and shape of the math game engine.
---

A TypeScript 2D game engine for the web whose purpose is to motivate interest in and teach
mathematical concepts as they are applied in games. Three perspectives are first-class over one
world model — profile/side view, top-down, and isometric 2:1 dimetric — and switching between them
is itself the flagship lesson: **same world, different matrix**.

Target users are ages 10–18. The first product on the engine is a world editor with an interactive
tutorial that teaches both the tool and the math applied.

The authoritative design documents live in the repository:

- `docs/ARCHITECTURE.md` — world model, projection model, rendering ladder, education contracts
- `docs/ROADMAP.md` — Phases 0–6 with exit criteria and governance rules
- `docs/DECISIONS.md` — the living decision register (one-way doors vs. priced escape hatches)
- `docs/RISKS.md` — the risk register and where each mitigation is mechanically enforced

## Where the project stands

Phase 0 (bedrock) is implemented: the literate `@engine/math` package, the deterministic Clock
(pause / step-tick / step-substage), the owned renderer interface with null and Canvas2D backends,
replay-hash determinism tests, and a demo scene proving the whole stack end to end.
