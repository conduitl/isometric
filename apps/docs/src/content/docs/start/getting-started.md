---
title: Getting started
description: Clone, install, run — the four dev commands and the test gates, with what each one proves.
---

Requirements: Node ≥ 22 and pnpm 10.

```bash
git clone <repository-url> && cd isometric
pnpm install
```

## The four dev commands

```bash
pnpm dev:editor                  # the world editor + lesson rail — the product
pnpm dev:demo                    # the Phase 0 demo: deterministic bouncing ball, profile view
pnpm --filter three-windows dev  # one world, three live projections side by side
pnpm --filter docs dev           # this site, with hot reload
```

**`pnpm dev:editor`** is where you should start. It opens the world editor with the interactive
tutorial attached: paint tiles, place entities, and watch the lesson rail advance on what you
actually *did* — every step gates on a semantic event or a fact about the world, never on clicking
"Next".

**`pnpm dev:demo`** is the oldest scene in the repository and still the clearest single lesson: a
bouncing ball whose velocity and gravity are drawn as vectors. Pause freezes the world; step-tick
advances exactly one fixed timestep; step-substage runs *one named stage* of the next tick, so you
can watch velocity change **before** position does — that ordering is semi-implicit Euler, and
seeing it is the lesson.

**three-windows** renders one world document through all three projections at once — the "same
world, different matrix" claim made visible instead of asserted.

**docs** serves this site locally. Its live demos import the engine's workspace sources directly,
so edits to `packages/*` show up here without a build step.

## The gates, and what each one proves

```bash
pnpm test        # the full unit suite
pnpm lint        # boundaries + determinism bans
pnpm typecheck   # strict TypeScript across every package
pnpm build       # every package and app compiles for real
pnpm e2e         # keyboard-only editor flow + accessibility scan
pnpm docs:build  # this site builds — a RELEASE gate
```

Each gate exists to keep a specific promise:

- **`pnpm test`** proves determinism and behavior. It includes the replay-hash tests (same seed +
  same inputs → byte-identical world snapshots, run twice and compared), the projection round-trip
  property tests (`worldToScreen ∘ screenToWorld = identity`), the undo fuzz suite (500 interleaved
  commands checked against a replay oracle), the world-format corpus (including deliberately
  corrupted files), and the lesson-replay corpus that re-runs every shipped tutorial step.
- **`pnpm lint`** enforces what convention alone would lose: no `Date.now`, no `Math.random`, no
  raw trig outside `@engine/math` (see [Determinism](/engine/determinism/)), and no UI-framework
  import below the app layer.
- **`pnpm e2e`** proves the editor works entirely from the keyboard (build, save, reload a world)
  and passes an axe-core accessibility scan. Schools are the buyer; this is not a cleanup pass.
- **`pnpm perf`** and **`pnpm perf:editor`** run frame-budget assertions on a 4×-CPU-throttled
  profile, and **`pnpm test:visual`** compares screenshots per backend. These three run on a
  **pinned local reference machine**, not in shared CI — shared-runner timing is noise, and a
  determinism claim is only honest within one pinned browser (`docs/DECISIONS.md` R10/R11).
- **`pnpm docs:build`** builds this site. It is a **release** gate, not a merge gate
  (`docs/DECISIONS.md` R9): a Starlight hiccup must never block an engine merge, but nothing ships
  while the docs — and the live demos compiled into them — fail to build.
