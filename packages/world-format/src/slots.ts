/*
 * Never lose a kid's world — the atomic two-slot save.
 *
 * The nightmare this file prevents: a save starts writing over the only good
 * copy, the Chromebook lid closes halfway through, and the world that took
 * three lessons to build is gone. The cure is an old, honorable trick —
 * never overwrite your only good copy. Every save is a little ceremony over
 * three storage slots (docs/ARCHITECTURE.md §7):
 *
 *   '<base>.tmp'    — the landing pad. The new save is written HERE first.
 *   '<base>'        — the good copy. Only ever replaced by a PROVEN save.
 *   '<base>.backup' — the previous good copy, kept as "restore backup".
 *
 * The ceremony:
 *
 *   1. Serialize the world (canonically — same world, same bytes).
 *   2. Write the text to '<base>.tmp'.
 *   3. Read '<base>.tmp' back and RE-PARSE it. Not re-parse the string we
 *      still hold in memory — re-parse what the storage actually kept.
 *      Storage that ran out of quota mid-write fails right here, loudly,
 *      while the good copy is still untouched.
 *   4. Only after that proof, the promotion — hardened guard by guard:
 *      a. Demote the current '<base>' to '<base>.backup' ONLY IF IT STILL
 *         PARSES. A base that rotted since its own save (bit-flip, another
 *         tab, a sync gone wrong) must never clobber the last good backup —
 *         copying it blindly would trade a real save for a broken one.
 *      b. Write the verified text to '<base>'.
 *      c. Read '<base>' BACK and re-parse it. Storage can lie twice: a
 *         write that silently truncates would otherwise leave a torn base
 *         and a clean conscience. If the promoted copy didn't stick, the
 *         save FAILS — and '<base>.tmp' is deliberately KEPT, because right
 *         now it may hold the only complete copy of this save.
 *      d. Only after that second proof: remove '<base>.tmp'.
 *
 * Trace any crash or hostile failure through those steps and one invariant
 * holds at every line: A COMPLETE, PARSEABLE SAVE ALWAYS EXISTS — in
 * '<base>', in '<base>.backup', or (when the promotion itself is what
 * failed) stranded in '<base>.tmp'. loadFromSlots walks exactly that
 * ladder, re-parsing every rung before trusting it.
 *
 * SlotStorage is deliberately tiny (read/write/remove strings by key) so
 * tests can hand in hostile implementations that lie, truncate, and throw —
 * and so the same ceremony runs against localStorage today and anything
 * else tomorrow.
 */

import type { World } from '@engine/core'
import { parseWorld } from './parse'
import type { LoadError } from './parse'
import { serializeWorld } from './serialize'

/**
 * The minimal storage a save needs: strings in, strings out, by key.
 * `read` returns null for a missing key. Any method may throw (storage full,
 * permission lost) — the save ceremony treats every throw as "this slot
 * cannot be trusted" and leaves the good copy alone.
 */
export interface SlotStorage {
  read(key: string): string | null
  write(key: string, value: string): void
  remove(key: string): void
}

const tmpKey = (baseKey: string): string => `${baseKey}.tmp`
const backupKey = (baseKey: string): string => `${baseKey}.backup`

/**
 * Saves a world using the two-slot ceremony described in the file header.
 * On failure the returned message is written for the person saving —
 * and the previous good save is guaranteed untouched.
 */
export function saveToSlots(
  storage: SlotStorage,
  baseKey: string,
  world: World,
): { ok: true } | { ok: false; message: string } {
  let text: string
  try {
    text = serializeWorld(world)
  } catch {
    return {
      ok: false,
      message: "This world couldn't be written down as a file — nothing was saved, and your last good save is untouched.",
    }
  }

  // Step 2: the landing pad. A failure here costs nothing but the attempt.
  try {
    storage.write(tmpKey(baseKey), text)
  } catch {
    removeQuietly(storage, tmpKey(baseKey))
    return {
      ok: false,
      message:
        "The browser wouldn't store the save (it may be out of space). " +
        'Nothing was overwritten — your last good save is untouched.',
    }
  }

  // Step 3: the proof. Trust what the storage KEPT, not what we sent it.
  let readBack: string | null = null
  try {
    readBack = storage.read(tmpKey(baseKey))
  } catch {
    readBack = null
  }
  if (readBack === null || !parseWorld(readBack).ok) {
    removeQuietly(storage, tmpKey(baseKey))
    return {
      ok: false,
      message:
        "The save didn't store correctly, so it was thrown away — your last good save is untouched. " +
        'Try saving again, or free up some space first.',
    }
  }

  // Step 4a–4b: the promotion. The verified bytes (readBack — exactly what
  // the storage holds, not our in-memory copy) become the good save; the old
  // good save steps down to backup — but ONLY if it still parses. A corrupt
  // base copied over the backup would destroy the one remaining good copy,
  // and a failure later in this very save would then leave NOTHING loadable.
  // If anything throws mid-promotion, tmp is deliberately kept: it holds the
  // verified new save, and loadFromSlots knows to rescue it.
  try {
    const current = storage.read(baseKey)
    if (current !== null && parseWorld(current).ok) {
      storage.write(backupKey(baseKey), current)
    }
    storage.write(baseKey, readBack)
  } catch {
    return {
      ok: false,
      message:
        'Saving was interrupted partway through. Your previous save is kept safe — ' +
        'if the world won\'t open, "restore backup" will bring it back.',
    }
  }

  // Step 4c: the second proof. A storage can accept the promoted write and
  // silently keep only part of it — quota edges do exactly this. Re-read the
  // base and re-parse; if the copy didn't stick, fail the save and KEEP tmp,
  // which right now may hold the only complete copy of this save.
  let promoted: string | null = null
  try {
    promoted = storage.read(baseKey)
  } catch {
    promoted = null
  }
  if (promoted === null || !parseWorld(promoted).ok) {
    return {
      ok: false,
      message:
        "The save didn't stick — the storage kept a damaged copy of it. Your previous save is safe, " +
        'and this new save was set aside so it can be rescued next time the world loads.',
    }
  }

  // Step 4d: only now, with the promoted copy proven, is tmp expendable.
  removeQuietly(storage, tmpKey(baseKey))
  return { ok: true }
}

/**
 * Loads the good save, walking the rescue ladder when the good copy is
 * missing or damaged: '<base>' first, then '<base>.backup', then — as the
 * last resort — '<base>.tmp', where a save whose promotion failed may be
 * stranded (see step 4c in the file header). Every rung is RE-PARSED before
 * being trusted; a slot's history earns it a place in line, never a free
 * pass. `usedBackup: true` is the UI's cue to tell the player their world
 * was rescued from a fallback slot (the backup, or a stranded save);
 * `error` (when present) explains what was wrong with the copy that failed.
 */
export function loadFromSlots(
  storage: SlotStorage,
  baseKey: string,
): { world: World | null; usedBackup: boolean; error?: LoadError } {
  let firstError: LoadError | undefined

  let baseText: string | null = null
  try {
    baseText = storage.read(baseKey)
  } catch {
    baseText = null
  }
  if (baseText !== null) {
    const result = parseWorld(baseText)
    if (result.ok) return { world: result.world, usedBackup: false }
    firstError = result.error
  }

  let backupText: string | null = null
  try {
    backupText = storage.read(backupKey(baseKey))
  } catch {
    backupText = null
  }
  if (backupText !== null) {
    const result = parseWorld(backupText)
    if (result.ok) {
      return firstError === undefined
        ? { world: result.world, usedBackup: true }
        : { world: result.world, usedBackup: true, error: firstError }
    }
    if (firstError === undefined) firstError = result.error
  }

  // Last resort: a verified save whose promotion failed is stranded on the
  // landing pad. tmp was re-parsed once, at save time — but storage may have
  // damaged it since, so it is re-parsed AGAIN here before being trusted.
  let tmpText: string | null = null
  try {
    tmpText = storage.read(tmpKey(baseKey))
  } catch {
    tmpText = null
  }
  if (tmpText !== null) {
    const result = parseWorld(tmpText)
    if (result.ok) {
      return firstError === undefined
        ? { world: result.world, usedBackup: true }
        : { world: result.world, usedBackup: true, error: firstError }
    }
    if (firstError === undefined) firstError = result.error
  }

  // Nothing loadable. No error at all simply means nothing was saved yet.
  return firstError === undefined
    ? { world: null, usedBackup: false }
    : { world: null, usedBackup: false, error: firstError }
}

function removeQuietly(storage: SlotStorage, key: string): void {
  try {
    storage.remove(key)
  } catch {
    // A stale tmp slot is harmless — the ceremony never reads it without
    // re-verifying, and the next save overwrites it.
  }
}

// ---------------------------------------------------------------------------
// The browser implementation
// ---------------------------------------------------------------------------

// Only the three methods the ceremony needs — declared locally so this
// module never depends on DOM typings being loaded, and never touches
// globals at import time (node imports this package for tests and tools).
interface WebStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * A SlotStorage backed by the browser's localStorage, with every key
 * prefixed (default 'world:') so saves never collide with anything else the
 * app keeps there. localStorage is looked up at CALL time, not import time —
 * importing this module in node is fine; only using it there throws, with an
 * error that says so plainly.
 */
export function createLocalStorageSlots(prefix = 'world:'): SlotStorage {
  const store = (): WebStorageLike => {
    const candidate = (globalThis as { localStorage?: WebStorageLike }).localStorage
    if (candidate === undefined) {
      throw new Error('localStorage is not available here — this slot storage only works in a browser')
    }
    return candidate
  }
  return {
    read(key: string): string | null {
      return store().getItem(prefix + key)
    },
    write(key: string, value: string): void {
      store().setItem(prefix + key, value)
    },
    remove(key: string): void {
      store().removeItem(prefix + key)
    },
  }
}
