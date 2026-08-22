/**
 * Lesson 01 — "The third number": z, taught by finishing voxel Pip.
 *
 * Lesson 00 ended on a promise ("the next lesson hands you a **third**
 * number, and Pip sits up for real"), and this lesson pays it. It runs on
 * the 'bear-figure-start' fixture: the voxel sibling of the flat portrait —
 * same bear, same seven-color palette, now built from ~2,400 blocks stacked
 * in eighteen 24×24 SLICES, one per z. Each slice is its own tile layer,
 * named `z = 1` … `z = 18` in the Layers panel, and the brush always paints
 * on the ACTIVE layer.
 *
 * Which is the entire lesson, in one sentence: **choosing the slice IS
 * choosing the height.** Everything else here is scaffolding around it.
 * There is no z readout to point at — the status bar honestly shows two
 * numbers, because finding a CELL only ever needed two — so the prose says
 * where the third number really lives (the panel) instead of inventing a
 * gauge the editor does not have.
 *
 * ## The four gaps, in ascending z
 *
 * | cell     | slice   | tile             | what it is                  |
 * |----------|---------|------------------|-----------------------------|
 * | (6, 2)   | z = 1   | 2 (chick yellow) | a foot-pad block            |
 * | (12, 9)  | z = 11  | 5 (ink black)    | half of Pip's nose          |
 * | (13, 7)  | z = 14  | 3 (beak orange)  | a corner of the hood's beak |
 * | (12, 13) | z = 18  | 5 (ink black)    | half the feather sprig, TOP |
 *
 * That table is the hand-off contract with the fixture, exactly as lesson
 * 00's is: 'bear-figure-start' is the finished 'bear-figure' art minus these
 * four cells (blanked to 0), so every gap is a real hole in a real figure.
 * The numbers were decoded out of the fixture's own slice art, and the
 * drift guard that pins both halves per cell lives app-side beside the
 * fixture pins (@content/lessons is a leaf package and may not import the
 * editor to check its own numbers).
 *
 * Four claims in the prose are claims about GEOMETRY, so each was read off
 * the slice art rather than assumed: the nose block at (12, 9) is roofed by
 * the z12 face wall and its south face is exposed (z11 is empty at
 * (12, 8)), with the nose's OTHER half already painted beside it at
 * (11, 9); the beak corner at (13, 7) hangs over a deep gap of open air —
 * (13, 7) is empty on every slice from z7 through z13, seven empty slices,
 * and the nearest block below it is the hoodie hem at z6, eight slices
 * down; the sprig at (12, 13) shares z18 with only the tips
 * of Pip's ears (plus the sprig's own other half at (11, 13)); and the
 * foot pads are the southernmost blocks of z1, poking out in front of the
 * chest.
 *
 * ## Ascending z is the pedagogy, not just the fixture's build order
 *
 * Step 1 asks for NO new skill — `z1` is `layers[0]`, so it is already the
 * active slice when the fixture loads — and exists to prove the transfer:
 * same brush, same origin, same readout, same `(x, y)`. Step 2 is the crux
 * and the only step that introduces machinery (press the slice, then hear
 * why). Step 3 is consolidation with half the scaffolding gone: `z` is
 * which storey, every slice is the same 24×24 grid, and z hops like x does
 * — three slices in one press. Step 4 is the checkpoint.
 *
 * ## The checkpoint withholds the SLICE, not the address
 *
 * Lesson 00's assessment withheld the NUMERALS and made the student produce
 * `(3, 0)`. Repeating that here would assess a skill this lesson is not
 * teaching, so step 4 hands over `(12, 13)` and withholds the slice: the
 * student must reason "highest slice, the one the ear tips are on" to
 * `z = 18`. Its onEnter clears the overlays, its figure carries none, and
 * the prose says "no ring, no arrows" out loud so the removal reads as
 * trust rather than as a bug. (The step's target still carries `z: 18`, so
 * "show me" surrenders the answer on request — lesson 00's precedent, and
 * the deliberate floor under an unscaffolded step.) The explanation lands
 * only after the block is painted — and it answers the question a
 * ten-year-old actually asks here:
 * the slice numbers are HEIGHTS, not places in a list. `z = 1` is the slab
 * from 0 to 1, there is no slice called zero, and the floor everything
 * stands on is `z = 0`. (Same move as lesson 00's "the top row is y = 15,
 * not 16" — and it stops "counting always starts at 0" from being
 * over-generalised into a wrong prediction about the Layers panel.) It also
 * makes the payoff checkable rather than metaphorical: the portrait layer
 * really does sit at elevation 1, so "the flat portrait was one slice
 * thick" is a fact about the fixture.
 *
 * ## The three-view finale, and its onEnter safety chain
 *
 * Steps 5–7 walk iso → profile → top-down → iso, which is the perspectives
 * arc's seed and the moment lesson 00's portrait is revealed to have been
 * ONE PICTURE OF a world with height in it all along. Every step gates on
 * `builder.view-projection-changed`, so every onEnter must be a view the
 * step's own gate ignores. The chain, link by link:
 *
 * - steps 1–4 set `iso` — the fixture's primary projection and the picture
 *   every paint instruction is written against, re-declared so reset and
 *   resume restore it (a view effect can never satisfy a tile-painted gate);
 * - step 5 gates on `profile` and sets `iso` (the view the student is
 *   already in — a no-op on entry, a correcting effect on resume);
 * - step 6 gates on `topdown` and sets `profile`, likewise;
 * - step 7 gates on `iso` and sets `topdown` — lesson 00's finale pattern
 *   exactly. It cannot emit the awaited event, and it closes the one stuck
 *   state the step could have: a student already in iso, for whom pressing
 *   Iso changes nothing and emits nothing (the editor's no-op switch is not
 *   a switch).
 *
 * ## Design constraints, deliberately visible
 *
 * - **Every completion is an EVENT.** Fixture lesson: `loadFixture` may
 *   return false and the lesson then runs on whatever world is open, so a
 *   step gating on a fact about Pip's blocks would strand that student.
 *   Four paint gates, three view gates, all moments.
 * - **Each paint gate pins the color AND the layer in `where`, the cell in
 *   `atCell` — so the layerId IS the z gate.** A right-cell/wrong-slice
 *   block cannot complete a step, which is this lesson's whole idea
 *   expressed as a machine check. The honesty note lesson 00 recorded
 *   applies here in stronger form: pinning `z1`/`z11`/`z14`/`z18` means a
 *   host that truly could not stage 'bear-figure-start' would strand a live
 *   student. Accepted for the same reason — the alternative, dropping the
 *   layer pin, would let a splat on any world's (12, 9) "finish Pip's
 *   nose", and the layer pin is the taught idea. (The machine never wedges:
 *   the replay corpus completes the lesson with synthetic events.)
 * - **`show-overlays` is replace-semantics, so every step states its full
 *   set** — including the four EMPTY ones. Scaffolding leaking into step 4
 *   would quietly undo the checkpoint.
 * - **Cell targets carry `z`,** so the "show me" ring floats at the block's
 *   own height instead of a phantom ring on the floor beneath it. Step 2 is
 *   the deliberate exception: its target is the `panel.layers` anchor, not
 *   the cell, because the cell is already ringed by the step's own overlay
 *   and the UNKNOWN thing in that step is the panel. (Same reasoning that
 *   pointed lesson 00's freebie at `toolbar.brush` instead of the palette.)
 * - **No figure spends a reveal the student has not caused yet** — lesson
 *   00's hardest-won rule. The reveals here are profile and top-down of the
 *   voxel figure, so: steps 1–4 show iso ('bear-figure-start'), step 5
 *   shows iso ('bear-figure', the thing they just finished), step 6 shows
 *   lesson 00's FLAT PORTRAIT beside the profile the student is standing
 *   in, and only step 7 — reached after both flips — shows the figure in
 *   profile, as "where you were a moment ago" (lesson 03's idiom of holding
 *   the view you just left beside the view you are in). Top-down of the
 *   figure is never a figure at all; the live canvas is the only place it
 *   exists.
 * - **No save step, ever.** The fixture REPLACED the student's document.
 *   The rule holds for every fixture lesson until one has somewhere safe to
 *   save.
 * - **Undo carries two escapes now.** The painted-ahead escape is lesson
 *   00's (repainting a cell that already holds the right tile is a no-op
 *   the editor deliberately does not announce, so an event-only gate could
 *   never fire) and every paint step's last hint teaches it. The new one is
 *   this lesson's own hazard: in a stack, a mis-slice is DESTRUCTIVE where a
 *   mis-cell was not — ink black at (12, 9) on `z12` overwrites a real face
 *   block — so the first layer-switch step and the unscaffolded checkpoint
 *   each carry an explicit wrong-slice recovery line, and every escape hint
 *   names the slice to repaint on. Undo stays reassurance and escape hatch,
 *   never a step.
 *
 * ## Redesigned at 24×24×18 (Aug 2026)
 *
 * The first figure was 16×16×10, and it failed visual review: at that
 * resolution an ear was one block, the eyes vanished into the face, and the
 * hood had no eyes at all. The redesign gives every feature real size (2×2
 * eyes, a 4-wide proud beak, 5-wide feet, the hood's own eye dots) and
 * moved the gaps with it — the roofed-block beat now belongs to the NOSE
 * (its top hidden under the z12 face wall, so painting it shows only on
 * Pip's front), and the checkpoint asks for the sprig's second half. Every
 * address and slice above was re-verified against the redesigned art.
 */

import type { Lesson, LensOverlaySpec, StepEffect } from './types'

/** The picture every instruction in this lesson is written against — the
 * fixture's own primary projection, because a stack of eighteen slices only
 * reads as a bear when height has somewhere to go. Re-declared per step
 * (effects are replace-semantics) so reset() restores it. */
const isoView: StepEffect = { kind: 'set-view-projection', projection: 'iso' }

/** Clears the tutorial's overlay set. Stated explicitly on every bare step —
 * the checkpoint and all three finale steps — because an omitted
 * `show-overlays` leaves the PREVIOUS step's ink on screen. */
const noOverlays: StepEffect = { kind: 'show-overlays', overlays: [] }

/**
 * Step 1's scaffolding: lesson 00's journey, deliberately re-run on the
 * floor. Overlay points are WORLD points, so a cell's center is its address
 * + 0.5 — the arrows run `(0.5, 0.5)` → `(6.5, 0.5)` → `(6.5, 2.5)`, which
 * is "6 east, then 2 north" drawn from the origin.
 *
 * Continuity IS the message here, so the picture is the old picture with
 * exactly one thing changed: the ring is lifted to `z: 1`, the elevation of
 * the slice the block lands on.
 *
 * The same array feeds the live canvas (onEnter) and the figure beside the
 * prose, so the picture the student reads about and the picture under their
 * brush cannot drift apart.
 */
const footPadOverlays: ReadonlyArray<LensOverlaySpec> = [
  { kind: 'arrow', from: { x: 0.5, y: 0.5, z: 0 }, to: { x: 6.5, y: 0.5, z: 0 }, label: '6 east' },
  { kind: 'arrow', from: { x: 6.5, y: 0.5, z: 0 }, to: { x: 6.5, y: 2.5, z: 0 }, label: 'then 2 north' },
  { kind: 'cell-highlight', tx: 6, ty: 2, z: 1, label: '(6, 2) on z = 1' },
]

/**
 * Step 2's scaffolding: the same journey turned VERTICAL. The arrow stands
 * at `(12.5, 2.5)` — a column verified empty on every slice, so nothing it
 * passes is a block it could be confused for (on SCREEN the iso camera does
 * lay it across Pip's hip; in the WORLD it threads clear air) — rises
 * 0 → 11, then runs north at that height and lands on the ring at the nose.
 */
const noseOverlays: ReadonlyArray<LensOverlaySpec> = [
  { kind: 'arrow', from: { x: 12.5, y: 2.5, z: 0 }, to: { x: 12.5, y: 2.5, z: 11 }, label: 'up to z = 11' },
  {
    kind: 'arrow',
    from: { x: 12.5, y: 2.5, z: 11 },
    to: { x: 12.5, y: 9.5, z: 11 },
    label: 'then in to his face',
  },
  { kind: 'cell-highlight', tx: 12, ty: 9, z: 11, label: '(12, 9) on z = 11' },
]

/** Step 3's scaffolding: the ring alone, floating at the beak's height with
 * nothing under it — which is the step's point, so nothing else is drawn. */
const beakOverlays: ReadonlyArray<LensOverlaySpec> = [
  { kind: 'cell-highlight', tx: 13, ty: 7, z: 14, label: '(13, 7) on z = 14' },
]

/** Arc 1 of the curriculum, second lesson: the third number, taught by
 * finishing voxel Pip on the 'bear-figure-start' fixture. */
export const lessonThirdNumber: Lesson = {
  id: 'the-third-number',
  title: 'The third number',
  arc: 'coordinates',
  fixture: 'bear-figure-start',
  steps: [
    {
      id: 'the-ground-floor',
      title: 'The ground floor',
      // No new skill on purpose: 'z1' is layers[0], so the slice this step
      // needs is already active when the fixture loads. The step exists to
      // prove the transfer — same brush, same origin, same readout.
      target: { kind: 'cell', tx: 6, ty: 2, z: 1 },
      onEnter: [isoView, { kind: 'show-overlays', overlays: footPadOverlays }],
      instruction:
        'Paint the missing block of the foot pad on the left **chick yellow**, at `(6, 2)`.\n\n' +
        'Pip is not a picture anymore — he is a pile of blocks. They are stacked in eighteen ' +
        'flat **slices**, one on top of the next, and the **Layers** panel has a button for ' +
        'every one of them: `z = 1` through `z = 18`, plus one more called `floor` — that is ' +
        'the checkered ground itself, not a slice, and you will not need it. Your brush paints ' +
        'on whichever slice is chosen, and `z = 1` is chosen already. That is the slice sitting ' +
        'on the floor, down where his feet are.\n\n' +
        'So this first block is the job you already know. `(6, 2)` still means 6 cells east, ' +
        'then 2 cells north, counted from the origin at the corner. Same grid. Same readout at ' +
        'the bottom of the screen. Same brush. Pip just got taller.',
      hints: [
        'Nothing new to choose here — `z = 1` is already the slice the brush is on. Pick **chick ' +
          'yellow** from the palette, then move until the readout at the bottom reads `(6, 2)` ' +
          'and paint. (If you have been clicking around in the **Layers** panel already, check ' +
          'that `z = 1` is the button still pressed.)',
        'Count it from the origin: 6 cells east, then 2 cells north — the row where Pip’s feet ' +
          'stick out in front of him. Keyboard: `Tab` to **chick yellow** in the palette and ' +
          'press `Enter` — picking a color picks the brush with it — then keep tabbing past the ' +
          'panels until the canvas has focus, walk the cell cursor with the **arrow keys** ' +
          '(hold `Shift` for 5-cell jumps) and press `Enter` the moment the readout says ' +
          '`(6, 2)`.',
        'Is that block already yellow? Press `Ctrl+Z` (`Cmd+Z` on a Mac) — one undo takes back a ' +
          'whole brushstroke, so repaint any block that goes blank, and finish by painting this ' +
          'one yourself, on `z = 1`. The step is watching for your brushstroke.',
      ],
      figures: [
        {
          kind: 'scene',
          fixture: 'bear-figure-start',
          projection: 'iso',
          overlays: footPadOverlays,
          alt:
            'Voxel Pip seen from an angle on a checkered floor: a blocky sitting bear in a big ' +
            'rounded yellow hood with brown ears, an orange beak jutting from the hood, brown ' +
            'arms at his sides, a white belly, and two wide feet with yellow pads. Two arrows ' +
            'run along the floor from the corner of the grid — six cells east, then two cells ' +
            'north — and end at a highlighted gap in the left foot pad, which is one block ' +
            'short.',
          caption: 'Same grid, same address — now with blocks standing on it.',
        },
      ],
      // `where` pins the color (tile 2 = chick yellow) AND the slice —
      // layerId 'z1' is the z gate. `atCell` pins the cell, without which a
      // bare tile-painted completes on any cell at all.
      completion: {
        kind: 'event',
        type: 'builder.tile-painted',
        where: { tile: 2, layerId: 'z1' },
        atCell: { tx: 6, ty: 2 },
      },
    },
    {
      id: 'eleven-slices-up',
      title: 'Eleven slices up',
      // The crux, and the only step that introduces machinery — so it
      // points at the PANEL, not the cell. The cell already wears a ring
      // (below); the unknown thing here is where the third number is said.
      target: { kind: 'anchor', anchor: 'panel.layers' },
      onEnter: [isoView, { kind: 'show-overlays', overlays: noseOverlays }],
      // The nose block is genuinely roofed — the z12 face wall sits directly
      // above (12, 9) — and its south face is exposed, because z11 is empty
      // at (12, 8). Both read off the fixture's slice art; if that art ever
      // moves, this paragraph moves with it.
      instruction:
        'Press `z = 11` in the **Layers** panel, then finish Pip’s nose **ink black** at ' +
        '`(12, 9)`. Keep watching his face while you do it: the slice above roofs that block ' +
        'over, so the only part of it you will ever see is its front, going black beside the ' +
        'half of his nose that is already there.\n\n' +
        'That press was the third number. The brush only ever paints on the chosen slice, so ' +
        'choosing the slice IS choosing the height — and a block’s full address in this world is ' +
        'three numbers: `x` east, `y` north, `z` up. This one is `(12, 9)` on `z = 11`.\n\n' +
        'The readout at the bottom of the screen still shows two numbers, and it is not hiding ' +
        'anything from you. Finding a cell of the grid only ever needed two. The third number ' +
        'lives in the Layers panel, so that is where you say it.\n\n' +
        'You have seen this nose before. In the flat portrait it sat 6 rows up the page — but ' +
        'that 6 was how high it sat on the PICTURE, and climbing is not something `y` does ' +
        'here. Up is `z` now. Six and eleven do not match, because this Pip is built deeper ' +
        'and taller than his portrait. The direction matches exactly. The picture’s up was the ' +
        'world’s up all along.',
      hints: [
        // "the whole grid moves up to that height, cursor and all" is a
        // description of picking.ts, not a comforting story: pointerToCell
        // pins the pointer's constraint plane to the ACTIVE layer's
        // elevation, so choosing z = 11 really does lift the cell cursor.
        'Do the slice first. The **Layers** panel has a button for every slice — press the one ' +
          'named `z = 11`, and the whole grid moves up to that height, cursor and all. After ' +
          'that it is the same hunt as always: **ink black**, and the readout reading `(12, 9)`.',
        'Keyboard, end to end: `Tab` to **ink black** in the palette and press `Enter` — picking ' +
          'a color picks the brush with it. Keep tabbing until the `z = 11` button in the ' +
          '**Layers** panel has focus and press `Enter`. `Tab` on to the canvas, walk the cell ' +
          'cursor with the **arrow keys** (hold `Shift` for 5-cell jumps) until the readout says ' +
          '`(12, 9)`, and press `Enter`. Did a black block land at the wrong height? That is the ' +
          'wrong slice, not the wrong cell — press `Ctrl+Z` (`Cmd+Z` on a Mac) to put the old ' +
          'block back, choose `z = 11`, and go again.',
        'Is that block already black? Press `Ctrl+Z` (`Cmd+Z` on a Mac) — one undo takes back a ' +
          'whole brushstroke, so repaint any block that goes blank, and finish by painting this ' +
          'one yourself, on `z = 11`. The step is watching for your brushstroke.',
      ],
      figures: [
        {
          kind: 'scene',
          fixture: 'bear-figure-start',
          projection: 'iso',
          overlays: noseOverlays,
          alt:
            'The same voxel bear from an angle. An arrow stands on the open floor in front of ' +
            'him and climbs eleven steps into the air, then turns and runs north to a ' +
            'highlighted block-sized gap in the middle of his white muzzle — the missing half ' +
            'of his nose, right beside the black half that is already painted.',
          caption: 'Two numbers find the cell. The slice finds the height.',
        },
      ],
      completion: {
        kind: 'event',
        type: 'builder.tile-painted',
        where: { tile: 5, layerId: 'z11' },
        atCell: { tx: 12, ty: 9 },
      },
    },
    {
      id: 'up-at-the-beak',
      title: 'Up at the beak',
      target: { kind: 'cell', tx: 13, ty: 7, z: 14 },
      onEnter: [isoView, { kind: 'show-overlays', overlays: beakOverlays }],
      // Two checkable claims about the art, both decoded from the slices:
      // between the beak and the hoodie hem at z6 lie seven EMPTY slices
      // (z7–z13 hold nothing under the corner), and the beak's other
      // fifteen blocks are present — the gap is one corner.
      instruction:
        'Press `z = 14` in the **Layers** panel and paint the missing corner of the hood’s ' +
        'beak **beak orange**, at `(13, 7)`.\n\n' +
        'Three slices up in one press — `z` moves the way `x` and `y` do, by any number you ' +
        'like. `z = 14` is a complete grid of its own, twenty-four cells by twenty-four, with ' +
        'exactly the same addresses as every other slice. It is just held higher.\n\n' +
        'Now look underneath that beak. Nothing is holding it up. Count the empty slices ' +
        'between it and the top of his hoodie — seven of them — and the beak is allowed to ' +
        'hang over every one, because a block belongs to a slice and not to the ground. The ' +
        'pad you painted first sits on the floor; this corner hangs at head height. The only ' +
        'thing that tells those two apart is the slice they live on.',
      hints: [
        '`z = 14` first, in the **Layers** panel — three above the slice you just used. Then ' +
          '**beak orange** from the palette, and the readout reading `(13, 7)`. The rest of the ' +
          'beak is your landmark: the gap is its near corner.',
        'Keyboard: `Tab` to **beak orange** in the palette and press `Enter` — picking a color ' +
          'picks the brush with it. Keep tabbing until the `z = 14` button in the **Layers** ' +
          'panel has focus and press `Enter`. `Tab` on to the canvas, walk the cell cursor with ' +
          'the **arrow keys** (hold `Shift` for 5-cell jumps) until the readout says `(13, 7)`, ' +
          'and press `Enter`. Did the orange block land a step too low, in open air? That is ' +
          'the wrong slice, not the wrong cell — press `Ctrl+Z` (`Cmd+Z` on a Mac), press ' +
          '`z = 14`, and go again.',
        'Is that block already orange? Press `Ctrl+Z` (`Cmd+Z` on a Mac) — one undo takes back a ' +
          'whole brushstroke, so repaint any block that goes blank, and finish by painting this ' +
          'one yourself, on `z = 14`. The step is watching for your brushstroke.',
      ],
      figures: [
        {
          kind: 'scene',
          fixture: 'bear-figure-start',
          projection: 'iso',
          overlays: beakOverlays,
          alt:
            'The voxel bear from an angle with the arrows gone and a single ring left. The wide ' +
            'orange beak jutting from his hood is missing its near corner, and the ring marks ' +
            'that empty block, hanging at head height with a deep gap of clear air between it ' +
            'and his hoodie below.',
          caption: 'Three slices higher — and the same twenty-four-by-twenty-four grid.',
        },
      ],
      completion: {
        kind: 'event',
        type: 'builder.tile-painted',
        where: { tile: 3, layerId: 'z14' },
        atCell: { tx: 13, ty: 7 },
      },
    },
    {
      id: 'the-very-top',
      title: 'The very top',
      target: { kind: 'cell', tx: 12, ty: 13, z: 18 },
      // The checkpoint. The address is GIVEN and the SLICE is withheld —
      // the reverse of lesson 00's checkpoint, because the new skill is the
      // third number, not the first two. `noOverlays` strips the ring, and
      // the prose says so out loud, so the bare canvas reads as trust.
      onEnter: [isoView, noOverlays],
      instruction:
        'Paint the other half of the feather sprig **ink black** at `(12, 13)`, and work out ' +
        'the slice yourself this time — no ring, no arrows. It belongs on the highest slice ' +
        'there is, standing on top of Pip’s hood; the only other blocks up there are the tips ' +
        'of his ears.\n\n' +
        'Painted? Then you found `z = 18`, the ceiling of this figure. And look at what those ' +
        'numbers on the buttons really are: heights, not places in a list. The blocks of ' +
        '`z = 1` stand on the floor and reach one step up. The blocks of `z = 18` reach ' +
        'eighteen steps up. The floor they are all standing on is `z = 0`.\n\n' +
        'Which makes the flat portrait you finished in lesson 00 exactly one slice thick — a ' +
        'single slab of blocks resting on the floor, with room for seventeen more above it ' +
        'that nobody had built yet. Every cell you have ever painted had a third number. It ' +
        'was just always the same one.',
      hints: [
        'The slice you want is the one whose button says the biggest number — `z = 18`, the ' +
          'eighteenth slice button, not the `floor` button below it. Switch to it and the grid ' +
          'climbs to the very top of Pip, level with the tips of his ears — half the sprig is ' +
          'already sitting up there between them. Then ' +
          '**ink black** at `(12, 13)`. Painted on the wrong slice by mistake? Press `Ctrl+Z` ' +
          '(`Cmd+Z` on a Mac) and the old block comes straight back; Pip does not mind.',
        'It is `z = 18`. Keyboard: `Tab` to **ink black** in the palette and press `Enter` — ' +
          'picking a color picks the brush with it. Keep tabbing until the `z = 18` button in ' +
          'the **Layers** panel has focus and press `Enter`. `Tab` on to the canvas, walk the ' +
          'cell cursor with the **arrow keys** (hold `Shift` for 5-cell jumps) until the ' +
          'readout says `(12, 13)`, and press `Enter`.',
        'Is that block already black? Press `Ctrl+Z` (`Cmd+Z` on a Mac) — one undo takes back a ' +
          'whole brushstroke, so repaint any block that goes blank, and finish by painting this ' +
          'one yourself, on `z = 18`. The step is watching for your brushstroke.',
      ],
      figures: [
        {
          kind: 'scene',
          fixture: 'bear-figure-start',
          projection: 'iso',
          alt:
            'The voxel bear from an angle with no rings and no arrows this time — just Pip on ' +
            'his checkered floor, the top of his yellow hood carrying a single black block: ' +
            'half of the feather sprig, waiting for its other half between the tips of his ' +
            'ears.',
          caption: 'No ring this time. You know where the third number lives.',
        },
      ],
      completion: {
        kind: 'event',
        type: 'builder.tile-painted',
        where: { tile: 5, layerId: 'z18' },
        atCell: { tx: 12, ty: 13 },
      },
    },
    {
      id: 'pip-in-the-round',
      title: 'Pip in the round',
      target: { kind: 'anchor', anchor: 'toolbar.viewProfile' },
      // Gates on 'profile', so onEnter may set ISO — the view the student
      // is already in (a no-op on entry, a correcting effect on resume),
      // and an event this step's own gate ignores.
      onEnter: [isoView, noOverlays],
      instruction:
        'Pip is finished — press the **Profile** view button.\n\n' +
        'Before you do, look at what you have been looking at all lesson. This is the **Iso** ' +
        'view: the grid tipped up on your screen so that height has somewhere to go. It is the ' +
        'only reason eighteen flat slices look like a bear at all, instead of eighteen ' +
        'drawings in a pile.\n\n' +
        'Nothing you painted is going to move now. Not one block, not one number. The world is ' +
        'finished. From here on, the only thing that changes is where you stand to look at it.',
      hints: [
        'The three view buttons sit together in the toolbar. You want the one named **Profile** ' +
          '— the world swings edge-on, as if you had walked around to stand in front of Pip.',
        'Keyboard: press `Tab` until the **Profile** button in the toolbar has focus, then ' +
          'press `Enter`.',
      ],
      figures: [
        {
          kind: 'scene',
          fixture: 'bear-figure',
          projection: 'iso',
          alt:
            'The finished voxel Pip from an angle: a blocky sitting bear in a rounded yellow ' +
            'hood, a wide orange beak jutting out with the hood’s own black eyes beside it, ' +
            'Pip’s brown face with big black eyes and a white muzzle under the hood, brown ' +
            'arms, a white belly, wide feet with yellow pads, and a black feather sprig ' +
            'standing between his ear tips on the very top — all on a checkered floor.',
          caption: 'Finished — every block of him, and four of them yours.',
        },
      ],
      completion: {
        kind: 'event',
        type: 'builder.view-projection-changed',
        where: { to: 'profile' },
      },
    },
    {
      id: 'face-on',
      title: 'Face on',
      target: { kind: 'anchor', anchor: 'toolbar.viewTopdown' },
      // Gates on 'topdown', so onEnter sets PROFILE — again the view the
      // student arrives in, and an event ('to: profile') this gate ignores.
      onEnter: [{ kind: 'set-view-projection', projection: 'profile' }, noOverlays],
      instruction:
        'Press the **Top-down** view button — but look hard at Pip first.\n\n' +
        '**Profile** is the world seen edge-on, from the front. `x` runs across your screen, `z` ' +
        'runs up it, and `y` — how far back a block sits — is squashed to nothing, so the whole ' +
        'bear flattens into one honest picture of his front. You have seen that picture before. ' +
        'It is your portrait from lesson 00, pose for pose: the hood and its eyes, the beak, ' +
        'his ears, his eyes, the muzzle and nose you finished, the belly, the arms, the feet. ' +
        'He is bigger and blockier — but every part is where you left it.\n\n' +
        'That is the secret lesson 00 was keeping. Your flat drawing was never the opposite of a ' +
        'world with height in it. It was one picture OF one.',
      hints: [
        'Same row of view buttons in the toolbar: **Top-down**, the one that looks straight down ' +
          'at the world from overhead.',
        'Keyboard: press `Tab` until the **Top-down** button in the toolbar has focus, then ' +
          'press `Enter`.',
      ],
      // The one figure in this lesson drawn from another lesson's fixture,
      // and the best picture in it: the student is standing in Profile,
      // looking at voxel Pip's front elevation, while beside the prose sits
      // the flat portrait they painted a lesson ago. The caption claims
      // "pose for pose" and never block for block.
      figures: [
        {
          kind: 'scene',
          fixture: 'bear-portrait',
          projection: 'topdown',
          alt:
            'The flat pixel portrait from the first lesson, seen straight on: a small brown bear ' +
            'in a yellow chick hoodie with both eyes open, an orange beak, a cream muzzle, a ' +
            'black feather sprig on top of the hood and two yellow foot pads, sitting on a ' +
            'checkered studio floor.',
          caption:
            'Lesson 00’s portrait. Look at your screen — Profile is showing you the same bear, ' +
            'pose for pose.',
        },
      ],
      completion: {
        kind: 'event',
        type: 'builder.view-projection-changed',
        where: { to: 'topdown' },
      },
    },
    {
      id: 'three-pictures-one-pip',
      title: 'Three pictures, one Pip',
      target: { kind: 'anchor', anchor: 'toolbar.viewIso' },
      // Lesson 00's finale pattern exactly: this step gates on 'iso', so
      // onEnter sets TOP-DOWN — it cannot emit the awaited event, and it
      // closes the one stuck state the step could have (a student already
      // in iso, for whom pressing Iso changes nothing and emits nothing).
      onEnter: [{ kind: 'set-view-projection', projection: 'topdown' }, noOverlays],
      instruction:
        'Press the **Iso** view button one last time and put Pip back in the round.\n\n' +
        '**Top-down** is the photograph from straight overhead: `x` across, `y` up the screen, ' +
        'and this time `z` is the number squashed flat. It shows you the top of his hood with ' +
        'the sprig you finished, his two big ears, his arms hugging round the sides — and at ' +
        'the front, the whole top of his beak with a sliver of white belly either side, and ' +
        'the tips of both feet below. His face has vanished completely: from up here the hood ' +
        'is a lid. And yet the pad you started on and the sprig you finished — seventeen ' +
        'slices apart — sit together in this one flat picture. Nothing has gone missing from ' +
        'the world; this picture simply has no room for height.\n\n' +
        'Three buttons, three honest pictures, one Pip. The world is a list of blocks with three ' +
        'numbers each, and a view is a small machine of numbers — a **matrix** — that decides ' +
        'where those numbers land on your screen. Change the machine and the picture changes. ' +
        'Change nothing else.\n\n' +
        'There is a whole arc of lessons waiting on that idea. You just built the bear they are ' +
        'taught on.',
      hints: [
        'One more button in the toolbar: **Iso**. You are in top-down right now, so pressing it ' +
          'is a real switch — Pip stands back up into blocks.',
        'Keyboard: press `Tab` until the **Iso** button in the toolbar has focus, then press ' +
          '`Enter`.',
      ],
      figures: [
        {
          kind: 'scene',
          fixture: 'bear-figure',
          projection: 'profile',
          alt:
            'The finished voxel Pip seen edge-on from the front: a flat, tidy picture of the ' +
            'same bear — the yellow hood with its black eye dots and wide orange beak, brown ' +
            'ear tips with the sprig standing level between them, Pip’s own black eyes, his white muzzle and finished ' +
            'nose, a yellow collar, white belly, brown arms, and yellow foot pads along the ' +
            'bottom.',
          caption: 'Where you were a moment ago: x across, z up, and y squashed to nothing.',
        },
      ],
      completion: {
        kind: 'event',
        type: 'builder.view-projection-changed',
        where: { to: 'iso' },
      },
    },
  ],
}
