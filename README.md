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

**Phase 3 complete (pending commit); the classroom pilot is the remaining v1 launch gate.**
The tutorial engine ships: lessons are data (`@engine/tutorial` — the frozen `builder.*`
vocabulary with type-pinned payload governance, world-state + event predicates with **no UI-state
predicate type at all**, a resumable step machine whose progress survives reload), overlays make
the math visible (`@engine/lens` — the live right-triangle that labels itself 3-4-5 **while you
drag the crate**, world spotlights, and the in-house DOM masked spotlight), and three lessons run
end to end in the editor: *First tiles* (coordinates), *The distance picture*
(distance-as-Pythagoras, moment-gated so leftover crates can never pre-satisfy a step), and
*Three views* (the perspective-switch reveal on a showcase island — view-only, with the student's
own world parked and save refused until they come back to it). Zero steps anywhere gate on
"click Next"; every step has escalating hints (keyboard path included) and a reset escape; the
lesson-replay corpus drives every shipped step through the real engine in CI; hot-reload lesson
authoring is proven (edit a lesson file, the rail follows, no build). The docs site is live
(`pnpm docs:build`, 9 pages) with a projection demo importing the real package sources, and the
R9 release gate exists as a workflow. The adversarial review pass confirmed 29 findings (zero
refuted) — headliners: the freeze test pinned payload *names* but not *types*; the step machine
had no reentrancy guard against its own effects' events; a restored parked world wore a lying
'saved' badge; and the flagship drag-the-triangle moment silently didn't happen — all fixed with
regression tests. Suite: 736 unit tests, 14 visual baselines, 9 e2e tests (twice, retries 0),
axe clean across four tutorial states, drag-paint at 8.3 ms against the 16.7 ms budget.

Earlier: **Phase 2** — the keyboard-first world editor (split undo substrate, two-slot saves with
backup restore, tools as plugins, `builder.*` vocabulary drafted, math/projection/core frozen at
1.0.0 — D9). The world editor is usable end to end
(`pnpm dev:editor`): paint tiles, place/move/rename/delete entities, full undo/redo on the split
substrate (Immer patches for entities, run-inverse strokes for tiles), atomic saves with backup
restore surfaced in the UI, and every operation works **entirely from the keyboard** — proven by a
keyboard-only build→move→save→reload→restore-backup Playwright flow plus an axe scan with zero
violations at any severity. Drag-painting a 256×256 world holds 60 fps on the 4×-throttled
reference profile (`pnpm perf:editor` — 8.3 ms mean against the 16.7 ms budget). The lesson
authoring harness ships with lesson 01 ("First tiles"): a curriculum author edits a data file and
the lesson rail hot-reloads without an engine build. The `builder.*` event vocabulary and the
`data-anchor` registry are drafted with their governance tripwires tested. **`@engine/math`,
`@engine/projection`, and `@engine/core` are frozen at 1.0.0** (decision D9) — after real
consumption, per the staging rule. An adversarial review (5 reviewers, per-finding verification)
confirmed 26 findings, all fixed with regression tests; a manual inspection of the visual baseline
then caught one more that every automated gate had missed — the vertical arrow keys moved the
cursor south on ArrowUp, the screen-array habit contradicting the engine's own math-class y-north
axes (D3). The keys, the picture, and the lesson prose now agree: **up is north.**

Earlier: **Phase 1** — one world file rendering through profile, top-down, and isometric
projections simultaneously with cross-view picking (`pnpm --filter three-windows dev`); the world
format's two-slot saves, migrations, salvage mode, and corrupted-file corpus; the tilemap cache
(~10× per-tile drawing, `pnpm perf`); and the review that caught the iso/top-down mirror-image
chirality bug while zero world files existed (decision D7).

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
