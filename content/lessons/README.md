# Writing lessons

This package is where the curriculum lives. A lesson is **data** — a plain
TypeScript object with strings and numbers in it, no code — and you can ship
one without ever building the engine. The schema is the v1 contract frozen
in `@engine/tutorial` (`packages/tutorial/src/types.ts`); `src/types.ts`
re-exports it so a lesson written here is checked against exactly the types
the tutorial engine executes. This guide is everything you need.

## Seeing your lesson in the editor

From the repository root:

```sh
pnpm dev:editor
```

That starts the world editor at a local URL (the terminal prints it). The
lesson rail offers every lesson in the `lessons` array from `src/index.ts`,
in that order.

**Hot reload:** keep the editor open, edit a lesson file, save — the rail
updates in place through the engine's `reload()`. The student's place is
kept by step **id** when the step still exists (its index may have shifted),
so reordering steps mid-session is safe. One documented caveat: progress on
*event* steps ("paint anything") is forgotten on reload, because an event is
a moment, not a world fact — world-state steps ("water at `(12, 4)`")
re-check against the live world and stay completed.

## The lesson shape

```ts
{
  id: 'the-distance-picture',   // kebab-case, PERMANENT (progress records,
                                // replay corpus) — pick a keeper
  title: 'The distance picture',
  arc: 'distance',              // curriculum grouping, shown in the rail:
                                // 'coordinates' | 'distance' | 'perspectives'
  fixture: 'showcase-island',   // OPTIONAL: a fixture world the host loads
                                // before the lesson. Absent = the student's
                                // own world, untouched.
  steps: [ /* … */ ],
}
```

If the host does not recognize a fixture id, `loadFixture` returns false and
the lesson runs on the current world — so a fixture lesson should gate its
steps on events, not on facts about fixture terrain (lesson 03 is the model:
every step completes on a view switch, so it survives a missing island).

**A fixture lesson must never ask the student to save.** The fixture
replaced their document; a save would write the fixture over their own world
slot. End on an event instead (see lesson 03's header comment).

## The step schema

A real step from lesson 02, using everything the v1 schema offers:

```ts
{
  id: 'four-north',
  title: 'Now four north',
  onEnter: [
    {
      kind: 'show-overlays',
      overlays: [
        { kind: 'right-triangle', a: { marker: 'player' }, b: { marker: 'crate' } },
      ],
    },
  ],
  instruction:
    'A triangle just appeared between your player and your crate…\n\n' +
    'Now drag the crate **4 north**, up the map to `(19, 16)` — and go slowly…',
  hints: [
    'Go slowly on purpose — the triangle re-measures itself at every step of the drag…',
    'With the **select** tool (`V`), drag the crate… Keyboard: put the cell cursor on ' +
      'the crate, `Enter` to select it, `Enter` again to grab, walk it north with the ' +
      '**arrow keys**, `Enter` to drop.',
  ],
  target: { kind: 'entity', marker: 'crate' },
  completion: { kind: 'event', type: 'builder.entity-moved', toCell: { tx: 19, ty: 16 } },
}
```

Field by field:

- **`hints` — at least one, and they escalate.** `hints[0]` is the gentle
  nudge; `hints[1]` spells out the exact path **including the keyboard
  route** (some students never touch the mouse). Validation rejects an empty
  hints array; the content tests check the keyboard mention. A stuck student
  is a P1 bug — hints are the escape hatch on every step.
- **`target` (optional) — where the editor points.** Three kinds:
  `{ kind: 'anchor', anchor: 'toolbar.save' }` spotlights editor chrome by
  registry id (the legal ids live in `apps/editor/src/editor/anchors.ts` —
  additive-only, CI-governed; the content tests keep a mirror of the list);
  `{ kind: 'cell', tx, ty }` and `{ kind: 'entity', marker }` are lit in the
  world by the lens layer.
- **`onEnter` (optional) — declarative effects applied when the step
  begins.** Two kinds:
  - `{ kind: 'show-overlays', overlays: [...] }` replaces the tutorial's
    lens-overlay set (empty array clears). Overlay kinds: `cell-highlight`,
    `entity-highlight`, `arrow`, and `right-triangle` — the legs-and-
    hypotenuse distance picture. Endpoints are fixed points `{ x, y }` or
    live `{ marker }` references resolved against the document every frame,
    which is why lesson 02's triangle follows the crate mid-drag.
  - `{ kind: 'set-view-projection', projection: 'iso' }` switches the view
    lens (`'profile' | 'topdown' | 'iso'`, or `null` for the world's own
    primary projection). View-only — the document is untouched.

  Effects are replace-semantics and re-applied by reset(), so declare on
  each step the full picture that step depends on. One trap to know: the
  editor may emit real `builder.*` events while applying an effect (a
  set-view-projection that actually changes the view emits
  `view-projection-changed`) — never give a step an onEnter effect that
  could emit the very event its own completion waits for.
- **`completion` — when is the step done?** The heart of the schema, below.

## The predicate kinds

`completion` decides when a step is done. There are exactly two families —
facts about the world, and semantic events — and **no UI-state predicate
exists at all**: no "clicked the button", no "panel is open". Buttons move;
a decade of curriculum must not. If you find yourself wanting one, reshape
the step around what becomes *true* or what got *done*.

| kind | completes when | notes |
| --- | --- | --- |
| `event` | the editor emits this semantic event | optional `where` matches payload fields: `{ kind: 'event', type: 'builder.view-projection-changed', where: { to: 'iso' } }` completes only on a switch TO iso. Strict scalar equality, top-level fields only. For `builder.entity-moved` only, optional `toCell: { tx, ty }` completes only when the move LANDS in that cell (the event's `to` position floors to it) — the pre-satisfaction-proof way to say "move it HERE". |
| `tile-at` | cell `(tx, ty)` holds the right value | optional `tile` (omit = "any non-empty"; `0` = "empty"), optional `layerId`. Survives undo/redo/repainting. |
| `entity-exists` | ≥ `atLeast` (default 1) entities with `marker` exist | however they got there |
| `entity-at` | an entity with `marker` stands ON cell `(tx, ty)` | the entity's position **floors** to the cell — the placer sets entities at cell CENTERS (`+0.5`), so you write the whole-number cell address and it just works |
| `entity-distance` | the first entity of `markerA` and of `markerB` stand `distance` apart | ground-plane Euclidean, small `tolerance` (default 0.05) for float dust. Measures the FIRST entity of each marker in id order. |
| `all` / `any` | composition of the above | world facts only — **no event leaves inside a composition** (validation rejects them; a moment and a state cannot be honestly waited on together) |

### Worked example: the arithmetic behind `entity-at` and `entity-distance`

From lesson 02. The starter player stands at `(16.5, 12.5)` — the CENTER of
cell `(16, 12)`. A crate placed on cell `(19, 16)` stands at `(19.5, 16.5)`.
Center to center: legs `3` east and `4` north, so the distance is
`√(3² + 4²) = 5`. Every distance claim you write in prose must be verified
this way — cell centers, deltas, hypotenuse — and the content tests
recompute lesson 02's numbers exactly (`test/lessons.test.ts`). A wrong
number in curriculum is a HIGH bug.

And the pre-satisfaction trap that shaped lesson 02: after its step 2 the
crate already stands 5 from the player, so a reveal step gated on
`entity-distance: 5` would complete BEFORE the student did anything — and a
step gated on `entity-at` a destination cell is pre-satisfied by any
leftover crate already parked there. A step must always ask for something
not yet true, so lesson 02 gates every MOVE on the moment itself:
`{ kind: 'event', type: 'builder.entity-moved', toCell: { tx, ty } }`
completes only when a crate actually LANDS in the cell. Only the opening
placement stays `entity-at` (a placement event cannot name a cell — `where`
matches top-level scalars, and `entity-placed` carries its landing spot
inside a `position` object — and for "put a crate here", a crate already
there IS the asked-for state).

## The event vocabulary

The `builder.*` vocabulary is **frozen** (Phase 3, D4) and lives in
`packages/tutorial/src/events.ts` — that file is the source of truth, with
the payload shapes. The names: `tile-painted`, `entity-placed`,
`entity-moved`, `entity-renamed`, `entity-deleted`, `selection-changed`,
`command-undone`, `command-redone`, `world-saved`, `world-loaded`,
`world-renamed`, `view-projection-changed` — each prefixed `builder.`.
Additive-only from here: names never vanish, payload fields never change
meaning, and a permanent alias table keeps any superseded name resolving
forever.

How events fire (the gesture conventions, from the vocabulary's header):

- **One event per completed intention.** A drag that paints 40 cells is ONE
  `builder.tile-painted`; a drag-move is ONE `builder.entity-moved`, start
  to finish. Nothing fires per frame.
- **Cancelled gestures emit nothing.** Esc mid-drag means no event — a step
  can never complete on something the student aborted.
- **Undo emits its own event** (`builder.command-undone`), never a replay of
  the original. If your step cares about the *result*, use a world-state
  predicate — it reads the truth after any amount of undoing.

## Formatting instructions

Instructions and hints use a tiny in-house format — these three rules and
nothing else (no links, no lists, no headings, no images):

- `**bold**` for the words you want to pop: tool names, key ideas.
- `` `code` `` for exact things the student reads or types: addresses like
  `(12, 4)`, key names like `Esc`.
- A **blank line** starts a new paragraph. A single line break is just a
  space, so wrap your source lines wherever you like.

A typo never eats your text: an unclosed `**` or backtick renders literally
instead of swallowing the rest of the sentence — but do not lean on that
mercy; the content tests check that markers balance.

## Every lesson ships with a replay script

`test/replay-corpus.test.ts` is the CI artifact behind the Phase 3 exit
criterion "the corpus proves every step completable": for each shipped
lesson it drives the REAL tutorial engine (`replayLesson` from
`@engine/tutorial`) with a synthetic student and demands the lesson
complete. **Authoring a lesson is not done until its script is in the
corpus.**

The convention is **mutate-then-announce** — the editor's own order: first
change the document the way the editor's command would, then feed the event
the editor would emit. A real beat from lesson 02's script (the student
drags the crate from `(19, 12)` to `(19, 16)`):

```ts
{ kind: 'mutate', mutate: (doc) => setPosition(doc, crateId, 19.5, 16.5) },
{
  kind: 'event',
  event: {
    type: 'builder.entity-moved',
    id: crateId,
    from: { x: 19.5, y: 12.5, z: 0 },
    to: { x: 19.5, y: 16.5, z: 0 },
  },
},
```

The pairing matters: the step machine re-checks world predicates when an
event arrives (the editor mutates first, announces second), so a mutation
without its announcing event advances nothing — exactly as in the shipped
editor. Events with no world change (saves, view switches) are single
`event` actions.

## Review checklist

Before a lesson ships, walk every step against this list:

- [ ] **Do-then-explain.** The action comes first; the naming of the idea
      comes after the student has already done it. If the step opens with a
      definition, flip it.
- [ ] **Hints escalate, and `hints[1]` includes the keyboard path.**
      `hints[0]` nudges; `hints[1]` spells out the exact route, keys named.
- [ ] **Wrong answers never dead-end.** Painting the wrong cell, placing an
      extra crate, undoing everything — the step must still be completable,
      and a hint should say so ("nothing is ruined").
- [ ] **No pre-satisfied targets.** A pre-satisfied step completes itself
      the moment it becomes current, and the student never does the thing it
      teaches. Check every world-fact completion against the starter world:
      the pond (tx 5–8, ty 4–6) and its sand rim (the tx 4–9 × ty 3–7 box)
      are already water/sand; the player already stands at `(16.5, 12.5)`,
      the center of cell `(16, 12)`; and check the step against the world
      state the PREVIOUS step just created (lesson 02's trap, above). For
      "move it HERE" steps, prefer the `entity-moved` + `toCell` moment-gate
      — a moment that names its destination cannot be pre-satisfied by
      anything already standing there.
- [ ] **Arithmetic verified, not proofread.** Cell centers are `+0.5`;
      recompute every delta and distance you claim, and pin lesson-specific
      numbers in `test/lessons.test.ts`.
- [ ] Coordinates fit the starter world's 32×24 ground layer (fixture
      lessons: fit the fixture — and gate on events anyway).
- [ ] Anchor targets exist in the registry
      (`apps/editor/src/editor/anchors.ts`); the content tests keep a
      mirror list that must match.
- [ ] Completion is a world fact or a frozen event — `pnpm test` runs
      `validateLessons` plus the coordination checks over every shipped
      lesson.
- [ ] **The replay-corpus script exists and completes** with
      `stepsCompleted === steps.length`.
- [ ] Reading level fits a curious ten-year-old; warm, not gushing.
- [ ] The lesson ends with the student *keeping* something — a saved world
      is the canonical ending. (Fixture lessons are the exception: they must
      NOT ask for a save; end on an event.)
