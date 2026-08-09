/**
 * Lesson 02 — "The distance picture": Pythagoras, built out of crates.
 *
 * The arc is do-then-explain (ARCHITECTURE §9): the student walks a crate
 * around the world FIRST, and the theorem is named only after their own
 * hands have already made it true. The star of the lesson is the
 * right-triangle lens overlay between the player and the crate: its
 * endpoints are `{ marker }` references, resolved against the live document
 * every frame, so the legs and the slanted side re-measure themselves WHILE
 * the student drags — the "watch the numbers move" moment in step 2 is the
 * whole reason the overlay exists, and the instructions are written around
 * it. Interpretive feedback throughout: the triangle answers, it never
 * scolds (a wrong cell just shows its own honest measurement).
 *
 * ## Starter-world facts this lesson leans on
 *
 * (StarterWorld contract, apps/editor/src/editor/types.ts; pinned as
 * literals in test/lessons.test.ts.) The player stands at (16.5, 12.5) —
 * the CENTER of cell (16, 12), because cell-dwellers stand on centers — and
 * the placer sets entities at cell centers too (+0.5). So every distance
 * here is center-to-center with WHOLE-NUMBER legs, and the arithmetic in
 * the prose is exact, never rounded:
 *
 *   step 1: crate on (19, 12) → (19.5, 12.5): legs 3, 0  → distance 3
 *   step 2: crate on (19, 16) → (19.5, 16.5): legs 3, 4  → distance 5
 *   step 3: crate on (20, 15) → (20.5, 15.5): legs 4, 3  → distance 5
 *   step 4: crate on (22, 20) → (22.5, 20.5): legs 6, 8  → distance 10
 *
 * Every one of those claims is recomputed numerically by the content tests
 * — a wrong number in curriculum is a HIGH bug, so none of them is trusted
 * to proofreading alone. All four cells sit inside the 32×24 ground layer,
 * outside the starter pond and its sand rim, and off the player's own cell.
 *
 * ## How the steps gate: a moment for every move, a fact for the placement
 *
 * The MOVEMENT steps (2–4) gate on the moment itself: an event predicate on
 * `builder.entity-moved` whose `toCell` names the destination. A moment-gate
 * that names a destination can never be pre-satisfied by something already
 * standing there — a leftover lesson-01 crate parked on `(19, 16)` does not
 * complete "now drag it there", because nothing MOVED. (The standing-state
 * alternative, `entity-at`, was this lesson's original design, and exactly
 * that leftover crate auto-skipped the reveal.)
 *
 * Step 1 (the placement) stays `entity-at`, with one narrow ACCEPTED
 * residual: a crate already standing on `(19, 12)` pre-satisfies it. A
 * placement event cannot name a cell — `where` matches top-level scalars
 * only, and `builder.entity-placed` carries its landing spot inside a
 * `position` OBJECT — and for a "put a crate here" step, a crate already
 * there IS the asked-for state, so the residual costs a beat of surprise,
 * never the lesson. Accepting it beats asking for engine surface this
 * content package does not own.
 *
 * Why never `entity-distance`: the tempting reveal-step completion —
 * "player and crate stand exactly 5 apart" — would ALREADY be true the
 * moment step 2 completes (the crate is on (19, 16), distance 5), so the
 * step would self-complete before the student did anything. The 3-4-5 fact
 * still gets its moment — as prose, proved by the overlay the student is
 * looking at. And because the move-gates demand a real move, the hints
 * steer the student toward MOVING their existing crate rather than
 * stacking up new ones (placing a fresh crate on a move-step's cell emits
 * entity-placed, not entity-moved, and completes nothing).
 */

import type { Lesson, StepEffect } from './types'

/**
 * The one overlay this lesson lives on: the legs-and-hypotenuse picture
 * between player and crate, with live marker endpoints. Re-declared on each
 * middle step (effects are replace-semantics) so reset() always restores
 * the picture the step depends on.
 */
const distanceTriangle: StepEffect = {
  kind: 'show-overlays',
  overlays: [{ kind: 'right-triangle', a: { marker: 'player' }, b: { marker: 'crate' } }],
}

/** Arc 2 of the curriculum: distance-as-Pythagoras, on the student's own world. */
export const lesson02: Lesson = {
  id: 'the-distance-picture',
  title: 'The distance picture',
  arc: 'distance',
  steps: [
    {
      id: 'three-east',
      title: 'Three steps east',
      instruction:
        'Put a **crate** on the cell exactly **3 east** of your player. The player stands on ' +
        '`(16, 12)`, so count three cells east: 17, 18, 19 — the crate belongs on `(19, 12)`.\n\n' +
        'Notice what your counting did: only the FIRST number changed. **East means only `x` ' +
        'changes.** Keep that thought — the next step bends it.',
      hints: [
        'Already have a crate from the last lesson? Drag it there — any crate standing on ' +
          '`(19, 12)` counts. No crate yet? Pick `crate` under **Things** and place one. ' +
          'Wrong cell? Move it again — nothing is ruined.',
        'Keyboard path: press `E` for the placer (with `crate` chosen under **Things**), walk ' +
          'the cell cursor with the **arrow keys** until the readout at the bottom says ' +
          '`(19, 12)`, then press `Enter`. Moving one instead? Press `V` for select, `Enter` ' +
          'to select the crate, `Enter` again to grab it, arrows to carry it, `Enter` to drop.',
      ],
      target: { kind: 'cell', tx: 19, ty: 12 },
      // The one entity-at in this lesson, an ACCEPTED narrow residual: a
      // crate already standing on (19, 12) pre-satisfies this step, because
      // a placement event cannot name a cell (`where` matches top-level
      // scalars; builder.entity-placed carries its landing spot inside a
      // `position` object). For "put a crate here", a crate already there IS
      // the asked-for state — see the file header. Every MOVE step below
      // gates on the entity-moved moment instead.
      completion: { kind: 'entity-at', marker: 'crate', tx: 19, ty: 12 },
    },
    {
      id: 'four-north',
      title: 'Now four north',
      // The overlay appears HERE, after the flat walk exists to picture:
      // a triangle with legs 3 and 0 — flat as a road on purpose.
      onEnter: [distanceTriangle],
      instruction:
        'A triangle just appeared between your player and your crate — a completely FLAT one, ' +
        'because when you only walk east, **the east leg is the whole story**: the straight-line ' +
        'distance is just `3`.\n\n' +
        'Now drag the crate **4 north**, up the map to `(19, 16)` — and go slowly. The triangle ' +
        'follows the crate while you drag: watch one leg hold at `3`, a second leg grow to `4`, ' +
        'and a third number climb the slanted side.',
      hints: [
        'Go slowly on purpose — the triangle re-measures itself at every step of the drag. ' +
          'The slanted side always shows the true straight-line distance between player and crate.',
        'With the **select** tool (`V`), drag the crate four cells up the map and drop it on ' +
          '`(19, 16)`. Keyboard: put the cell cursor on the crate, `Enter` to select it, ' +
          '`Enter` again to grab, walk it north with the **arrow keys**, `Enter` to drop.',
      ],
      target: { kind: 'entity', marker: 'crate' },
      // The MOVE is the step: gate on the moment the crate LANDS in (19, 16)
      // — a leftover crate already parked there completes nothing.
      completion: { kind: 'event', type: 'builder.entity-moved', toCell: { tx: 19, ty: 16 } },
    },
    {
      id: 'the-other-corner',
      title: 'The 3-4-5 reveal',
      onEnter: [distanceTriangle],
      instruction:
        'Read the slanted side: the straight-line distance is `5`. And you can PROVE it from the ' +
        'legs you built: `3² + 4² = 9 + 16 = 25`, and `25 = 5²`. That is the whole **Pythagorean ' +
        'theorem** — square each leg, add them, and the answer is the slanted side squared. You ' +
        'just built it out of crates.\n\n' +
        'There is a second corner with the very same slant. Swap the legs: walk the crate to ' +
        '`(20, 15)` — that is **4 east, 3 north** of the player — and check the slanted side.',
      hints: [
        'Two different corners sit exactly `5` from the player: legs `3 and 4`, or legs ' +
          '`4 and 3`. Start from the player on `(16, 12)`: count 4 cells east, then 3 north.',
        'Select tool (`V`), grab the crate, drop it on `(20, 15)`. Keyboard: cell cursor on ' +
          'the crate, `Enter` to select it, `Enter` again to grab, walk with the **arrow keys** ' +
          'until the readout says `(20, 15)`, `Enter` to drop.',
      ],
      target: { kind: 'cell', tx: 20, ty: 15 },
      completion: { kind: 'event', type: 'builder.entity-moved', toCell: { tx: 20, ty: 15 } },
    },
    {
      id: 'predict-then-look',
      title: 'Predict, then look',
      onEnter: [distanceTriangle],
      instruction:
        'This time, predict FIRST. If the crate goes **6 east and 8 north** of the player, how ' +
        'long is the slanted side? Say a number out loud — really say it.\n\n' +
        'Then walk the crate to `(22, 20)` and let the triangle answer. It never scolds; it just ' +
        'measures. (A trick for the prediction: `6 and 8` is `3 and 4` doubled.)',
      hints: [
        'Work it like the last one: `6² + 8² = 36 + 64 = 100`. What number times itself ' +
          'makes `100`?',
        'The cell 6 east and 8 north of `(16, 12)` is `(22, 20)`. Select tool (`V`), grab the ' +
          'crate, drop it there — keyboard: cell cursor on the crate, `Enter` to select it, ' +
          '`Enter` again to grab, **arrow keys** to `(22, 20)`, `Enter` to drop.',
      ],
      target: { kind: 'cell', tx: 22, ty: 20 },
      completion: { kind: 'event', type: 'builder.entity-moved', toCell: { tx: 22, ty: 20 } },
    },
    {
      // No onEnter: the triangle from the last step deliberately stays up —
      // the student saves their world with the proof still on screen.
      id: 'keep-the-picture',
      title: 'Keep the picture',
      instruction:
        'Press **Save**.\n\n' +
        'The slanted-side trick is not a crate trick. Screens, maps, star charts, the dash from ' +
        'you to your goal — **distance is the same one formula everywhere**: square the east, ' +
        'square the north, add them, then find the number that squares to the total (the `5` ' +
        'hiding in `25`). Wherever two addresses live, you now know how far apart they are.',
      hints: [
        'The Save button lives in the toolbar. Saving keeps every cell, every crate, and your ' +
          'player exactly where they stand.',
        'Or press `Ctrl+S` (`Cmd+S` on a Mac) — the editor catches it before the browser does.',
      ],
      target: { kind: 'anchor', anchor: 'toolbar.save' },
      completion: { kind: 'event', type: 'builder.world-saved' },
    },
  ],
}
