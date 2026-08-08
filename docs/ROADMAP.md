# Roadmap

> Week budgets assume 2–3 engineers plus (from Phase 2) a part-time curriculum author. They are
> re-baselined at each phase start. Governance rules at the bottom are as binding as the phases.

Every phase ends in something demonstrable. v1 ships at the end of Phase 3.

## Phase 0 — Bedrock: math you can read (weeks 1–5)

**Deliverable:** a deterministic demo scene (bouncing ball + moving platform in profile view)
rendered by the Canvas2D reference backend, with velocity/acceleration vector overlays and
pause/step-one-tick — running from CI on every commit with a replay-hash test proving determinism.

Scope:
- Monorepo scaffold: pnpm workspaces, Vite 8, tsdown, Vitest 4 (browser mode), Changesets, CI.
- `@engine/math`, complete with literate derivations in doc comments and property tests. Published
  0.x — frozen to the team, **not** semver-frozen (freeze follows first real consumption, Phase 2).
- `@engine/renderer` interface + **null headless backend** + `@engine/renderer-canvas2d` (uncached
  reference path; the cached fast path is designed now, built in Phase 1).
- Clock: fixed-timestep accumulator, interpolation alpha, pause/step-tick/step-substage/time-scale,
  seeded RNG. Lint rules banning wall-clock/`Math.random`/raw trig in system code, from day one.
- `@engine/testkit`: replay-hash harness, screenshot harness (pinned Chromium), perf-budget runner.
- Docs site **skeleton only** (no live-demo build gate yet — that lands Phase 3).

Exit criteria: renderer interface exercised by two backends with zero backend types leaking upward;
replay-hash and screenshot tests green in CI; math 0.x published with every public function carrying
its derivation.

## Phase 1 — One world, three projections (weeks 6–11)

**Deliverable:** a single world file viewed through profile, top-down, and isometric projections
with runtime switching (as curated lens on fixture worlds authored with all three asset sets),
correct click-picking in all three, and deterministic iso depth sorting — the "same world, different
matrix" demo that defines the product.

Scope:
- `@engine/core`: EC store (id-keyed document, stable monotonic ids, schema registry with
  unit/description metadata), phased scheduler, event queues, plugin registry.
- `@engine/projection`: three Projection objects as data (`A`, `e`, `depthKey`,
  `inverse(screen, constraint)`), Camera, TransformStack, picking with hover-ghost policy, stable
  painter's sort. v1 entities restricted to 1-tile footprints.
- `@engine/world-format`: format v1, atomic two-slot saves, migration runner, salvage mode, fixture
  corpus **including deliberately corrupted files**, student-language error translation table.
- `@engine/tilemap` as the first real plugin, **including the cached Canvas2D fast path**
  (OffscreenCanvas layer caches, cell-level dirty-rect, scaled-cache blits when zoomed out) and the
  256×256-per-layer cap.

Exit criteria: round-trip property tests green for all three projections; save/load round-trip
preserves ids and opaque blobs; determinism verified as **same build + pinned browser** (never
"across machines"); iso sort order matches committed expected orderings; a v0→v1 migration
exercised; 60 fps at 256×256 fully zoomed out on the 4×-throttled reference profile; core within
its 4k-LOC budget.

## Phase 2 — Editor alpha, Builder tier (weeks 12–18)

**Deliverable:** a usable world editor — paint tiles, place/move entities, save/load with backup
restore, full undo/redo — a teacher can build and keep a small world today, entirely from the
keyboard if they choose.

Scope:
- `@app/editor`: React 19 shell, `<EngineViewport>` boundary (commands in, throttled subscriptions
  out, render-on-demand), fixed CSS-grid layout.
- Command layer with the split undo substrate (Immer patches for entities/settings; typed-array
  run inverses for tile strokes) and the **transient-edit preview protocol** — specified before any
  tool code exists.
- Tools as plugins: tile brush, entity placer, selection via picking; ambient coordinate readout;
  grid + snapping. Keyboard operability from the start (arrow-key cell cursor + Enter to paint is
  also the coordinates lesson).
- Anchor registry (`data-anchor`) and the `builder.*` semantic-event vocabulary drafted, with
  gesture-level granularity conventions written down.
- **Curriculum author joins (part-time is fine).** Lesson hot-reload authoring harness delivered;
  school playtest pipeline (relationships, consent, scheduling) starts now — it takes months.

Exit criteria: 500-command interleaved fuzz test vs. replay oracle green; keyboard-only
build-save-reload Playwright flow + axe-core scan green; sustained frame budget on the throttled
profile while drag-painting; no React import below `@app/editor`; a non-engineer ships a lesson step
without an engine build; **math + projection/core semver 1.0 freeze happens here**, after real
consumption.

## Phase 3 — Tutorial engine + first arcs: SHIP v1 (weeks 19–26)

**Deliverable:** public v1. The editor plus interactive tutorial arcs 1–2 — **coordinates** and
**distance-as-Pythagoras** — fully gated on real in-canvas actions, plus the perspective-switch
reveal as a scripted, view-only showcase lesson on a fixture world. Docs site live. Every learner
ends with a keepable world file.

Scope:
- `@engine/tutorial`: lesson-as-data schema (no UI-state predicate type — world-state + frozen
  events only), resumable step machine, in-house DOM spotlight, world-space spotlights via lens.
- `@engine/lens` v1: grids, axes, coordinate readouts, **right-triangle distance overlay** (pulled
  forward — arc 2 needs it).
- `builder.*` event vocabulary and payload schemas frozen; lesson-replay corpus wired into CI.
- Docs site live with the first explorable pages; Starlight build becomes a release gate.
- Accessibility audit as exit criterion, not cleanup.

Exit criteria — the launch gate: **a pilot classroom of 20+ students on school Chromebooks completes
arcs 1–2 with <5% hitting perf or accessibility blockers**; every step gates on a semantic event or
world predicate (zero "click Next"); tutorial state survives reload; hint/reset escapes on every
step; a stuck student is treated as a P1 bug.

## Phase 4 — Tinkerer tier: the math becomes visible (months 7–9)

**Deliverable:** the inspector opens — draggable-AND-numeric vectors via dual-representation
binding, slope/distance/angle lenses, ghost jump-arc parabolas with editable gravity — and arcs 3–4
ship (vectors/normalization via "diagonal is too fast", profile-view functions/slope/parabola arc).

Scope: dual-rep binding on the preview protocol; `@engine/physics-lite` (gravity on z, Euler vs.
semi-implicit as a visible choice); trajectory ghosts; "why 2:1?" explorable begins; `tinkerer.*`
vocabulary frozen at exit; transfer probes (notation questions after gameplay) added to the standing
playtest protocol — completion rates alone are the DragonBox failure mode.

Exit criteria: dual binding used by 3+ unrelated panels with zero per-widget sync code; provenance
recording off = zero measurable frame cost (budgeted CI perf test); both arcs pass
create-the-need/do-then-explain design review; pilot classroom completes an arc with transfer
probes collected.

## Phase 5 — Engineer tier: the glass box opens fully (months 10–12)

**Deliverable:** the transform-stack panel with live matrices at every named stage, direct
projection-matrix editing (watch the world shear), substage stepping, transform-stack provenance
traces, and the iso arc — basis vectors, 2:1 at three explanation depths, picking as 2×2 inversion
derived by the student.

Scope: TransformStack panel (a read of already-reified objects); matrix cell editing through the
same command/undo layer; multi-tile footprints via `sortAnchor` + footprint splitting, with
screenshot regression scenes covering the known anomaly cases; script/expression surface against the
same public API the editor's own tools use; `engineer.*` vocabulary frozen at exit.

Exit criteria: editing a projection matrix cell live-updates the world with no special-case code; an
Engineer lesson has a student derive and apply the iso inverse; replay hashes identical with
inspectors open vs. closed; scripting API verified to be the editor's own API.

## Phase 6 — Scale, classrooms, and the decade horizon (months 13+)

**Deliverable:** the engine at its performance and ecosystem targets — the Pixi backend if the perf
gate has demanded it (it may have arrived earlier; the gate can trip in any phase), formal WCAG 2.2
AA certification over an already-accessible product, a documented plugin API proven by an external
author, classroom share/solution-comparison flows, and a published long-term support + format
stability policy.

Scope: `@engine/renderer-pixi` behind the parity screenshot suite (if not already pulled forward);
Tiled/LDtk importers **if teachers have asked**; shareable world links + "three ways other students
built this ramp" solution comparison; localization scaffolding; a recorded WebGPU go/no-go.

Exit criteria: reference Chromebook holds frame budget on the largest shipped world with whichever
backend won; an external developer ships a working plugin from docs alone; accessibility
certification passes; dependency audit shows third-party runtime deps confined to `@app/*` and
quarantined leaf packages.

---

## Governance rules (as binding as the phases)

1. **Budget breaches:** any phase exceeding 150% of its week budget triggers a cut from a pre-ranked
   scope-cut list written at phase start. A second consecutive breach is the alarm: stop and re-plan
   (the Pragmatist protocol — treat it as existential, not as slippage).
2. **Cut vertically, never horizontally:** fold a panel or defer an arc; never ship an
   uninspectable pipeline, a save path without backup/salvage, or a pointer-only tool.
3. **Standing health checks:** the CPU-throttled perf CI gate auto-pulls renderer-backend work
   forward; repeated slippage of the second-backend milestone means the renderer seam is leaking —
   investigate the seam, don't reschedule the milestone.
4. **Content is the critical path.** Lesson authoring runs in parallel with engineering from
   Phase 2 against frozen vocabularies. Engine-done ≠ product-done.
5. **Every playtest cycle includes transfer checks** (does manipulative mastery bridge to real
   notation?), an axis-confusion probe, and "a stuck student is a P1 bug".
