/**
 * Lesson 01 — "First tiles": the coordinate grid, taught by living in it.
 *
 * The arc is do-then-explain (ARCHITECTURE §9): every step asks for the
 * action FIRST and names the idea after the student has already done it.
 * Paint a cell, then hear that cells have addresses; find (12, 4), then hear
 * that reading an address is the skill; place and move a crate, then hear
 * that movement is just the two numbers changing; save, then hear that the
 * world is theirs to keep. Nothing dead-ends: every completion is an event
 * or a world fact, so wrong tries cost nothing and undo never breaks a step.
 *
 * Starter-world facts this lesson leans on (apps/editor/src/editor/types.ts,
 * StarterWorld contract): a 32×24 ground layer, and a terrain tileset whose
 * palette order is grass, water, sand, stone, path — so water is cell
 * value 2 (cell values are 1-based; 0 is empty).
 */

import type { LessonDraft } from './types'

/** The first lesson a brand-new builder meets. */
export const lesson01: LessonDraft = {
  id: 'first-tiles',
  title: 'First tiles',
  steps: [
    {
      id: 'paint-a-tile',
      title: 'Paint a tile',
      instruction:
        'Pick the **brush**, choose any tile you like, and paint one square of the world.\n\n' +
        'Each square is called a **cell**, and every cell has an address made of two numbers, ' +
        'written like `(x, y)`. Move your pointer around and watch the numbers at the bottom ' +
        'of the screen — they follow you from cell to cell.',
      hint:
        'The brush is in the toolbar. Click it, pick a tile from the palette, ' +
        'then click any square on the map. Any tile, any square — this one is a freebie.',
      completion: { kind: 'event', type: 'builder.tile-painted' },
    },
    {
      id: 'find-the-address',
      title: 'Find the address (12, 4)',
      instruction:
        'Now paint **water** on one exact cell: the one at `(12, 4)`.\n\n' +
        'Reading an address is the trick: the first number is `x`, how far east (across); ' +
        'the second is `y`, how far north (up the map) — exactly like the y-axis on a ' +
        'math-class graph. Every map and every graph you will ever meet uses this same idea.',
      hint:
        'Pick the water tile, then move slowly and watch the numbers at the bottom of ' +
        'the screen — they show the address of the cell you are on. When they say `(12, 4)`, click. ' +
        'Painted the wrong cell? No problem — paint over it or undo, nothing is ruined.',
      // (12, 4) is deliberately OUTSIDE the starter pond (tx 5–8, ty 4–6)
      // and its sand rim: a pre-satisfied target would skip this step the
      // moment step 1 completes — a student would never read an address.
      // (Caught by the Phase 2 e2e gate; keep this cell grass in starter.ts.)
      completion: { kind: 'tile-at', tx: 12, ty: 4, tile: 2, layerId: 'ground' },
    },
    {
      id: 'place-a-crate',
      title: 'Place a crate',
      instruction:
        'Switch to the **placer**, choose the **crate**, and put one anywhere you like.\n\n' +
        'A crate is not ground — it is a thing that sits ON the world, like your player. ' +
        'Things like this are called **entities**, and each one has an address too.',
      hint:
        'Choose `crate` under **Things** — picking it switches you to the ' +
        'placer automatically — then click a spot on the map.',
      completion: { kind: 'entity-exists', marker: 'crate' },
    },
    {
      id: 'move-your-crate',
      title: 'Move your crate',
      instruction:
        'Use the **select** tool to grab your crate and drag it somewhere new.\n\n' +
        'When you let go, the crate has a new address. That is all moving ever is — ' +
        'the two numbers changing. Even the biggest games move things exactly this way.',
      hint:
        'Pick the select tool, press down on the crate, drag, and let go. ' +
        'Changed your mind mid-drag? Press `Esc` and the crate snaps right back.',
      completion: { kind: 'event', type: 'builder.entity-moved' },
    },
    {
      id: 'save-your-world',
      title: 'Save your world',
      instruction:
        'Press **Save**.\n\n' +
        'A saved world is yours to keep. Close everything, come back tomorrow, and it ' +
        'will still be here — every cell and every entity exactly where you left them.',
      hint:
        'The Save button is in the toolbar. The editor also keeps a backup of your ' +
        'last save, so even a mishap cannot take your world away.',
      completion: { kind: 'event', type: 'builder.world-saved' },
    },
  ],
}
