/**
 * Lesson 03 — "Three views": the perspective-switch reveal, on a fixture.
 *
 * The flagship showcase (ROADMAP Phase 3): the student flips one world
 * through all three view lenses and discovers that NOTHING in the world
 * changes — only the matrix between the world and their screen
 * (ARCHITECTURE §4's curated X-ray lens). It runs on the 'showcase-island'
 * fixture — an island with a raised stone plateau, a player, crates, and a
 * tree — because the reveal needs HEIGHT to hide and then show: top-down
 * flattens the plateau to a colored patch, iso gives it walls, profile
 * turns it into a skyline.
 *
 * ## Design constraints, deliberately visible
 *
 * - **Every step gates on `builder.view-projection-changed`.** View-only:
 *   the lesson asks the student to change nothing, only to LOOK. This also
 *   makes the lesson fixture-resilient by construction — if a host cannot
 *   load 'showcase-island' (loadFixture returns false, and the lesson runs
 *   on the current world), every step still completes, because no step
 *   depends on a fact about island terrain. The replay corpus pins that
 *   resilience.
 * - **Each middle step re-declares its view in onEnter**, so reset() puts
 *   the student back in the picture the prose describes. None of those
 *   effects can complete the step that owns it: entering a step via its
 *   event means the view is ALREADY what onEnter sets (a no-op for the
 *   editor, which emits only on real changes), and a resume-time change
 *   emits a `to` that never matches the same step's `where`.
 * - **The wrap step has NO onEnter and gates on any view change** — an
 *   onEnter view effect there could emit the very event the step waits
 *   for and complete it before the student read a word.
 * - **There is deliberately NO save step.** The fixture REPLACED the
 *   student's document for the duration of this lesson; asking them to
 *   save here would write the island over their own world slot. The lesson
 *   ends on the last view switch instead. (Fixture-lesson save semantics
 *   are a host problem — see the Phase 3 orchestration notes — and until a
 *   fixture lesson can save somewhere safe, no fixture lesson may ask.)
 *   For the same reason the prose promises nothing about how the student's
 *   own world comes back afterwards — that is the host's story to tell.
 */

import type { Lesson } from './types'

/** Arc 3 of the curriculum: one world, three matrices — view-only, on the
 * 'showcase-island' fixture. */
export const lesson03: Lesson = {
  id: 'three-views',
  title: 'Three views of one world',
  arc: 'perspectives',
  fixture: 'showcase-island',
  steps: [
    {
      id: 'the-map-view',
      title: 'The map view',
      // Open in top-down regardless of the fixture's authored projection —
      // the prose below describes squares and a hidden height, so the step
      // must guarantee that picture. ('topdown' can never satisfy this
      // step's own gate, which waits for 'iso'.)
      onEnter: [{ kind: 'set-view-projection', projection: 'topdown' }],
      instruction:
        'Welcome to a little island we made for you — look around. You are in **top-down** ' +
        'view: north is up, every cell is a square, and every address works like graph paper. ' +
        'But something is hiding. The stone plateau in the middle is TALL — and from straight ' +
        'above, you cannot tell.\n\n' +
        'Press the **Iso** view button, and keep your eye on the squares.',
      hints: [
        'The three view buttons sit together in the toolbar. You want the one named **Iso**.',
        'No mouse needed: press `Tab` until the **Iso** button in the toolbar has focus, ' +
          'then press `Enter`.',
      ],
      target: { kind: 'anchor', anchor: 'toolbar.viewIso' },
      completion: { kind: 'event', type: 'builder.view-projection-changed', where: { to: 'iso' } },
    },
    {
      id: 'the-diamond-view',
      title: 'Squares into diamonds',
      onEnter: [{ kind: 'set-view-projection', projection: 'iso' }],
      // The live editor is showing iso (onEnter above); the figure holds the
      // view the student just LEFT, drawn by the engine through the same
      // fixture — so the "nothing in the world changed" claim can be checked
      // by eye, square against diamond, without flipping back.
      figures: [
        {
          kind: 'scene',
          fixture: 'showcase-island',
          projection: 'topdown',
          alt:
            'The same island seen from straight above: water rings sand rings grass, and the ' +
            'stone plateau is a flat colored patch — no walls, no visible height.',
          caption:
            'Where you just came from: the very same island through the top-down matrix. ' +
            'Same cells, same addresses — compare the plateau.',
        },
      ],
      instruction:
        'Every square became a diamond — and the plateau grew walls. Here is the secret: ' +
        '**nothing in the world changed.** Not one cell, not one crate. What changed is the ' +
        '**matrix** — a small machine of numbers that decides where each world point lands on ' +
        'your screen. The iso matrix tips the map into diamonds and gives height somewhere ' +
        'to go. Same world, different lens.\n\n' +
        'Now press the **Profile** view button.',
      hints: [
        'Same row of view buttons in the toolbar — the one named **Profile**. The world will ' +
          'turn edge-on, like looking at the horizon.',
        'Keyboard: press `Tab` until the **Profile** button in the toolbar has focus, then ' +
          'press `Enter`.',
      ],
      target: { kind: 'anchor', anchor: 'toolbar.viewProfile' },
      completion: { kind: 'event', type: 'builder.view-projection-changed', where: { to: 'profile' } },
    },
    {
      id: 'the-edge-on-view',
      title: 'Edge-on',
      onEnter: [{ kind: 'set-view-projection', projection: 'profile' }],
      instruction:
        'Now the world is **edge-on** — you are looking from the side, and height is nearly all ' +
        'you can see. The plateau finally LOOKS tall; the island is a skyline. A third matrix, ' +
        'a third honest picture of the very same world.\n\n' +
        'Press the **Top-down** view button to come back around.',
      hints: [
        'One more button in the toolbar: **Top-down**, next to the other two views.',
        'Keyboard: press `Tab` until the **Top-down** button in the toolbar has focus, then ' +
          'press `Enter`.',
      ],
      target: { kind: 'anchor', anchor: 'toolbar.viewTopdown' },
      completion: { kind: 'event', type: 'builder.view-projection-changed', where: { to: 'topdown' } },
    },
    {
      // No onEnter here on purpose: this step completes on ANY view switch,
      // and an onEnter view effect could fire that very event during entry.
      id: 'three-pictures-one-world',
      title: 'Three pictures, one world',
      instruction:
        'Three pictures, one world, three matrices. Every game view you have ever seen works ' +
        'exactly this way: the same world, pushed through a different matrix onto the screen. ' +
        'Flip between the views until that feels normal — this island does not mind.\n\n' +
        'One day, in the **Engineer** tier, you will EDIT those matrices yourself and watch the ' +
        'world shear and tip live. For now: one more flip — **Iso** or **Profile**, ' +
        'builder’s choice — and the lesson is yours.',
      hints: [
        'You are in top-down right now, so pressing **Top-down** changes nothing — pick ' +
          '**Iso** or **Profile** and the switch finishes the step.',
        'Keyboard: press `Tab` to the **Iso** or **Profile** button in the toolbar, then ' +
          'press `Enter`.',
      ],
      completion: { kind: 'event', type: 'builder.view-projection-changed' },
    },
  ],
}
