/**
 * @engine/world-format — the declared one-way door (docs/DECISIONS.md D1).
 *
 * World files outlive every library choice this project will ever make:
 * a world saved in a 2026 classroom must open in 2036. So this package gets
 * the most conservative treatment in the system —
 *
 * - a minimal, human-readable JSON format with a CANONICAL writer
 *   (serialize.ts): same world, same bytes, forever;
 * - a defensive reader (parse.ts) that expects truncated, hand-edited, and
 *   mid-write-corrupted files, and answers every one with a diagnosis a
 *   ten-year-old can act on — never a TypeError, never raw validator prose;
 * - an ordered chain of pure migrations, appended to and never edited, so
 *   old files climb to the current version one step at a time;
 * - a salvage mode that rescues every readable entity and layer from a file
 *   too broken to load, and reports the losses in student language;
 * - atomic two-slot saves (slots.ts): the previous good save survives every
 *   failure path, provably.
 *
 * Zod is quarantined inside this package (docs/DECISIONS.md R5): nothing
 * exported below mentions a Zod type, so the validator stays swappable.
 */

export { FORMAT_VERSION } from './schema'
export { serializeWorld } from './serialize'
export { migrations, parseWorld, salvageWorld } from './parse'
export type { LoadError, LoadResult } from './parse'
export { createLocalStorageSlots, loadFromSlots, saveToSlots } from './slots'
export type { SlotStorage } from './slots'
