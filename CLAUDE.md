# Math Game Engine monorepo

An educational 2D web game engine: the engine's own math (vectors, matrices, projections) is the
curriculum, taught to ages 10–18 through a world editor with interactive tutorials.

**Read before making decisions:** `docs/ARCHITECTURE.md` (design), `docs/DECISIONS.md` (decision
register — check it BEFORE adding any dependency; every dep needs a priced escape hatch entry),
`docs/ROADMAP.md` (phases + exit criteria), `docs/RISKS.md`.

## Commands

- `pnpm test` — full suite (includes replay-hash determinism tests)
- `pnpm lint` / `pnpm typecheck` / `pnpm build`
- `pnpm dev:demo` — run the Phase 0 demo app (bouncing ball, profile view, pause/step)

## Hard conventions

- **Determinism:** no `Date.now`, `Math.random`, or raw trig (`Math.sin` etc.) in engine/app source —
  ESLint enforces this. Time is fed into the Clock; randomness comes from `createRng(seed)`; trig
  goes through `Scalar` wrappers in `@engine/math` (the only package allowed raw trig).
- **Literate code:** `@engine/math` is curriculum — every exported function carries its derivation
  in its doc comment, pitched at a curious teenager. Readability is a shipping requirement.
- **Boundaries (CI-enforced intent):** apps depend on packages, never the reverse; no UI-framework
  types below `apps/`; all curriculum math lives above `@engine/renderer` (backends receive
  already-projected screen-space commands).
- **Data, not classes:** entities/components/matrices are plain JSON-serializable objects.
- Determinism claims are scoped to **same build + same pinned browser** — never cross-machine.

## Layout

`packages/math` (zero-dep literate math) · `packages/core` (Clock now; EC store/scheduler in
Phase 1) · `packages/renderer` (interface + null backend + surface helpers) ·
`packages/renderer-canvas2d` (reference backend) · `packages/testkit` (stable stringify + FNV-1a
replay hashing) · `apps/bedrock-demo` (Phase 0 exit deliverable).
