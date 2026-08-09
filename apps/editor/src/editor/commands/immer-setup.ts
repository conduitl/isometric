/*
 * Immer, configured once for the whole command substrate: patches ON,
 * auto-freeze OFF. Every module in commands/ imports this file for its side
 * effect, so no matter which module loads first, Immer is already configured
 * by the time any command runs.
 *
 * ## Why patches on
 *
 * History does not store document snapshots — it stores forward/inverse
 * patch PAIRS per command (docs/ARCHITECTURE.md §6). Patch generation is an
 * opt-in Immer feature, hence the one-time `enablePatches()` call.
 *
 * ## Why auto-freeze must be OFF — a contract, not a preference
 *
 * Immer's default is to deep-freeze every state it produces, which is
 * normally a nice tripwire against accidental mutation. Here it would be
 * actively wrong, for two reasons:
 *
 * 1. **The document deliberately shares its `layers` array.** Entity- and
 *    settings-scale commands never touch tiles, so Immer's structural
 *    sharing carries the SAME `layers` array (and the same Uint16Array cells
 *    inside each layer) into every produced document. Tile painting then
 *    mutates those cells in place — that is the whole point of the split
 *    undo substrate: the paint-feel hot path never pays Immer's large-array
 *    worst case. Freezing any produced document would freeze the shared
 *    layer objects too, and the next brush stroke would throw.
 *
 * 2. **Uint16Array cells cannot be frozen at all.** `Object.freeze` on a
 *    typed array WITH ELEMENTS throws a TypeError outright ("Cannot freeze
 *    array buffer views with elements") — the elements live in an
 *    ArrayBuffer that freezing cannot reach. Auto-freeze walking into a
 *    non-empty layer would crash before any policy question even arises.
 *
 * ## Why turning it off is safe
 *
 * The tripwire auto-freeze provides is already provided — better — by the
 * architecture. The document changes through exactly two doors: dispatched
 * commands (which go through `produce`, so casual mutation of a produced
 * state is never how code around here is written) and the tile-stroke path,
 * which does its own invalidation bookkeeping (setCell's revision/dirty
 * records plus the host's `tilesTouched` notification). Nothing else writes
 * the document, and the fuzz gate (test/fuzz.test.ts) compares the live
 * document against a command-log replay oracle precisely to catch any
 * mutation that sneaks around those doors.
 *
 * `applyPatches` (undo/redo) respects the same setting, so undone documents
 * stay unfrozen too. Both calls are idempotent — importing this module any
 * number of times configures Immer exactly once, harmlessly.
 */

import { enablePatches, setAutoFreeze } from 'immer'

enablePatches()
setAutoFreeze(false)
