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

The unusual requirement that shapes everything: the math must be visible and inspectable, not
hidden. Coordinates, vectors, slope, matrices and linear transforms are the product, not
implementation details. So everything the mission teaches is small, owned, readable code, and
everything commodity is a boring dependency behind a seam we own.

The authoritative design documents live in the repository:

- `docs/ARCHITECTURE.md` — world model, projection model, rendering ladder, education contracts
- `docs/ROADMAP.md` — Phases 0–6 with exit criteria and governance rules
- `docs/DECISIONS.md` — the living decision register (one-way doors vs. priced escape hatches)
- `docs/RISKS.md` — the risk register and where each mitigation is mechanically enforced

## Where the project stands

Phase 3 — the v1 push. Built and tested so far:

- **Phase 0, bedrock:** the literate `@engine/math` package, the deterministic Clock
  (pause / step-tick / step-substage), the owned renderer interface with null and Canvas2D
  backends, replay-hash determinism tests.
- **Phase 1, one world three projections:** `@engine/projection` (projections as data, picking as
  the inverse walk, painter's-sort depth), `@engine/core` (the entity-component store and
  scheduler), `@engine/world-format` (the classroom-hardened file format), `@engine/tilemap`.
- **Phase 2, editor alpha:** the world editor — tile painting, entity placement, save/load with
  backup restore, full undo/redo, keyboard-operable throughout. The `@engine/math`, `projection`,
  and `core` APIs froze at 1.0 here, *after* their first real consumers used them in anger.
- **Phase 3, in progress:** the tutorial engine (`@engine/tutorial`), the lens overlay layer
  (`@engine/lens`), the frozen `builder.*` event vocabulary lessons stand on, the first arcs
  (coordinates, distance-as-Pythagoras, the perspective-switch reveal) — and this docs site.

## Why the docs look the way they do

The same rule that governs the engine governs these pages: show the real thing. Live demos on this
site import the actual `@engine/*` workspace sources — the [projection
page](/engine/projections/) draws its diamonds with the same `createIso()` students read — so a
broken engine breaks the docs build. Honest pages or no pages.
