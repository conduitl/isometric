/**
 * Persistence — the thin glue between the session and @engine/world-format's
 * two-slot save ceremony.
 *
 * Deliberately thin: the ceremony (write tmp → prove → promote → prove
 * again), the rescue ladder (base → backup → stranded tmp), and every
 * student-language diagnosis already live in the world-format package, and
 * re-implementing any of it here would fork the one invariant that matters
 * ("a complete, parseable save always exists"). This module only composes
 * those exports, shapes their answers into the contract types of ./types,
 * and adds the one sentence of editor voice the package cannot know — "your
 * world was brought back from a backup" — always built AROUND the LoadError's
 * own student text, never replacing it and never leaking anything raw.
 *
 * The single exception to "compose, don't reach in" is restoreBackupDoc's
 * direct read of the '<base>.backup' key, explained on the function itself.
 */

import type { World } from '@engine/core'
import { loadFromSlots, parseWorld, saveToSlots, serializeWorld } from '@engine/world-format'
import type { SlotStorage } from '@engine/world-format'
import { SAVE_BASE_KEY } from './types'
import type { SaveOutcome } from './types'

/**
 * Save the document under the editor's base key via the atomic two-slot
 * ceremony. The package's failure messages are already written for the
 * person saving, so they pass through untouched.
 */
export function saveDoc(storage: SlotStorage, doc: World): SaveOutcome {
  return saveToSlots(storage, SAVE_BASE_KEY, doc)
}

/** What booting the editor's storage found. `message` is student-language
 * context for the status bar: why a backup was used, or why nothing loaded —
 * null when there is simply nothing to explain. */
export interface BootResult {
  readonly world: World | null
  readonly usedBackup: boolean
  readonly message: string | null
}

/**
 * Load the good save, walking the package's rescue ladder (base, then
 * backup, then a save stranded mid-promotion). Four honest outcomes:
 *
 * - base loaded cleanly → no message, nothing to say;
 * - a fallback slot rescued the world → a "brought back" sentence, carrying
 *   the LoadError's own diagnosis of the copy that failed when there is one;
 * - nothing loadable but an error to show → the error's student text, as-is;
 * - empty storage → all nulls: a first run, not a problem.
 */
export function bootDoc(storage: SlotStorage): BootResult {
  const result = loadFromSlots(storage, SAVE_BASE_KEY)

  if (result.world !== null) {
    if (!result.usedBackup) return { world: result.world, usedBackup: false, message: null }
    return {
      world: result.world,
      usedBackup: true,
      message:
        result.error === undefined
          ? 'Your world was brought back from a backup copy — the newest save was missing.'
          : `Your world was brought back from a backup copy. The newest save couldn't be opened: ${result.error.message}`,
    }
  }

  return {
    world: null,
    usedBackup: false,
    message: result.error === undefined ? null : result.error.message,
  }
}

/** What "restore backup" answered: the previous good save (plus the
 * LoadOutcome shape the session mirrors), or a student-language refusal. */
export type RestoreResult =
  | { readonly ok: true; readonly usedBackup: true; readonly world: World }
  | { readonly ok: false; readonly message: string }

/**
 * Read and parse the '<base>.backup' slot — the previous good save — WITHOUT
 * touching the current base slot. Restoring is a read: whether the restored
 * world ever overwrites the base is the session's decision (via an ordinary
 * save), never a side effect of looking.
 *
 * Why a direct storage read instead of a package call: the slots package
 * exposes no single-slot read — loadFromSlots always prefers the base copy,
 * but "restore backup" means the BACKUP even when the base is perfectly
 * healthy. So this is the one place the editor spells a slot key itself,
 * using the exact suffix convention slots.ts uses ('<base>.backup'), and the
 * rung is re-parsed before being trusted, same as every rung of the
 * package's own ladder.
 */
export function restoreBackupDoc(storage: SlotStorage): RestoreResult {
  let text: string | null = null
  try {
    text = storage.read(`${SAVE_BASE_KEY}.backup`)
  } catch {
    text = null
  }
  if (text === null) {
    return {
      ok: false,
      message:
        "There's no backup copy to restore yet — a backup appears once your world has been saved more than once.",
    }
  }

  const result = parseWorld(text)
  if (!result.ok) return { ok: false, message: result.error.message }
  return { ok: true, usedBackup: true, world: result.world }
}

/**
 * Parse pasted/imported world text. On failure the message is the parser's
 * own student-language diagnosis — the defensive ladder's whole job is that
 * this string is safe to show a ten-year-old verbatim.
 */
export function importDoc(text: string): { world: World } | { message: string } {
  const result = parseWorld(text)
  return result.ok ? { world: result.world } : { message: result.error.message }
}

/** The document as canonical file text — same world, same bytes, forever. */
export function exportDoc(doc: World): string {
  return serializeWorld(doc)
}
