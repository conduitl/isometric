# Architecture

> Status: v1.0 of this document, August 2026. This is the synthesis of a multi-perspective design
> process (three independent architecture proposals, a three-judge panel, and an adversarial red-team
> review). The working package scope `@engine/*` is a placeholder until the product is named.
> Companion documents: [ROADMAP.md](ROADMAP.md), [DECISIONS.md](DECISIONS.md), [RISKS.md](RISKS.md).

## 1. What we are building

A TypeScript 2D game engine for the web whose purpose is to motivate interest in and teach
mathematical concepts as they are applied in games. Three perspectives are first-class and share one
world model — profile/side view, overhead/top-down, and isometric 2.5D (2:1 dimetric) — with more
projections possible later. Target users are ages 10–18 (with adult appeal). The first product on
the engine is a **world editor with an interactive tutorial** that teaches both the tool and the math.

The unusual requirement that shapes everything: **the math must be visible and inspectable, not
hidden**. Coordinates, vectors, slope, trigonometry, matrices and linear transforms are the product,
not implementation details. This inverts the usual build-vs-buy calculus: everything the mission
teaches is small, owned, readable code; everything commodity is a boring dependency behind a seam we
own.

## 2. Design principles

1. **The glass box is the product.** Every mathematical object the curriculum touches — vectors,
   projection matrices, the camera, the clock, even event queues — is a named, reified,
   JSON-serializable, subscribable data object, with an inverse where one is meaningful. No anonymous
   math inside render functions. Retrofitting inspection into an opaque pipeline is the one failure
   we cannot patch later.
2. **Own the curriculum, buy the commodity — behind owned seams.** The math library, projection
   pipeline, world model, loop, and tutorial engine are in-house and readable by a motivated
   15-year-old. Fast quad drawing, editor chrome, and build tooling are the healthiest boring
   dependency in each niche, quarantined so each remains swappable. Every dependency has a priced
   escape hatch recorded in [DECISIONS.md](DECISIONS.md).
3. **Determinism is a feature, scoped honestly.** Fixed timestep, seeded RNG, no wall-clock in
   systems. Determinism claims are **same build + same pinned browser** — never cross-machine
   float identity. It powers "predict, then step, then compare" pedagogy, tutorial validation,
   replay, and screenshot testing.
4. **One document, three tiers.** A single world file serves the 10-year-old painting tiles
   (Builder), the 14-year-old dragging vectors (Tinkerer), and the 17-year-old editing the
   projection matrix (Engineer). Tiers are soft UI disclosure — panels folded, never locked.
5. **The canvas is never the sole source of truth.** Every canvas-visible state is mirrored in DOM
   panels (screen-reader reachable); every tool is keyboard-operable. Accessibility is a per-phase
   exit criterion, not a cleanup pass — schools are the buyer.
6. **Cut scope vertically, never horizontally.** Fold a panel to ship late; never ship an
   uninspectable pipeline. A folded panel ships in a point release; an opaque pipeline is a rewrite.

## 3. World model

One world model feeds all perspectives: a **ground plane plus elevation**.

- Axes, fixed once and documented loudly: `x` = east, `y` = north, `z` = up (elevation, default 0),
  in world units. The screen's y-down convention is pushed into each projection matrix — "find the
  −1 that flips the graph" is a lesson, not a mystery.
- An entity is a plain JSON object a 12-year-old can read in the console:

  ```json
  {
    "id": "e42",
    "name": "player",
    "components": {
      "position": { "x": 3, "y": 4 },
      "elevation": { "z": 0 },
      "velocity": { "x": 1, "y": 0 },
      "sprite": { "tileset": "characters", "index": 7 }
    }
  }
  ```

- **IDs are per-world monotonic counters, never recycled**, with `nextEntityId` persisted in the
  file. Stable identity across sessions and saves is what editor selection, undo patches, and
  tutorial predicates key on — this is a declared one-way door.
- Components are schema-validated plain data (no classes, no functions). Schemas are registered
  through the plugin API and drive validation, auto-generated inspector UI, and screen-reader
  labels (each schema carries unit + description metadata from day one).
- Systems are named functions in an explicit, visible, ordered scheduler with named phases:
  `input → simulate → post → renderMirror`. "Entities are rows, components are columns, systems are
  verbs" is itself a taught data-modeling lesson.
- Simulation events are **double-buffered queues drained at fixed loop points** — inspectable "mail
  in a mailbox" that survives single-stepping. A small typed emitter exists only at the engine↔UI
  boundary, where determinism doesn't matter.
- **In memory, the world document keys entities by id** (`Record<EntityId, Entity>`); arrays exist
  only in the serialized file. This keeps undo patch paths id-stable across interleaved
  create/delete/undo sequences (see §6).
- Tile layers are flat row-major arrays (`index = y·width + x` — a taught formula) held **outside**
  the patch-based state as typed arrays (see §6).
- Rendering hierarchy is a rendering concern: a thin adapter mirrors EC state into the backend's
  display list each frame. Parent-child chains never complicate identity or serialization.

**Owning the z-up friction.** Every platformer tutorial on the internet says jumping changes Y; here
a platformer jump changes `z`. This is correct by design (gravity is the same equation in every
view) and permanently frictional, so it is owned as curriculum, not patched as UI: per-projection
display metadata (profile inspector shows "height (z)"), a dev-build console pretty-printer that
prints vectors with space and axis annotations, a permanent axis compass in every viewport, a
90-second "why is up called z here?" micro-lesson on first profile-view open, and an axis-confusion
probe in the standing playtest protocol.

## 4. Projection model

A **Projection is data, not code**:

```ts
interface Projection {
  name: string
  params: Record<string, number>        // tileW, tileH, zScale, scale…
  ground: Mat3                          // A — the ground-plane linear map (homogeneous)
  elevationVector: Vec2                 // e — where one unit of elevation moves the screen point
  depthKey(entity): number              // painter's-sort key
  inverse(screen: ScreenVec, constraint: InverseConstraint): WorldVec
}
// worldToScreen(p, z) = A·p + e·z          view = camera ∘ projection (composition is the lesson)
```

The three built-ins:

| Projection | Ground matrix A | Elevation e | What it teaches |
|---|---|---|---|
| Profile | `[[s, 0], [0, 0]]` (rank-deficient: y collapses to lanes) | `(0, −s)` | Functions as terrain (`y = f(x)`), slope, parabolas, gravity |
| Top-down | `s·[[1, 0], [0, −1]]` (the y-flip, taught) | `(0, 0)` (shadow/scale optional) | Cartesian coordinates, distance-as-Pythagoras, vectors, angles |
| Iso 2:1 dimetric | east → `(tileW/2, tileH/2)`, north → `(tileW/2, −tileH/2)` (i.e. `screen = ((x+y)·tileW/2, (x−y)·tileH/2)`), `tileW = 2·tileH` | `(0, −zScale)` | Linear maps, basis vectors, 2×2 inversion, why exact halves beat true 30° isometric |

The iso camera looks from the **south-east** (matching profile's south-facing camera), chosen so the
world keeps the same winding in every view — iso's determinant carries the same sign as top-down's,
so a kid's map is never mirror-reversed between the two primary windows (decision register D7; the
classic games formula `(x−y, x+y)` assumes y-south screen-style coordinates and silently mirrors a
y-north world).

- **Picking is the inverse, with an honest twist.** A 2D click cannot determine three world numbers,
  so `inverse(screen, constraint)` is parameterized — by the ground plane `z = 0` by default, by a
  dragged entity's current elevation, or (in profile, where A is rank-deficient) by the active lane.
  "Two numbers in, three numbers out needs one number back" is taught directly and foreshadows 3D
  ray picking. For top-down and iso the ground inverse is a closed-form 2×2 students derive by hand
  (`det = tileW·tileH/2`). Picking through stacked elevations iterates candidate z-bands top-down,
  and **every placement tool shows a live hover ghost at the resolved cell/elevation** so "where
  will my click land?" is always visible.
- **Depth sorting** is a stable painter's sort keyed `(layerBand, x − y + z, entityId)` (the
  south-east camera's ordering relation: farther east and farther south is closer). v1
  restricts entities to 1-tile footprints, sidestepping the classic multi-tile anomaly; Phase 5 adds
  explicit `sortAnchor` components and footprint splitting, with the anomaly documented as the
  lesson that 2.5D is a projection, not a geometry.
- The full pipeline is a reified, named **TransformStack** — `local → world → camera → projection →
  screen` — every stage enumerable, subscribable, and invertible. The Tier-3 transform panel is a
  read of existing objects, not a retrofit.
- **Projection switching ships as a curated lens, not a general editing mode (v1).** "Every
  perspective is just a different matrix" is true for points and false for art and game-feel: iso
  art is 2:1 diamonds, profile motion is edge-on in top-down. So every world declares a primary
  projection; alternate projections render real geometry with schematic fallbacks (colored footprint
  quads, elevation posts, outlines) labeled "X-ray view" unless per-projection art exists. The
  flagship perspective-switch reveal lesson runs on fixture worlds authored with all three asset
  sets. The upgrade path to full multi-projection editing is priced in the decision register.

## 5. Rendering

All curriculum math lives **above** the renderer. The renderer consumes flat, already-projected 2D
screen-space draw commands through an owned interface of ~12 methods (`beginFrame`/`endFrame`,
`drawSpriteBatch`, `drawTilemapLayer`, lines/shapes/text for overlays), plus canvas lifecycle
helpers (ResizeObserver sizing, DPR, dirty-flag render-on-demand).

Backend ladder:

1. **Null headless backend (Phase 0).** Validates the interface against two implementations from
   day one and serves tests. Every future backend swap becomes a proven bounded operation.
2. **Canvas2D reference backend (ships v1).** Two documented modules: a few-hundred-line *uncached
   reference path* that is itself curriculum (`ctx.setTransform` literally exposes the 2×3 matrix
   being taught — assigned reading), and a *cached fast path* ("why caching works" is also a
   lesson): each tile layer renders once into an OffscreenCanvas, blitted per frame under the camera
   transform, with cell-level dirty-rect invalidation on paint; zoomed-out views blit the scaled
   cache and never draw per-tile. v1 enforces a friendly **256×256-per-layer world size cap**.
3. **PixiJS v8 backend (pre-priced, perf-gated).** Wrapped as a dumb display list behind the same
   interface — no Pixi concept ever crosses upward. A CI dependency-cruiser rule makes
   `@engine/renderer-pixi` the only package allowed to import `pixi.js`. The CPU-throttled perf CI
   gate (§11) is the automatic trigger that pulls this work forward (~2-week bounded job).
4. **In-house WebGL2 sprite/tilemap batcher (~2–5k LOC).** The decade escape hatch if Pixi ever
   sours (hostile v9, stagnation). **WebGPU** is a reserved future backend slot (~2028); on low-end
   Chromebooks WebGL2 remains the floor that matters.

**Backend parity is an executable contract:** every backend must pass the identical
deterministic-scene visual-regression suite, compared within one pinned browser. If the
second-backend milestone slips repeatedly, that is the alarm that the seam is leaking.

## 6. The editor

The engine is a framework-free TS library that owns the canvas element, the rAF loop
(render-on-demand with a dirty flag — near-zero idle CPU for Chromebook battery), ResizeObserver
sizing, and DPR handling. **React 19 mounts it exactly once** via `<EngineViewport>` and
communicates across a hard boundary: typed named **commands in, throttled store subscriptions out**.
Never per-frame `setState`; no React import below `@app/editor` (CI-enforced). This boundary is what
keeps a future Svelte swap contained to one package.

**Undo/redo substrate** (designed before Phase 2 code exists — the red team's highest-value fix):

- Entity- and settings-scale edits go through named commands executing via Immer
  `produceWithPatches` against the id-keyed world document; history is a stack of
  forward/inverse patch pairs. Id-keyed paths survive interleaved create/delete/undo.
- **Tile-raster edits live outside Immer** as typed arrays with run-based manual inverses: a brush
  stroke coalesces into one command storing affected cell runs before/after. This avoids the
  documented Immer worst case (large arrays, many small writes) in the paint-feel hot path, and
  keeps undo memory proportional to commands, not brush pixels.
- Undo history is **session-scoped in v1 — never persisted into world files**. Persisted
  "replay how I built this" is deferred until a design survives format migration.
- CI gates: `apply ∘ invert = identity` property-tested per command, plus a 500-command fuzz test
  interleaving create/delete/paint/undo/redo/save-load compared against a command-log replay oracle.

**Transient-edit protocol** (specified up front so dual-representation binding has one mechanism,
not three hacks): gizmo and numeric-field drags write to an engine-side uncommitted **preview
channel** that bypasses undo, renders immediately, and drives linked numeric displays at rAF rate
outside React's throttled store. Pointer-release commits exactly one command built from preview
start/end state; Esc discards.

Editor tools (tile brush, entity placer, selection) are installed through the same
`{name, version, register(engine)}` plugin API third parties will use. Every pointer event converts
screen→world through the active projection's inverse — the editor dogfoods the curriculum on every
click. v1 panel layout is a fixed CSS grid (docking libraries deferred, reversible).

## 7. World files

A custom, minimal, human-readable JSON format — the project's **declared one-way door**. Files in
classrooms outlive every library choice, so this gets the most conservative treatment in the system:

```jsonc
{
  "formatVersion": 1,
  "meta": { "worldId": "…", "name": "…" },
  "settings": { "tileSize": 32, "primaryProjection": "topdown", "fixedDt": 0.0166, "seed": 12345 },
  "nextEntityId": 43,
  "tilesets": [ … ],
  "layers": [ { "id": "l1", "width": 64, "height": 64, "elevation": 0, "cells": [ /* flat row-major */ ] } ],
  "entities": [ /* array in the FILE; id-keyed map in MEMORY */ ]
}
```

- Integer `formatVersion`; migrations are an ordered chain of pure functions `migrate[n]: vN→vN+1`
  run by a ~50-line owned runner. Old semantics are never mutated, only new versions added.
- Unknown component types round-trip as opaque blobs (forward compatibility for plugins).
- **Hardened for real children on real Chromebooks:** every save is atomic two-slot (write new blob,
  re-parse and validate it, then promote; the previous good save is always retained and surfaced as
  "restore backup"). The loader runs a lenient structural pre-check before the migration chain, and
  each migration step validates its input's minimal shape — corruption produces a diagnosis, never a
  raw TypeError. A salvage mode recovers all parseable entities/layers and reports losses in student
  language.
- The CI fixture corpus contains a file from **every** released version plus deliberately truncated,
  hand-mangled, and mid-write-crashed files. (The glass-box ethos encourages kids to hand-edit their
  files; the loader must expect it.)
- All loader errors pass through an in-house translation table with age-appropriate text. Raw Zod
  messages reaching the UI is a named bug class. Zod v4 itself is quarantined inside
  `@engine/world-format` — never exported in public types, swappable.
- Tiled TMJ / LDtk are **import-only boundary formats, deferred until a real teacher asks**. Their
  legacy encodings (GID flip-bits) never enter our schema.

## 8. Education contracts on the core

These are structural contracts, cheap to bake in now and ruinous to retrofit:

- **The Clock:** fixed-timestep accumulator (Gaffer pattern) at 60 Hz with a 30 Hz low-end profile,
  render interpolation with the alpha exposed (it *is* the lerp lesson), and
  pause / step-one-tick / step-one-substage / time-scale. "Freeze the world and watch the vectors
  change" is the core pedagogical interaction and a foundation feature.
- **Overlays/lens layer:** grids, axes, labeled vector arrows, right-triangle distance
  visualizations, head-to-tail vector arithmetic, ghost trajectories, basis-vector probes, matrix
  HUD, world-space tutorial spotlights — built strictly on public APIs, so any private shortcut
  breaks visible features immediately (dogfooding keeps the API honest).
- **Dual-representation binding (GeoGebra's soul as infrastructure):** every inspectable value has
  linked numeric and visual forms, two-way, with shared hover-highlight — hover the matrix cell and
  the basis arrow glows; drag the arrow and the number changes. Built on the transient-edit
  protocol from day one.
- **Provenance, scoped to what is already data (v1):** "how was this screen position computed?" is a
  named walk through the reified TransformStack — near-zero new machinery — plus an `explain()`
  convention on physics-lite outputs. Arbitrary-value provenance is out of scope until a shipped
  lesson requires it. Two CI invariants: provenance off = zero measurable frame cost, and replay
  hashes bit-identical with inspectors open vs. closed (catches the observe-changes-behavior bug).
- **Semantic events, versioned like the file format:** namespaced by tier (`builder.tile-painted`,
  `tinkerer.vector-dragged`, `engineer.matrix-edited`), each tier's vocabulary frozen at its own
  phase (Builder at Phase 3, Tinkerer at Phase 4, Engineer at Phase 5), additive-only after its
  freeze, **payload schemas frozen too**, gesture-level granularity by convention (never per-frame),
  with a permanent alias table so shipped lessons replay forever.
- **Anchor registry for UI chrome:** lessons may only reference editor chrome through versioned
  anchors (`data-anchor="palette.tileBrush"`), governed exactly like the event vocabulary —
  additive-only, CI-checked; renaming an anchor without an alias fails the build.
- **Branded semantic spaces:** `WorldVec` / `TileVec` / `ScreenVec` make space-mixing a compile
  error in engine code. Because brands vanish at runtime, dev builds carry a space tag on vectors
  with assertion messages written for students ("this point is in screen pixels — use
  screenToWorld() to convert"), stripped from production hot paths; the Engineer-tier script surface
  exposes friendly wrappers whose type errors are custom-worded, never raw brand-mismatch noise.
- **Tiers:** Builder / Tinkerer / Engineer are soft disclosure over one document — folded, never
  locked, unlocked by action, never age-gated. The ceiling is always visible from the floor.

The concept-to-perspective staircase falls out of the projection model: profile teaches functions,
slope, and parabolas; top-down teaches coordinates, Pythagoras-as-distance, normalization ("why is
diagonal faster?"), atan2; iso is the linear-algebra classroom (basis vectors visible as "where one
world-step east lands on screen", picking as 2×2 inversion, depth as the ordering relation
`x − y + z`) — with vectors, distance, and lerp deliberately recurring across all three to teach
invariance.

## 9. The tutorial system

A lesson is **data, not code**, in `@content/lessons` (hot-reloaded in dev so curriculum authors
iterate without engine builds):

```ts
interface LessonStep {
  id: string
  target: { anchor: AnchorId } | { world: EntityId | TileRegion }   // registry-checked
  instruction: Markdown                   // rendered in the lesson rail + in-canvas annotations
  hints: Markdown[]                       // every step has hint + reset escapes
  onEnter?: Effect[]                      // load fixture region, toggle overlay, pause clock, set projection
  completion: Predicate                   // over frozen semantic events + world-state queries ONLY
}
```

- **The step schema has no UI-state predicate type at all.** Predicates query resulting world state
  ("a tile exists at (3,4)") and frozen-event occurrences — never click sequences, never "panel is
  open". The Educator rule is a parse error, not a review comment, which is what keeps a decade of
  shipped curriculum robust to editor refactors.
- World-space highlights are drawn by the lens layer (no DOM tour library can spotlight an entity);
  DOM chrome highlighting is an in-house ~200-line masked-overlay spotlight — one less dependency.
- Pedagogy enforced by the format: do-then-explain (action precedes naming), create-the-need-before-
  the-tool (feel diagonal speed before normalization; mis-click iso tiles before inversion),
  interpretive feedback (wrong answers *run* and show their consequence — never a red X), and every
  lesson ends in a real, saved, keepable world.
- A **lesson-replay corpus** (fixture world + synthetic event stream per shipped step) runs on every
  editor PR from the first authored lesson. A stuck student is a P1 bug in playtests.

## 10. Package map (v1: 9 published packages + apps)

```
@engine/math ──────────── zero deps; literate (derivations in doc comments); ~1k LOC; IS curriculum
    ↑
@engine/projection ────── Projections as data, Camera, TransformStack, picking; depends ONLY on math
    ↑
@engine/core ──────────── EC store, schema registry, scheduler, Clock, event queues, plugin registry; ≤4k LOC
    ↑
@engine/renderer ──────── the ~12-method interface + null headless backend
@engine/renderer-canvas2d  reference path (readable, uncached) + cached fast path
@engine/world-format ──── format schemas (Zod quarantined), migration runner, salvage, fixtures
@engine/tilemap ────────── layers, painting ops, per-projection render adapters, picking; a plugin
@engine/lens ───────────── overlays + dual-representation binding + provenance; public APIs only
@engine/tutorial ───────── lesson-as-data engine, predicates, spotlights, resumable progress
    ↑
@app/editor ────────────── React 19 shell; the ONLY package that knows React/Zustand/Immer exist
@app/docs ──────────────── Astro Starlight; live demos import the real published packages
@content/lessons ───────── lesson arcs + starter worlds; proves lessons are content, not code
```

Deferred (pre-priced, not designed out): `@engine/renderer-pixi` (perf-gated),
`@engine/physics-lite` (Phase 4, needed for Tinkerer arcs), `@engine/renderer-webgl2` (escape
hatch), `@engine/importers` (when a teacher asks), `@engine/inspect` as a separate package (merged
into lens until scale demands otherwise).

Dependency rules, all CI-enforced with dependency-cruiser:

- Apps depend on engine packages, never the reverse. No React/Zustand/Immer below `@app/editor`.
- Exactly one package may import `pixi.js` (when it exists); Zod only inside `world-format` and the
  core schema registry; no third-party types in any `@engine/*` public API.
- Hard LOC budgets as exit criteria: core ≤4k and *readable* — readability is a shipping
  requirement, because the code is assigned reading.

## 11. Tooling, testing, and release

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript strict, ESM-only, ES2022 | branded space types; framework-free engine |
| Monorepo | pnpm workspaces (+ Turborepo when caching pays) | Nx rejected: more surface than a small team needs |
| Build | Vite 8 (Rolldown) for apps; tsdown for packages | tsdown usage kept vanilla — swap to rolldown+tsc is a one-day change |
| Tests | Vitest 4 (browser mode, `toMatchScreenshot`) + Playwright + axe-core | screenshot browser pinned; upgrades are deliberate baseline-re-bless PRs |
| Docs | Astro Starlight + starlight-typedoc | docs build is a **release** gate, not a merge gate |
| Release | Changesets | staged API freezes (below) |

The standing CI gates, in one place:

1. Property tests: `worldToScreen ∘ screenToWorld = identity` per projection under random cameras;
   `serialize ∘ deserialize = identity` including opaque blobs; `apply ∘ invert = identity` per command.
2. Replay-hash determinism (Phase 0 onward): same seed + input log → byte-identical snapshots, run
   twice per commit on one pinned Chromium; inspector-open vs. closed hashes identical. Lint bans
   `Date.now` / `Math.random` / `Math.sin|cos|tan|atan2` in system code (trig routes through
   `@engine/math`, preserving a deterministic-approximation upgrade path).
3. Screenshot regression on deterministic scenes, per backend, within one pinned browser, with a
   documented per-pixel tolerance policy. This suite is the backend-parity contract.
4. **Perf budget (Phase 2 onward): hard frame-time assertion on a 4×-CPU-throttled pinned Chromium
   profile running the largest shipped lesson world.** Failing this gate automatically pulls the
   Pixi backend work forward. Provenance-off zero-cost is a budgeted perf test.
5. 500-command undo fuzz vs. replay oracle; migration fixture corpus including corrupted files;
   lesson-replay corpus on every editor PR; keyboard-only build-save-reload Playwright flow +
   axe-core scan per phase.

**API freeze staging** (freeze after first real consumption, not before): `@engine/math` publishes
as 0.x at Phase 0 exit — frozen to the team, not the world; its semver 1.0 freeze happens only after
the Phase 2 editor and first lesson have consumed it in anger. Projection/core freeze at Phase 2
exit. Docs and lessons written pre-1.0 reference APIs through a thin curriculum-facade module so
renames touch one file. Rationale: every engine team learns its vector API is wrong the first time a
real caller uses it; freezing before the first consumer is the trap, and lessons embedding a frozen
API is the point of freezing at all.
