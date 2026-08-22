/**
 * Lesson 00 — "Paint by numbers": the coordinate grid, taught by finishing a
 * picture.
 *
 * This is lesson ZERO — for many students the first thing they will ever do
 * in this product — so it teaches exactly one idea and teaches it four
 * times: a cell has an address, `(x, y)`, and the address is how you find
 * it. Nothing else. No entities, no tools but the brush, no arithmetic.
 *
 * It runs on the 'bear-portrait-start' fixture: **Pip**, a small brown bear
 * in a chick hoodie, drawn as a 16×16 pixel portrait — a CHARACTER authored
 * as a world (same document format, same editor, a palette tileset where
 * terrain would be). Pip arrives four cells short of finished, and those
 * four holes are not decoration: each gap IS a step, and the student paints
 * the lesson closed.
 *
 * The arc is do-then-explain (ARCHITECTURE §9), pushed harder than in
 * lesson 01 because the audience is younger. Every step asks for the action
 * in its FIRST sentence and names the idea underneath only afterwards: paint
 * an eye, then hear what an address is; paint the other eye, then see that
 * only `x` moved; touch the top row, then hear why the ceiling is 15 and not
 * 16; paint the foot pad with no help at all, then hear that the rule never
 * depended on the color.
 *
 * ## The four gaps
 *
 * | cell      | tile              | what it is                     |
 * |-----------|-------------------|--------------------------------|
 * | (5, 8)    | 5 (ink black)     | Pip's left eye                 |
 * | (10, 8)   | 5 (ink black)     | Pip's right eye                |
 * | (7, 15)   | 5 (ink black)     | the feather sprig, TOP row     |
 * | (3, 0)    | 2 (chick yellow)  | a foot pad, BOTTOM row         |
 *
 * That table is the hand-off contract with the fixture:
 * `bear-portrait-start` is the finished `bear-portrait` art minus exactly
 * these four cells (blanked to 0), so every gap is a real hole in a real
 * drawing rather than an invisible errand. All four values were decoded out
 * of the fixture's own ASCII art, and a drift guard pins both halves per
 * cell — start empty, finished holding exactly this tile — so a one-cell
 * slip in the art, in the fixture, or in this file fails CI with the cell
 * named. That guard lives app-side, beside the fixture pins in
 * apps/editor/test/tutorial-host.test.ts, because @content/lessons is a leaf
 * package and may not import the editor to check its own numbers.
 *
 * Two orientation facts the prose leans on, both true because engine cells
 * count ty = 0 at the SOUTH edge, which a top-down render draws at the
 * BOTTOM of the screen: `(3, 0)` really is on the bottom row the student
 * sees, and `(7, 15)` really is the top. (The fixture decodes its picture
 * with that flip made explicit — see decodeBearPortraitRows.)
 *
 * ## The eye pair is the climax, and it is two steps on purpose
 *
 * Steps 2 and 3 sit back to back because the contrast is the whole teaching
 * moment: `(5, 8)` and `(10, 8)` share a `y`, so the eyes sit at exactly the
 * same height and only the first number moved. Step 3 then names the wrong
 * answer out loud — `(8, 5)` is not `(5, 8)` — and it can afford to be
 * specific: `(8, 5)` was read off the art and lands on a cream-white muzzle
 * cell, three rows below the eyes. A checkable claim beats a vague "nowhere
 * near" — and the prose asks the student to LOOK at that cell, never to
 * paint it, because a tried swap would ink a muzzle cell the lesson never
 * teaches how to repair.
 *
 * ## The checkpoint costs no extra step
 *
 * Step 5 is the assessment, folded into the last gap instead of spending a
 * sixth beat on ceremony: its onEnter clears the overlays, its figure
 * carries none, and — the part that makes it an assessment at all — the
 * prose WITHHOLDS the numerals. Every earlier step hands over an address
 * the readout can simply be matched against; this one describes the cell
 * in words (bottom row, three cells east of the corner) and asks the
 * student to produce `(3, 0)` themselves. The explanation (y = 0 is the
 * bottom row, the origin sits at its left end) arrives only after the cell
 * is painted, and the switch from black to yellow does the rest of the
 * work for free: the color changed, the method did not.
 *
 * ## Design constraints, deliberately visible
 *
 * - **Every completion is an EVENT — no exceptions.** This is a fixture
 *   lesson, so `loadFixture` may return false and the lesson then runs on
 *   whatever world is open; a step that gated on a fact about Pip's cells
 *   (`tile-at`) would strand that student forever. Five paint gates and one
 *   view gate, all moments. (The content test demands this of every fixture
 *   lesson; 'three-views' set the precedent.) One honesty note on the
 *   limit of that resilience: steps 2–5 pin `layerId: 'portrait'`, so on a
 *   host that truly cannot stage Pip no real brushstroke could satisfy
 *   them — the machine never wedges (the corpus completes the lesson with
 *   synthetic events), but a live fixture-less student would stall. What
 *   keeps that theoretical is the FIXTURES registry's add-never-remove
 *   rule; dropping the layer pin instead would let a splat on some other
 *   world's (5, 8) "open Pip's eye", which is the worse dishonesty.
 * - **Four of those paint gates carry `where` + `atCell`.** `where` pins the
 *   color and the layer; `atCell` pins the cell — it is the reason `atCell`
 *   exists at all. Without it, `builder.tile-painted` completes on ANY cell,
 *   and "paint the eye at `(5, 8)`" would be satisfied by a splat on the
 *   floor. It is the event-only mirror of lesson 02's `toCell`.
 * - **Steps 1–5 re-declare `topdown` in onEnter** (lesson 03's defensive
 *   pattern): reset and resume must restore the flat picture the prose
 *   describes, and a view effect can never satisfy a tile-painted gate, so
 *   re-declaring costs nothing.
 * - **`show-overlays` is replace-semantics, so every step states its overlay
 *   set explicitly** — including the two EMPTY ones. Scaffolding that leaked
 *   from step 4 into step 5 would quietly undo the checkpoint.
 * - **The finale's onEnter normalizes the view to TOPDOWN — never iso.** It
 *   gates on `builder.view-projection-changed` with `to: 'iso'`; an onEnter
 *   that set ISO would emit the very event the step waits for and complete
 *   it before the student read a word. Setting topdown is safe (its event
 *   carries `to: 'topdown'`, which the gate ignores) and it closes the one
 *   stuck state this step could have: a student who tilted the view early,
 *   for whom pressing Iso while already iso would change nothing and emit
 *   nothing — the editor's no-op switch is not a switch. Entering the
 *   finale always begins flat, so the flip is always a flip.
 * - **No iso figure appears anywhere in this lesson** — not even on the
 *   finale, whose figure shows the FINISHED portrait still FLAT. Pip
 *   standing up is the only reveal the lesson owns, and a picture of it
 *   beside the prose would spend it before the student pressed the button.
 * - **No save step, ever.** The fixture REPLACED the student's document;
 *   asking them to save here would write Pip over their own world slot. That
 *   rule was written down in lesson 03 and it holds for every fixture lesson
 *   until a fixture lesson has somewhere safe to save.
 * - **Undo is reassurance AND the painted-ahead escape — never a step.** It
 *   appears in passing (the freebie and checkpoint hints) so that "wrong
 *   tries cost nothing" is heard while working, not staged. And every
 *   atCell step carries a last hint teaching undo-then-repaint, because a
 *   student who fills a gap EARLY would otherwise be stuck forever:
 *   repainting a cell that already holds the right tile is a no-op the
 *   editor deliberately does not announce (nothing changed, nothing
 *   recorded), so the gate could never fire and no world-fact rescue
 *   exists in an event-only lesson.
 */

import type { Lesson, LensOverlaySpec, StepEffect } from './types'

/** The flat picture every painting step is written against. Re-declared per
 * step (effects are replace-semantics) so reset() restores it. */
const flatView: StepEffect = { kind: 'set-view-projection', projection: 'topdown' }

/** Clears the tutorial's overlay set. Stated explicitly on the steps that
 * want a bare canvas — the freebie and the unscaffolded checkpoint — because
 * an omitted `show-overlays` leaves the PREVIOUS step's ink on screen. */
const noOverlays: StepEffect = { kind: 'show-overlays', overlays: [] }

/**
 * Step 2's scaffolding: the address read out as a journey. Overlay points
 * are WORLD points, so a cell's center is its address + 0.5 — the arrows
 * run corner-cell center `(0.5, 0.5)` → `(5.5, 0.5)` → `(5.5, 8.5)`, which
 * is "5 east, then 8 north" drawn on the floor.
 *
 * The same array feeds the live canvas (onEnter) and the figure beside the
 * prose, so the picture the student reads about and the picture under their
 * brush cannot drift apart.
 */
const firstEyeOverlays: ReadonlyArray<LensOverlaySpec> = [
  { kind: 'arrow', from: { x: 0.5, y: 0.5 }, to: { x: 5.5, y: 0.5 }, label: '5 east' },
  { kind: 'arrow', from: { x: 5.5, y: 0.5 }, to: { x: 5.5, y: 8.5 }, label: 'then 8 north' },
  { kind: 'cell-highlight', tx: 5, ty: 8, label: '(5, 8)' },
]

/** Step 4's scaffolding: one tall arrow up column 7, from the bottom row to
 * the ceiling, ending on the sprig cell. Shared by onEnter and the figure. */
const topRowOverlays: ReadonlyArray<LensOverlaySpec> = [
  { kind: 'arrow', from: { x: 7.5, y: 0.5 }, to: { x: 7.5, y: 15.5 }, label: 'y climbs 0 to 15' },
  { kind: 'cell-highlight', tx: 7, ty: 15, label: '(7, 15) — top row' },
]

/** Arc 1 of the curriculum, and the first lesson of all: addresses, taught
 * by finishing Pip's portrait on the 'bear-portrait-start' fixture. */
export const lesson00: Lesson = {
  id: 'paint-by-numbers',
  title: 'Paint by numbers',
  arc: 'coordinates',
  fixture: 'bear-portrait-start',
  steps: [
    {
      id: 'meet-pip',
      title: 'Meet Pip',
      // The freebie. Lesson 01 points at 'palette.tiles' here, but in the
      // very first lesson the BRUSH is the unknown thing — a student who has
      // never held the tool cannot use a palette.
      target: { kind: 'anchor', anchor: 'toolbar.brush' },
      onEnter: [flatView, noOverlays],
      instruction:
        'Pick the **brush**. Choose any color you like and paint one square of the empty space ' +
        'beside Pip — anywhere at all. Artists sign their work.\n\n' +
        'The small brown bear in the chick hoodie is **Pip**, and Pip is not finished. Four ' +
        'squares of this picture are still empty, and you are the one who is going to fill them ' +
        'in.\n\n' +
        'Each square is called a **cell**. Every cell has an address made of two numbers, ' +
        'written like `(x, y)`. As you move around the grid, the two numbers at the bottom of ' +
        'the screen follow you from cell to cell.',
      hints: [
        'The brush is in the toolbar. Click it, pick any color from the palette, then click an ' +
          'empty square beside Pip. Any color, any square — this one is a freebie.',
        'No mouse needed: press `B` for the brush, pick a color from the palette, then inside ' +
          'the canvas use the **arrow keys** to walk the cell cursor and press `Enter` to paint ' +
          'where it stands. Painted somewhere you did not mean to? Press `Ctrl+Z` (`Cmd+Z` on ' +
          'a Mac) — nothing here is ruined.',
      ],
      figures: [
        {
          kind: 'scene',
          fixture: 'bear-portrait-start',
          projection: 'topdown',
          alt:
            'A pixel portrait seen from straight above: a small brown bear in a yellow chick ' +
            'hoodie, sitting on a soft checkered studio floor. Both eye squares are blank, the ' +
            'sprig on top of the hood is missing, and one square of a foot pad is unpainted.',
          caption: 'This is Pip — almost finished.',
        },
      ],
      // The ONE bare paint gate in the lesson: any color, any cell, any
      // layer. A freebie that demanded precision would not be a freebie.
      completion: { kind: 'event', type: 'builder.tile-painted' },
    },
    {
      id: 'the-first-eye',
      title: 'Pip’s first eye',
      target: { kind: 'cell', tx: 5, ty: 8 },
      onEnter: [flatView, { kind: 'show-overlays', overlays: firstEyeOverlays }],
      instruction:
        'Paint the eye on the left **ink black**, on the cell `(5, 8)` — Pip cannot see you ' +
        'yet.\n\n' +
        'Reading an address is the whole trick, and it never changes. The first number is `x`, ' +
        'how far **east** — to the right. The second is `y`, how far **north** — up the grid. ' +
        'So `(5, 8)` means: start at the bottom-left corner, go 5 cells east, then 8 cells ' +
        'north.\n\n' +
        'That corner has a name. It is `(0, 0)`, the **origin**, and every address on this grid ' +
        'is counted from it.',
      hints: [
        'Choose **ink black** from the palette, then move slowly and watch the two numbers at ' +
          'the bottom of the screen — they are the address of the cell you are standing on. ' +
          'When they read `(5, 8)`, paint.',
        'Count it out: from the corner `(0, 0)`, go **5 cells east**, then **8 cells north**. ' +
          'On the keyboard: press `B` for the brush, pick ink black, walk the cell cursor with ' +
          'the **arrow keys** (hold `Shift` for 5-cell steps), and press `Enter` the moment the ' +
          'readout says `(5, 8)`.',
        'Is that square already black? Press `Ctrl+Z` (`Cmd+Z` on a Mac) — one undo takes ' +
          'back a whole brushstroke, so repaint any square that goes blank, and finish by ' +
          'painting this one yourself. The step is watching for your brushstroke.',
      ],
      figures: [
        {
          kind: 'scene',
          fixture: 'bear-portrait-start',
          projection: 'topdown',
          overlays: firstEyeOverlays,
          alt:
            'The unfinished portrait from above. An arrow runs five cells east along the bottom ' +
            'row from the corner, a second arrow climbs eight cells north up that column, and ' +
            'it ends on a highlighted blank cell where the eye on the left of the picture ' +
            'belongs.',
          caption: 'Every address is two numbers: how far east, then how far north.',
        },
      ],
      // `where` pins the color (tile 5 = ink black) and the layer; `atCell`
      // pins the cell. Both are needed: a bare builder.tile-painted completes
      // on ANY cell, so without `atCell` a splat on the floor would open the
      // eye. The world-fact version of this gate (tile-at) is forbidden here
      // — a fixture lesson may not depend on the fixture having loaded.
      completion: {
        kind: 'event',
        type: 'builder.tile-painted',
        where: { tile: 5, layerId: 'portrait' },
        atCell: { tx: 5, ty: 8 },
      },
    },
    {
      id: 'the-second-eye',
      title: 'And the other one',
      target: { kind: 'cell', tx: 10, ty: 8 },
      // The live overlays differ from this step's figure on purpose: the
      // canvas labels say "done" and "next" because the student is standing
      // in the middle of the job, while the figure simply names both
      // addresses so the pair can be compared at rest.
      onEnter: [
        flatView,
        {
          kind: 'show-overlays',
          overlays: [
            { kind: 'cell-highlight', tx: 5, ty: 8, label: 'done: (5, 8)' },
            { kind: 'cell-highlight', tx: 10, ty: 8, label: 'next: (10, 8)' },
            {
              kind: 'arrow',
              from: { x: 5.5, y: 8.5 },
              to: { x: 10.5, y: 8.5 },
              label: 'same y = 8, only x changes',
            },
          ],
        },
      ],
      // The swap trap is a CHECKABLE claim, not a scare: (8, 5) was read off
      // the fixture's art, where it is a cream-white muzzle cell — three rows
      // below the eye row, ty 8 → ty 5. The prose asks the student to LOOK at
      // that cell, never to paint it — a tried swap would ink a muzzle cell
      // this lesson teaches no way to repair. (Pinned beside the fixture; if
      // the art ever moves, this sentence must move with it.)
      instruction:
        'Now the other eye, same **ink black**, at `(10, 8)` — and Pip can see you.\n\n' +
        'Put the two addresses side by side: `(5, 8)` and `(10, 8)`. The second number is `8` ' +
        'both times, so both eyes sit on the same row, at exactly the same height. Only the ' +
        'first number moved, from `5` to `10`. That is all `x` ever does — it slides you east ' +
        'and west.\n\n' +
        'Mind the order, because it is the easiest mistake on the whole grid. `(8, 5)` is ' +
        '**not** `(5, 8)`. Look where `(8, 5)` would put you — three rows lower, down in Pip’s ' +
        'white muzzle, nowhere near an eye.',
      hints: [
        'Same brush, same ink black, same row as the eye you just painted — only further east. ' +
          'Walk right and watch the readout until it says `(10, 8)`.',
        'From the eye you just painted, count five more cells east: 6, 7, 8, 9, 10. On the ' +
          'keyboard the **arrow keys** walk the cell cursor and the readout at the bottom ' +
          'follows along — press `Enter` on `(10, 8)`.',
        'Is that square already black? Press `Ctrl+Z` (`Cmd+Z` on a Mac) — one undo takes ' +
          'back a whole brushstroke, so repaint any square that goes blank, and finish by ' +
          'painting this one yourself. The step is watching for your brushstroke.',
      ],
      figures: [
        {
          kind: 'scene',
          fixture: 'bear-portrait-start',
          projection: 'topdown',
          overlays: [
            { kind: 'cell-highlight', tx: 5, ty: 8, label: '(5, 8)' },
            { kind: 'cell-highlight', tx: 10, ty: 8, label: '(10, 8)' },
            {
              kind: 'arrow',
              from: { x: 5.5, y: 8.5 },
              to: { x: 10.5, y: 8.5 },
              label: 'same y = 8, only x changes',
            },
          ],
          alt:
            'The unfinished portrait from above with both eye cells marked at exactly the same ' +
            'height, (5, 8) on the left and (10, 8) on the right, joined by a horizontal arrow ' +
            'showing that only the first number changes between them.',
          caption: 'Same height, different side — only the x number moved.',
        },
      ],
      completion: {
        kind: 'event',
        type: 'builder.tile-painted',
        where: { tile: 5, layerId: 'portrait' },
        atCell: { tx: 10, ty: 8 },
      },
    },
    {
      id: 'the-top-feather',
      title: 'The top of the hood',
      target: { kind: 'cell', tx: 7, ty: 15 },
      onEnter: [flatView, { kind: 'show-overlays', overlays: topRowOverlays }],
      // The ceiling is ty 15 because the portrait layer is 16 cells tall and
      // addresses are 0-based — the genuinely non-obvious question a
      // ten-year-old asks here, so the prose answers it instead of dodging.
      instruction:
        'Paint the little feather sprig at the very top of Pip’s hood **ink black** — it ' +
        'belongs at `(7, 15)`.\n\n' +
        'You have just touched the ceiling. `15` is as high as `y` goes here. The grid is 16 ' +
        'cells tall, but the top row is `y = 15`, not `16` — counting starts at the origin, ' +
        'at `0`. The rows run `0, 1, 2` and onward, all the way up to `15`.\n\n' +
        'So `y` is simply how far up you are. It does not care what `x` is doing.',
      hints: [
        'Head for the very top row of the grid, then walk sideways until the first number in ' +
          'the readout says `7`. It should read `(7, 15)`.',
        'Keyboard: press `B`, choose ink black, then hold the **up arrow** until the readout ' +
          'will not climb any higher — that is `y = 15`. Walk left or right until the first ' +
          'number reads `7`, then press `Enter`.',
        'Is that square already black? Press `Ctrl+Z` (`Cmd+Z` on a Mac) — one undo takes ' +
          'back a whole brushstroke, so repaint any square that goes blank, and finish by ' +
          'painting this one yourself. The step is watching for your brushstroke.',
      ],
      figures: [
        {
          kind: 'scene',
          fixture: 'bear-portrait-start',
          projection: 'topdown',
          overlays: topRowOverlays,
          alt:
            'The unfinished portrait from above with a tall arrow climbing the full height of ' +
            'the column where x is 7, from the bottom row up to a highlighted blank cell in ' +
            'the very top row, where the feather sprig on Pip’s hood belongs.',
          caption: 'The top row is y = 15, not 16 — counting starts at 0.',
        },
      ],
      completion: {
        kind: 'event',
        type: 'builder.tile-painted',
        where: { tile: 5, layerId: 'portrait' },
        atCell: { tx: 7, ty: 15 },
      },
    },
    {
      id: 'the-foot-pad',
      title: 'A foot to stand on',
      target: { kind: 'cell', tx: 3, ty: 0 },
      // The checkpoint. `noOverlays` strips the arrows, and the prose strips
      // the NUMERALS: the cell is described in words and the student produces
      // (3, 0) themselves — the reverse direction every scaffolded step
      // practiced, which is what makes this an assessment. Only the last
      // hint surrenders the address.
      onEnter: [flatView, noOverlays],
      instruction:
        'Last gap: the blank square in Pip’s foot pad on the left — bottom row, three cells ' +
        'east of the corner. Work out its address, then paint it **chick yellow**. No arrows ' +
        'this time — you know how to read an address now.\n\n' +
        'Painted? Then look at where you ended up. `y = 0` is the bottom row, as low as this ' +
        'grid goes. The origin `(0, 0)` sits at its left end, and `(3, 0)` only ever meant ' +
        'this: stay on the bottom row, count three cells in from the corner.\n\n' +
        'Notice what changed and what did not. The color changed. The way you found the cell ' +
        'did not. Black, yellow, orange, cream — every square on this grid is found the same ' +
        'way, by its two numbers.',
      hints: [
        'The bottom row is `y = 0`. Choose chick yellow, go all the way down, then count `x` ' +
          'across from the left corner.',
        'Keyboard: press `B`, pick chick yellow, hold the **down arrow** until the readout ' +
          'stops at `y = 0`, then walk sideways until it reads `(3, 0)` and press `Enter`. ' +
          'Landed one cell off? Press `Ctrl+Z` (`Cmd+Z` on a Mac) and try again — Pip does ' +
          'not mind.',
        'Is that square already yellow? Press `Ctrl+Z` (`Cmd+Z` on a Mac) — one undo takes ' +
          'back a whole brushstroke, so repaint any square that goes blank, and finish by ' +
          'painting this one yourself. The step is watching for your brushstroke.',
      ],
      figures: [
        {
          kind: 'scene',
          fixture: 'bear-portrait-start',
          projection: 'topdown',
          alt:
            'The unfinished portrait from above with no guide arrows and no labels this time — ' +
            'just the grid, Pip, and the blank foot-pad square sitting on the very bottom row.',
          caption: 'No arrows this time. You have the rule — use it.',
        },
      ],
      // The only non-black gate: tile 2 is chick yellow. Same shape as the
      // three above, which is the point the prose just made.
      completion: {
        kind: 'event',
        type: 'builder.tile-painted',
        where: { tile: 2, layerId: 'portrait' },
        atCell: { tx: 3, ty: 0 },
      },
    },
    {
      id: 'pip-stands-up',
      title: 'Pip stands up',
      target: { kind: 'anchor', anchor: 'toolbar.viewIso' },
      // `flatView` here sets TOPDOWN, never iso: an onEnter that set iso
      // would emit the very event this step waits for and complete it before
      // the student read a word, while topdown's event carries to:'topdown',
      // which the gate ignores. It also closes the one stuck state this step
      // could have — a student who tilted the view early, for whom pressing
      // Iso while already iso changes nothing and emits nothing (the
      // editor's no-op switch is not a switch). Entering here always begins
      // flat, so the flip is always a flip.
      onEnter: [flatView, noOverlays],
      instruction:
        'Pip is finished. Press the **Iso** view button.\n\n' +
        'Keep your eye on the squares. Nothing you painted is going to move — not one cell, not ' +
        'one number. But every square of Pip sits one step above the floor. From this new ' +
        'angle you can finally see it: the flat drawing tips up into a little sculpture — your ' +
        'signature square and all.\n\n' +
        'Same grid. Same addresses, exactly where you left them. Just a different way of ' +
        'looking at them. That is how **2.5D** games are drawn — flat pictures, tipped up at ' +
        'an angle, exactly like this one. Coordinates were never homework. They are how the ' +
        'picture got made in the first place.\n\n' +
        'One more thing, before you go. Look closely: Pip is still flat as a cookie — every ' +
        'block exactly one step tall. Two numbers can only ever draw a picture. The next ' +
        'lesson hands you a **third** number, and Pip sits up for real.',
      hints: [
        'The three view buttons sit together in the toolbar. You want the one named **Iso**.',
        'No mouse needed: press `Tab` until the **Iso** button in the toolbar has focus, then ' +
          'press `Enter`.',
      ],
      // The finished portrait, still FLAT. The iso picture is withheld from
      // the whole lesson so the button press is the first time the student
      // ever sees Pip stand up.
      figures: [
        {
          kind: 'scene',
          fixture: 'bear-portrait',
          projection: 'topdown',
          alt:
            'The completed portrait seen flat from above: a small brown bear in a yellow chick ' +
            'hoodie with both eyes open, a black feather sprig on top of the hood and both ' +
            'yellow foot pads painted, sitting on the checkered studio floor.',
          caption: 'Finished — and still flat. One button left.',
        },
      ],
      completion: { kind: 'event', type: 'builder.view-projection-changed', where: { to: 'iso' } },
    },
  ],
}
