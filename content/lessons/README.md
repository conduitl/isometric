# Writing lessons

This package is where the curriculum lives. A lesson is **data** — a plain
TypeScript object with strings and numbers in it, no code — and you can ship
one without ever building the engine. This guide is everything you need.

## Seeing your lesson in the editor

From the repository root:

```sh
pnpm dev:editor
```

That starts the world editor at a local URL (the terminal prints it). The
lesson rail shows the **first** lesson in the `lessons` array from
`src/index.ts`.

**Hot reload:** keep the editor open, edit a lesson file, save — the rail
updates in place, no rebuild, no page refresh ritual. The dev server watches
this package's sources, and the editor re-derives which step is current from
the live world every time the data changes. One draft caveat: progress on
*event* steps ("paint anything") is forgotten on reload, because an event is
a moment, not a world fact — world-state steps ("water at (12, 4)") re-check
against the live world and stay completed. Reordering steps mid-session is
safe; the rail follows.

## The step schema

The types live in `src/types.ts` (its header is required reading — it
explains *why* the vocabulary is shaped this way). A filled-in example:

```ts
{
  id: 'find-the-address',              // kebab-case, permanent — pick a keeper
  title: 'Find the address (12, 4)',   // the rail's step heading
  instruction:
    'Now paint **water** on one exact cell: the one at `(12, 4)`.\n\n' +
    'Reading an address is the trick: the first number is `x`, how far ' +
    'east (across); the second is `y`, how far north (up the map).',
  hint:
    'Move slowly and watch the numbers at the bottom of the screen. ' +
    'When they say `(12, 4)`, click.',
  completion: { kind: 'tile-at', tx: 12, ty: 4, tile: 2, layerId: 'ground' },
}
```

A lesson is `{ id, title, steps: [...] }`. Register it in `src/index.ts` by
adding it to the `lessons` array.

## The three predicate kinds

`completion` decides when a step is done. There are exactly three questions
you can ask — two about the world, one about what the student did:

| kind | completes when | fields | use it for |
| --- | --- | --- | --- |
| `event` | the editor emits a semantic event of this type | `type` — e.g. `'builder.tile-painted'` | "do the thing, any way you like" — any paint, any save, any move |
| `tile-at` | cell (tx, ty) holds the right value | `tx`, `ty`; optional `tile` (omit = "any tile, not empty"; `0` = "empty"); optional `layerId` (omit = any layer) | "make the world look like this" — survives undo, redo, and repainting |
| `entity-exists` | an entity with this marker kind exists | `marker` — e.g. `'crate'` | "there is a crate in the world", however it got there |

The current `builder.*` event types (draft — cross-checked by tests in
`apps/editor/test/lesson-harness.test.ts`): `tile-painted`, `entity-placed`,
`entity-moved`, `entity-renamed`, `entity-deleted`, `selection-changed`,
`command-undone`, `command-redone`, `world-saved`, `world-loaded`,
`world-renamed` — each prefixed `builder.`.

**There is deliberately no "clicked the button" or "panel is open"
predicate.** Buttons move; a decade of curriculum must not. If you find
yourself wanting one, the step is asking about the interface instead of the
world — reshape it around what becomes *true* or what got *done*.

## Formatting instructions

Instructions and hints use a tiny in-house format — these three rules and
nothing else (no links, no lists, no headings, no images):

- `**bold**` for the words you want to pop: tool names, key ideas.
- `` `code` `` for exact things the student reads or types: addresses like
  `(12, 4)`, key names like `Esc`.
- A **blank line** starts a new paragraph. A single line break is just a
  space, so wrap your source lines wherever you like.

A typo never eats your text: an unclosed `**` or backtick renders literally
instead of swallowing the rest of the sentence.

## How events fire (so your steps behave)

The gesture-granularity conventions, from the vocabulary's source of truth
(`apps/editor/src/editor/events/builder.ts`):

- **One event per completed intention.** A drag that paints 40 cells is ONE
  `builder.tile-painted`. A drag-move is ONE `builder.entity-moved`, start
  to finish. Nothing fires per frame or per pointer wiggle.
- **Cancelled gestures emit nothing.** Esc mid-drag means no event — a step
  can never complete on something the student aborted.
- **Undo emits its own event** (`builder.command-undone`), never a replay of
  the original. If your step cares about the *result*, use a world-state
  predicate (`tile-at`, `entity-exists`) — it reads the truth after any
  amount of undoing.

## What changes at Phase 3

Today's schema is a working draft. At Phase 3 it formalizes into
`@engine/tutorial`: the `builder.*` vocabulary **freezes** (names and
payloads become permanent, additive-only, with an alias table so old names
resolve forever), and steps gain the planned extras — anchor/world
highlight targets, `onEnter` effects, richer predicates. Lessons you write
now are expected to migrate mechanically; the two-question rule (world
facts and semantic events only) is the part that will never change.

## Review checklist

Before a lesson ships, walk every step against this list:

- [ ] **Do-then-explain.** The action comes first; the naming of the idea
      comes after the student has already done it. If the step opens with a
      definition, flip it.
- [ ] **Every step has a hint** — the gentler second try, with the extra
      detail the instruction left out.
- [ ] **Wrong answers never dead-end.** Painting the wrong cell, placing an
      extra crate, undoing everything — the step must still be completable,
      and the hint should say so ("nothing is ruined").
- [ ] Completion is a world fact or a semantic event — never interface
      state, and the event type exists in the current vocabulary (the test
      suite checks this: `pnpm test`).
- [ ] Ids are kebab-case and permanent; coordinates fit the starter world's
      32×24 ground layer.
- [ ] **`tile-at` targets are not already true in a fresh starter world** —
      a pre-satisfied step completes itself the moment it becomes current,
      and the student never does the thing it teaches. The starter world
      pre-fills a water pond at tx 5–8, ty 4–6 with a sand rim at tx 4–9,
      ty 3–7; keep water/sand targets out of that whole region.
- [ ] Reading level fits a curious ten-year-old; warm, not gushing.
- [ ] The lesson ends with the student *keeping* something — a saved world
      is the canonical ending.
