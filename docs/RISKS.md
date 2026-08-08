# Risk register

Findings from the adversarial red-team review, plus architect-identified risks, each with its
mitigation and **where the mitigation is mechanically enforced** (a mitigation that lives only in
prose is a hope, not a control). Severities are the red team's.

## High

| Risk | Mitigation | Enforced by |
|---|---|---|
| **Phase-size optimism / aggregate owned-code maintenance drowning a 2–3 person team** (the classic small-team engine death: not one piece, but the interest rate on ~15 packages) | v1 package surface cut to 9; API freezes staged *after* first real consumption; literate-derivation requirement scoped to `@engine/math` only for v1; hard LOC budgets; pre-ranked scope-cut lists per phase | 150%-budget governance rule (ROADMAP); LOC budgets as phase exit criteria; DECISIONS R2 fallback ladder |
| **Canvas2D perf cliff at zoomed-out views on Chromebooks arriving Phase 2–4, years before the old Phase-6 backend gate** | Cached fast path (OffscreenCanvas layer caches, dirty-rect, scaled-cache blits) designed in Phase 0, built in Phase 1; 256×256/layer v1 cap with friendly explanation; Pixi backend pre-priced | 4×-CPU-throttled perf CI gate from Phase 2 with hard frame-time assertion, whose failure *automatically* pulls Pixi work forward |
| **Runtime projection switching leaks at the art/gameplay layer** (iso art is 2:1 diamonds; a platformer's jump is edge-on and invisible in top-down; tripled art budget nobody priced) | v1: projection switch is a curated "X-ray view" lens, not an editing mode; worlds declare a primary projection; schematic fallbacks (footprint quads, elevation posts) where art is missing; physics declares its plane so edge-on views show an honest overlay; the reveal lesson runs on fixture worlds with all three asset sets | DECISIONS deferred-item entry (priced upgrade path); lesson fixtures in `@content/lessons` |
| **Tutorial hard-couples to the editor through DOM selectors, event-payload drift, and UI-state predicates** — breaking a decade of shipped curriculum on every refactor | Versioned anchor registry (additive-only, alias-checked); payload schemas frozen with names; the lesson schema has **no UI-state predicate type** (world-state + frozen events only — a parse error, not a review comment) | CI anchor-rename check; lesson-replay corpus on every editor PR; schema validation of lessons |
| **JSON-Patch undo over array-indexed documents corrupts history under interleaving; persisted patch stacks replayed against migrated files corrupt kids' saves** | In-memory document keys entities by id (arrays only in the file); tile strokes use typed-array run inverses outside Immer; undo history session-scoped, never persisted | 500-command interleaved fuzz vs. command-log replay oracle in CI; `apply∘invert=identity` per command; DECISIONS deferred-item entry for persisted history |

## Medium

| Risk | Mitigation | Enforced by |
|---|---|---|
| Immer patch cost + undo-memory bomb on 10k-cell tile arrays during drag-painting | Tile raster edits bypass Immer entirely (typed arrays, run-based inverses, stroke coalescing); Immer reserved for entity/settings-scale edits | Paint-path frame budget in throttled perf CI; Mutative as API-compatible fallback (DECISIONS R4) |
| Contradictory determinism claims (cross-machine promises vs. same-build scoping) burning weeks or flaking CI | All exit criteria say "same build + pinned browser"; replay CI runs one pinned Chromium; iso sort tests compare committed orderings, not hashes; tutorial predicates use epsilon world-state comparisons | Lint ban on wall-clock/`Math.random`/raw trig in systems; deliberate browser-upgrade re-bless PRs |
| Kid save files are truncated/hand-edited/mid-write-corrupted, and the glass-box ethos *encourages* hand-editing | Atomic two-slot saves with "restore backup"; lenient pre-check before migration; per-step input validation; salvage mode; age-appropriate error translation (raw Zod text in UI is a named bug class) | Corrupted-file fixtures (truncated, mangled, mid-write) in the CI corpus |
| Provenance recorder becomes a research project with an observe-changes-behavior Heisenbug | v1 provenance = TransformStack walk (already data) + physics `explain()`; arbitrary-value provenance deferred | CI: replay hashes identical inspectors open vs. closed; provenance-off zero-frame-cost perf test |
| Dual-representation binding contradicts the throttled command-bus contract (per-frame two-way traffic) | Transient-edit preview protocol specified before Phase 2: engine-side preview channel at rAF rate, one command on release, Esc discards | Phase 4 exit criterion: 3+ panels on the shared mechanism with zero per-widget sync code |
| v1 scope contradiction (mandated 5-arc lesson spine vs. Phase-3 feature reality) | v1 = arcs 1–2 (coordinates, distance) + perspective-reveal as view-only showcase; arcs 3–5 ship with Phases 4–5 as versioned curriculum updates; distance-triangle overlay pulled into Phase 3 | Classroom-pilot launch gate explicitly gates the Phase-3 build with arcs 1–2 |
| Event vocabulary frozen before the features it describes exist | Tiered freezes matched to feature reality (builder/tinkerer/engineer at P3/P4/P5), namespaced, alias table, gesture-level granularity convention written before the first lesson | Additive-only checks per tier from each tier's freeze |
| Accessibility retrofit rewrite + school procurement failure | Keyboard operability and DOM mirroring from Phase 2 (arrow-key cursor + Enter to paint doubles as the coordinates lesson); Phase 6 is certification over an already-accessible product | Keyboard-only Playwright flow + axe-core scan as per-phase exit criteria |
| Content staffed with nobody (lesson authoring, literate-docs editorial, school playtest logistics all landing on 2–3 engineers) | Part-time curriculum author as a named Phase-2 line item; playtest pipeline (consent, scheduling) starts Phase 2 because it takes months; lesson hot-reload harness | Phase 2 exit criterion: a non-engineer ships a lesson step without an engine build |

## Low (accepted, owned, or monitored)

| Risk | Posture |
|---|---|
| z-up/y-north fights every kid's platformer prior | Owned as curriculum: axis compass, console pretty-printer with axis annotations, "why is up called z?" micro-lesson, axis-confusion playtest probe (DECISIONS D3) |
| Branded types protect engineers but torment students at the script surface | Dev-build runtime space tags with student-worded assertions; script surface wraps APIs with custom-worded errors; lint keeps raw brands out of the script surface |
| Screenshot-baseline churn across Chromium updates eroding the backend-parity contract | Pinned browser; upgrades are deliberate re-bless PRs; parity compares backends within one browser, never across versions |
| tsdown youth as a decade bet | Vanilla config only; swap to rolldown+tsc is a one-day change (DECISIONS R7) |
| Docs-build gate coupling daily velocity to Astro churn | Docs build is a release gate, not a merge gate (DECISIONS R9) |
| Iso z-band picking confusing on multi-elevation worlds | v1 Builder worlds are single-elevation; when elevation ships, every placement tool shows a live hover ghost at the resolved cell, and the picking policy becomes the "which layer did I click?" explorable |
| PixiJS decade risk (hostile v9, stagnation) | Accepted knowingly: dumb-display-list usage, one importing package, priced WebGL2 batcher escape hatch, Canvas2D floor permanent (DECISIONS R1) |
| Transfer failure — manipulative mastery without notation (the DragonBox failure mode) | Do-then-explain naming bridges in every lesson; transfer probes in every playtest cycle, merged into one standing protocol |
