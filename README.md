# Math Game Engine (working name TBD)

A TypeScript 2D game engine for the web that teaches mathematical concepts by making them visible:
the engine's own coordinates, vectors, matrices, and projections are the curriculum. Three
perspectives are first-class over one world model — profile/side view, top-down, and isometric 2:1
dimetric — and switching between them is itself the flagship lesson: *same world, different matrix*.

Target users: ages 10–18 (with adult appeal). First product: a **world editor with an interactive
tutorial** that teaches both the tool and the math applied. Long-lived project: maintained for
years by a small team, so foundation quality is prioritized — but with hard shipping gates.

## The idea in one paragraph

Everything the mission teaches — the math library, the projection pipeline, the world model, the
game loop, the tutorial engine — is small, owned, literate TypeScript readable by a motivated
15-year-old. Everything commodity — fast quad drawing, editor chrome, build tooling — is the
healthiest boring dependency in its niche, quarantined behind seams we own so each stays swappable
for a decade. Every value a student can see is a named, inspectable, invertible object; the update
loop pauses and single-steps; "how does clicking work?" is literally answered by inverting a matrix.

## Documents

| Document | What it covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | World model, projection model, rendering ladder, editor, world files, education contracts, tutorial system, package map, testing strategy |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases 0–6 with deliverables, week budgets, exit criteria, and governance rules |
| [docs/DECISIONS.md](docs/DECISIONS.md) | The living decision register: one-way doors vs. reversible doors, every dependency with its priced escape hatch |
| [docs/RISKS.md](docs/RISKS.md) | Risk register with mitigations and where each is mechanically enforced |

## Status

**Phase 1 complete (pending commit); Phase 0 shipped.** One world file renders through profile,
top-down, and isometric projections simultaneously with cross-view picking (`pnpm --filter
three-windows dev`); the world format has atomic two-slot saves, migrations, salvage mode, and a
corrupted-file fixture corpus; the tilemap cache holds 60 fps at 256×256 fully zoomed out on the
4×-throttled reference profile (`pnpm perf` — measured ~10× faster than per-tile drawing). An
adversarial review pass (4 reviewers, per-finding verification) confirmed 20 findings — including
an iso/top-down mirror-image chirality bug caught while zero world files existed (decision D7) —
and all are fixed with regression tests.

Earlier: **Phase 0** (bedrock) below. Architecture and roadmap defined August 2026 (four researchers, three
independent proposals, a three-judge panel, and an adversarial red-team review — amendments folded
into these documents). The Phase 0 foundation is scaffolded and green:

- pnpm monorepo with `@engine/math` (literate, zero-dep), `@engine/core` (deterministic Clock),
  `@engine/renderer` (owned interface + null headless backend), `@engine/renderer-canvas2d`
  (reference backend), `@engine/testkit` (replay hashing), and `apps/bedrock-demo`.
- Determinism enforced from day one: ESLint bans wall-clock/unseeded-random/raw-trig in engine
  source; the replay-hash test (same seed + inputs → identical state and frame hashes, run twice)
  passes in CI.
- `pnpm dev:demo` runs the Phase 0 deliverable: a deterministic bouncing ball + swaying platform in
  profile view with velocity/gravity vector overlays and pause / step-tick / step-substage controls.

Remaining for Phase 0 exit (see [docs/ROADMAP.md](docs/ROADMAP.md)): screenshot-test harness on a
pinned browser, docs-site skeleton, math API team review.
