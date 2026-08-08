# Decision register

A living document. Every significant decision is classified as a **one-way door** (irreversible or
ruinously expensive to reverse — made explicitly, early, with migration machinery from day one) or a
**reversible door** (kept reversible *by construction*, with the escape hatch priced). Review this
register at every phase boundary; add every new dependency here with its escape hatch before it merges.

## One-way doors (deliberate, irreversible commitments)

| # | Decision | Commitment | Migration machinery |
|---|---|---|---|
| D1 | **World file format semantics** | Minimal human-readable JSON; integer `formatVersion`; migrations as ordered pure functions; unknown components as opaque blobs. Classroom files outlive every library choice. | Fixture corpus from every released version (plus corrupted files) in CI forever; atomic two-slot saves; salvage mode. |
| D2 | **Stable entity id policy** | Per-world monotonic counters, never recycled, `nextEntityId` persisted in the file. | None needed — the policy *is* the machinery. Everything (selection, undo, predicates) may key on ids. |
| D3 | **World axes** | Ground plane x=east, y=north; scalar elevation z=up; screen y-flip lives inside projection matrices. | Permanent: owned as curriculum (axis compass, console pretty-printer, "why is up called z?" micro-lesson, playtest probe). Fallback recorded: per-scene axis semantics, at the cost of the perspective-switch lesson. |
| D4 | **Semantic event vocabulary + payload schemas** | Tiered freezes (builder.* at P3, tinkerer.* at P4, engineer.* at P5); additive-only after each freeze; gesture-level granularity; permanent alias table. Shipped lessons hardcode predicates against it. | Lesson-replay corpus in CI from first authored lesson; alias table lets corrected names supersede mistakes without breaking replays. |
| D5 | **Anchor registry** | Lessons reference UI chrome only via versioned `data-anchor` ids; additive-only; renaming without an alias fails CI. | Same governance as D4. |
| D6 | **Determinism scope** | Same build + same pinned browser. Never promise cross-machine float identity. | Trig routed through `@engine/math` preserves a deterministic-approximation upgrade path if cross-device replay is ever truly needed. |
| D7 | **Iso chirality: south-east camera** | `screen = ((x+y)·tileW/2, (x−y)·tileH/2 − z·zScale)`, depth `x − y + z`. Chosen (Aug 2026, pre-release) so iso's determinant carries the same sign as top-down's — the world keeps one winding in every view and a kid's map is never mirror-reversed between the two primary windows. The classic games formula `(x−y, x+y)` assumes y-south coordinates and silently mirrors a y-north world. | Permanent once world files and tutorial predicates exist; caught and fixed by adversarial review while zero files existed. |
| D8 | **File-format value semantics (D1 riders)** | (a) `−0` normalizes to `0` on save — matches replay hashing; the format does not promise the distinction. (b) Unknown keys **outside** `components` drop on load→save with a named student-language warning; unknown keys **inside** `components` round-trip verbatim (the designed extension point). (c) Schema caps: layer ≤ 256×256, `tileSize` ∈ (0, 64], `|layerBand|` ≤ 2²⁰ — the preconditions the depth-band arithmetic relies on, enforced where files enter. | Riders pinned by round-trip tests; changing any of them is a formatVersion bump with a migration. |

## Reversible doors (dependencies and choices with priced escape hatches)

| # | Decision | Choice | Escape hatch (priced) | Trip-wire |
|---|---|---|---|---|
| R1 | Production rendering | Canvas2D reference + cached fast path ships v1; PixiJS v8 wrapped as dumb display list when needed | Swap Pixi for in-house WebGL2 batcher (~2–5k LOC, few weeks) behind unchanged ~12-method interface | Throttled perf CI gate auto-pulls Pixi forward; backend-parity screenshot suite proves the seam; second-backend slippage = seam alarm |
| R2 | Entity store | In-house object-based EC (~2–4k LOC, miniplex-inspired) | Vendor miniplex (~1k permissive-licensed lines), layer ids/schemas/scheduler on top (~1–2 weeks) | Core LOC budget breach or team shrink |
| R3 | Editor UI framework | React 19, confined to `@app/editor` behind the command-bus boundary | Svelte 5 swap contained to one package | Bundle size on Chromebooks; React ecosystem health |
| R4 | Editor state / undo | Zustand + Immer `produceWithPatches` (entities/settings only; tiles use typed arrays + run inverses) | Mutative/Travels is API-compatible (~days) | Patch-generation cost in the perf CI profile |
| R5 | Schema validation | Zod v4, quarantined inside `@engine/world-format` + core schema registry; never in public types | Any validator swap is internal (~1 week) | Zod major-version churn |
| R6 | DOM tutorial spotlight | In-house ~200-line masked overlay (driver.js dropped) | Adopt driver.js as adapter if the in-house one grows features | Spotlight feature creep |
| R7 | Build tooling | Vite 8 (Rolldown) apps; tsdown packages, vanilla config only | tsdown → plain rolldown+tsc is a one-day change | tsdown stagnation |
| R8 | Monorepo runner | pnpm workspaces alone | Add Turborepo when task caching pays (~5+ packages) | CI wall-clock pain |
| R9 | Docs platform | Astro Starlight + starlight-typedoc; **release** gate, not merge gate | Any SSG; docs content is markdown + live demos importing published packages | Starlight major churn blocking releases |
| R10 | Screenshot testing | Vitest 4 browser mode + `toMatchScreenshot`, one pinned Chromium | Playwright screenshots; policy (pinning + deliberate re-bless PRs) is the real decision | Baseline churn on browser updates |

## Explicitly deferred (recorded so deferral is a decision, not an accident)

| Item | Deferred until | Notes |
|---|---|---|
| Persisted undo history / "replay how I built this" | A design survives format migration | Session-scoped history in v1; patch stacks must never be replayed against migrated documents |
| Iso wall-face picking | Editor phase (with elevation tools) | v1: clicking an iso wall pixel falls through to the ground cell beneath — documented in the demo's picking module, not hidden; fixing it needs per-face inversion the tutorial-facing editor will motivate |
| Per-cell iso paint-queue granularity | Editor phase | v1 keeps whole-layer blits + `bandAbove` entity banding; the two known mis-sort configurations (ground entity behind raised terrain shows through; the alternative sinks entities at wall bases) are documented in `views.ts` — true cross-storey interleaving needs per-diagonal-strip queue items |
| Multi-tile iso footprints | Phase 5 | v1 = 1-tile footprints; committed mechanism: `sortAnchor` + footprint splitting; anomaly ships as a lesson |
| General multi-projection *editing* | Post-v1, priced separately | v1 = primary projection per world + "X-ray view" lens with schematic fallbacks; full editing needs per-projection art budget |
| Tiled TMJ / LDtk importers | A real teacher asks | Import-only boundary; GID flip-bits never enter our schema |
| Arbitrary-value provenance | A shipped lesson requires it | v1 = TransformStack walk + physics `explain()` |
| WebGPU backend | ~2028 revisit, recorded go/no-go in Phase 6 | WebGL2 is the floor on school hardware |
| Docking panel layout, collaboration, new projections (hex, oblique) | Post-v1 | Fixed CSS grid v1 is a reversible cut |
| bitECS-style hot path (particles) | Profiling justifies it | Would hide behind the same inspection API |

## Rejected (with reasons, so we don't relitigate)

- **Phaser / Excalibur / Kaplay as foundation:** full frameworks owning the loop, camera, and world
  model — the exact layers this project must own for the curriculum. Phaser additionally carries an
  AI-pivot strategic risk and no WebGPU; Excalibur is pre-1.0 after a decade with bus-factor risk.
- **Three.js for 2D:** the 3D scene graph and mental model actively obscure the 2D math being taught.
- **WebGPU-direct now:** the support gap lands exactly on aging school Chromebooks.
- **bitECS/koota as world model:** recycled numeric ids and SoA typed-array storage are structurally
  hostile to editor identity and novice inspection; SoA throughput solves a problem we don't have at
  hundreds-to-low-thousands of entities.
- **Tiled/LDtk as native format:** legacy encodings (GID flip-bits) are hostile to novices and would
  contaminate a format we must keep minimal for a decade.
- **Off-the-shelf tour libraries as tutorial engine:** none can gate on "drag the vector until its
  slope is 2" or spotlight a world-space entity; sequencing is an event-predicate problem and
  lesson-as-data is the product line's core content format.
- **Nx:** heavier surface than a small team needs.
- **gl-matrix (or any third-party math):** a dependency may never sit where the curriculum lives; no
  external library can be asked to be readable by a 14-year-old.
