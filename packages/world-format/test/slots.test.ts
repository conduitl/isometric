/*
 * Two-slot save tests: the invariant under attack.
 *
 * The claim in slots.ts is strong — "a complete, parseable save always
 * exists" — so these tests attack it with hostile SlotStorage
 * implementations that truncate every write (loudly or silently), throw
 * mid-ceremony, tear the good copy during promotion, and rot the base
 * between saves. In every case a complete save must still load — directly,
 * from the backup slot, or rescued from a tmp slot the ceremony kept.
 */

import type { World } from '@engine/core'
import { describe, expect, it } from 'vitest'
import {
  createLocalStorageSlots,
  loadFromSlots,
  parseWorld,
  saveToSlots,
  serializeWorld,
} from '../src/index'
import type { SlotStorage } from '../src/index'

/** An honest in-memory SlotStorage, plus its backing map for inspection. */
function memoryStorage(): { map: Map<string, string>; storage: SlotStorage } {
  const map = new Map<string, string>()
  return {
    map,
    storage: {
      read: (key) => map.get(key) ?? null,
      write: (key, value) => {
        map.set(key, value)
      },
      remove: (key) => {
        map.delete(key)
      },
    },
  }
}

/** A tiny valid world whose name marks which save generation it is. */
function slotWorld(name: string): World {
  return {
    meta: { worldId: 'w42', name },
    settings: { tileSize: 1, primaryProjection: 'topdown', fixedDt: 1 / 60, seed: 42 },
    nextEntityId: 2,
    entities: { e1: { id: 'e1', name: 'saver', components: { position: { x: 0, y: 0 } } } },
    tilesets: [],
    layers: [],
  }
}

const FRIENDLY = /untouched|kept|safe|backup/i
const JARGON = /TypeError|Error:|undefined|exception|stack/i

describe('the happy path', () => {
  it('first save: base written, tmp cleaned up, no backup yet, loads back', () => {
    const { map, storage } = memoryStorage()
    const world = slotWorld('v1')

    expect(saveToSlots(storage, 'slot', world).ok).toBe(true)
    expect(map.get('slot')).toBe(serializeWorld(world))
    expect(map.has('slot.tmp')).toBe(false)
    expect(map.has('slot.backup')).toBe(false)

    const load = loadFromSlots(storage, 'slot')
    expect(load.usedBackup).toBe(false)
    expect(load.error).toBeUndefined()
    expect(load.world?.meta.name).toBe('v1')
  })

  it('second save: the previous good save steps down to backup', () => {
    const { map, storage } = memoryStorage()
    const v1 = slotWorld('v1')
    const v2 = slotWorld('v2')

    expect(saveToSlots(storage, 'slot', v1).ok).toBe(true)
    expect(saveToSlots(storage, 'slot', v2).ok).toBe(true)

    expect(map.get('slot')).toBe(serializeWorld(v2))
    expect(map.get('slot.backup')).toBe(serializeWorld(v1))
    expect(map.has('slot.tmp')).toBe(false)
  })
})

describe('hostile storage cannot hurt the last good save', () => {
  it('a storage that truncates every write fails the re-parse check and changes nothing', () => {
    const { map, storage } = memoryStorage()
    const v1 = slotWorld('v1')
    expect(saveToSlots(storage, 'slot', v1).ok).toBe(true)

    const corrupting: SlotStorage = {
      read: storage.read,
      write: (key, value) => {
        map.set(key, value.slice(0, Math.floor(value.length / 3)))
      },
      remove: storage.remove,
    }

    const result = saveToSlots(corrupting, 'slot', slotWorld('v2'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(FRIENDLY)
      expect(result.message).not.toMatch(JARGON)
    }
    expect(map.get('slot')).toBe(serializeWorld(v1)) // byte-for-byte untouched
    expect(map.has('slot.tmp')).toBe(false) // the failed landing was cleaned up
  })

  it('a storage that throws on write leaves every slot exactly as it was', () => {
    const { map, storage } = memoryStorage()
    expect(saveToSlots(storage, 'slot', slotWorld('v1')).ok).toBe(true)
    const snapshot = new Map(map)

    const throwing: SlotStorage = {
      read: storage.read,
      write: () => {
        throw new Error('quota exceeded')
      },
      remove: storage.remove,
    }

    const result = saveToSlots(throwing, 'slot', slotWorld('v2'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(FRIENDLY)
    expect([...map.entries()]).toEqual([...snapshot.entries()])
  })

  it('a corrupt base is never demoted into the backup slot — the old backup survives the save', () => {
    const { map, storage } = memoryStorage()
    const v1 = slotWorld('v1')
    const v2 = slotWorld('v2')
    expect(saveToSlots(storage, 'slot', v1).ok).toBe(true)
    expect(saveToSlots(storage, 'slot', v2).ok).toBe(true) // base=v2, backup=v1

    // The base rots on its own (bit-flip, another tab, a sync gone wrong)…
    map.set('slot', '{ "formatVersion": 1, "meta": { torn mid')

    // …and the NEXT save must not copy that wreckage over the good backup.
    expect(saveToSlots(storage, 'slot', slotWorld('v3')).ok).toBe(true)
    expect(map.get('slot')).toBe(serializeWorld(slotWorld('v3')))
    expect(map.get('slot.backup')).toBe(serializeWorld(v1)) // v1, intact — not the corrupt bytes
  })

  it('a base write that silently truncates fails the save (base re-verify) and keeps tmp', () => {
    const { map, storage } = memoryStorage()
    const v1 = slotWorld('v1')
    expect(saveToSlots(storage, 'slot', v1).ok).toBe(true)

    // Writes to the base slot keep only a prefix and report success — the
    // quota-edge lie. Every other slot behaves normally, so the tmp proof
    // (step 3) passes and only the base re-verify (step 4c) can catch it.
    const silentlyTruncating: SlotStorage = {
      read: storage.read,
      write: (key, value) => {
        map.set(key, key === 'slot' ? value.slice(0, 20) : value)
      },
      remove: storage.remove,
    }

    const v2 = slotWorld('v2')
    const result = saveToSlots(silentlyTruncating, 'slot', v2)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(FRIENDLY)
      expect(result.message).not.toMatch(JARGON)
    }
    // tmp still holds the complete verified save — the only whole copy of v2.
    expect(map.get('slot.tmp')).toBe(serializeWorld(v2))
    // The old good save stepped down to backup before the tear, and is whole.
    expect(map.get('slot.backup')).toBe(serializeWorld(v1))
  })

  it('a crash that tears the good copy during promotion still leaves the backup loadable', () => {
    const { map, storage } = memoryStorage()
    const v1 = slotWorld('v1')
    const v2 = slotWorld('v2')
    expect(saveToSlots(storage, 'slot', v1).ok).toBe(true)
    expect(saveToSlots(storage, 'slot', v2).ok).toBe(true)

    // Writes to the base slot store half the bytes, then die — the worst
    // possible moment. Every other slot behaves normally.
    const tearing: SlotStorage = {
      read: storage.read,
      write: (key, value) => {
        if (key === 'slot') {
          map.set(key, value.slice(0, 25))
          throw new Error('power lost')
        }
        map.set(key, value)
      },
      remove: storage.remove,
    }

    const result = saveToSlots(tearing, 'slot', slotWorld('v3'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(FRIENDLY)

    // The good copy is torn — but the backup holds the previous good save.
    expect(parseWorld(map.get('slot') ?? '').ok).toBe(false)
    expect(map.get('slot.backup')).toBe(serializeWorld(v2))

    const load = loadFromSlots(storage, 'slot')
    expect(load.usedBackup).toBe(true)
    expect(load.world?.meta.name).toBe('v2')
    expect(load.error?.code).toBe('not-json')
  })
})

describe('loadFromSlots fallback ladder', () => {
  it('empty storage: no world, no backup, and no error — nothing was saved yet', () => {
    const { storage } = memoryStorage()
    const load = loadFromSlots(storage, 'slot')
    expect(load.world).toBeNull()
    expect(load.usedBackup).toBe(false)
    expect(load.error).toBeUndefined()
  })

  it('corrupt base + good backup: falls back, flags usedBackup, explains the base failure', () => {
    const { map, storage } = memoryStorage()
    const v1 = slotWorld('v1')
    map.set('slot', '{ this save died half-way')
    map.set('slot.backup', serializeWorld(v1))

    const load = loadFromSlots(storage, 'slot')
    expect(load.usedBackup).toBe(true)
    expect(load.world?.meta.name).toBe('v1')
    expect(load.error?.code).toBe('not-json')
  })

  it('corrupt base + corrupt backup: null world with the error kept for display', () => {
    const { map, storage } = memoryStorage()
    map.set('slot', 'not even close')
    map.set('slot.backup', 'also broken')

    const load = loadFromSlots(storage, 'slot')
    expect(load.world).toBeNull()
    expect(load.usedBackup).toBe(false)
    expect(load.error?.code).toBe('not-json')
  })

  it('rescues a verified save stranded in tmp by a failed promotion', () => {
    const { map, storage } = memoryStorage()
    const v2 = slotWorld('v2')
    // The step-4c failure signature: torn base, no backup yet, and the
    // verified new save still sitting on the landing pad.
    map.set('slot', '{ torn mid-write')
    map.set('slot.tmp', serializeWorld(v2))

    const load = loadFromSlots(storage, 'slot')
    expect(load.world?.meta.name).toBe('v2')
    expect(load.usedBackup).toBe(true)
    expect(load.error?.code).toBe('not-json')
  })

  it('never trusts tmp without re-parsing it — a corrupt tmp is not a rescue', () => {
    const { map, storage } = memoryStorage()
    map.set('slot', '{ torn mid-write')
    map.set('slot.tmp', '{ also torn')

    const load = loadFromSlots(storage, 'slot')
    expect(load.world).toBeNull()
    expect(load.usedBackup).toBe(false)
    expect(load.error?.code).toBe('not-json')
  })

  it('prefers the proven backup over a stranded tmp when both parse', () => {
    const { map, storage } = memoryStorage()
    const v1 = slotWorld('v1')
    const v2 = slotWorld('v2')
    map.set('slot', '{ torn mid-write')
    map.set('slot.backup', serializeWorld(v1))
    map.set('slot.tmp', serializeWorld(v2))

    // The backup was proven by a full past promotion; tmp only ever passed
    // its landing-pad check. The ladder tries the proven copy first.
    const load = loadFromSlots(storage, 'slot')
    expect(load.world?.meta.name).toBe('v1')
    expect(load.usedBackup).toBe(true)
  })
})

describe('createLocalStorageSlots', () => {
  it('talks to localStorage with prefixed keys, looked up at call time', () => {
    const g = globalThis as { localStorage?: unknown }
    const original = g.localStorage
    const backing = new Map<string, string>()
    g.localStorage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => {
        backing.set(key, value)
      },
      removeItem: (key: string) => {
        backing.delete(key)
      },
    }
    try {
      const slots = createLocalStorageSlots('test:')
      slots.write('slot', 'hello')
      expect(backing.get('test:slot')).toBe('hello')
      expect(slots.read('slot')).toBe('hello')
      slots.remove('slot')
      expect(backing.has('test:slot')).toBe(false)
      expect(slots.read('slot')).toBeNull()
    } finally {
      if (original === undefined) delete g.localStorage
      else g.localStorage = original
    }
  })

  it('imports fine without a browser; only USING it without one throws, in plain words', () => {
    const g = globalThis as { localStorage?: unknown }
    const original = g.localStorage
    try {
      delete g.localStorage
    } catch {
      // some runtimes pin their own localStorage; the else-branch covers them
    }
    try {
      const slots = createLocalStorageSlots()
      if (g.localStorage === undefined) {
        expect(() => slots.read('slot')).toThrow(/browser/)
      } else {
        expect(slots.read('surely-nobody-saved-under-this-key')).toBeNull()
      }
    } finally {
      if (original !== undefined) g.localStorage = original
    }
  })
})
