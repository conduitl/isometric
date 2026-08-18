/**
 * The divider's whole keyboard-and-drag contract, as arithmetic
 * (src/ui/split-math.ts). The React divider renders these functions; this
 * suite pins them so a layout refactor cannot quietly change what Enter,
 * Home, or a drag below the park threshold DOES.
 */

import { describe, expect, it } from 'vitest'
import {
  cycleSplitPreset,
  nudgeSplit,
  parkSplit,
  readSplitPref,
  SPLIT_BOOT,
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
  SPLIT_PARK_AT,
  SPLIT_PREF_KEY,
  SPLIT_PRESETS,
  splitFromPointer,
  unparkSplit,
  widenSplit,
  writeSplitPref,
} from '../src/ui/split-math'
import type { PrefStorage, SplitState } from '../src/ui/split-math'

const open = (pct: number): SplitState => ({ pct, parked: false })

describe('splitFromPointer — dragging', () => {
  it('clamps into [MIN, MAX]', () => {
    // 19% is past the park threshold but under MIN — it opens AT MIN.
    expect(splitFromPointer(SPLIT_BOOT, SPLIT_PARK_AT + 5)).toEqual(open(SPLIT_MIN))
    expect(splitFromPointer(SPLIT_BOOT, 99)).toEqual(open(SPLIT_MAX))
    expect(splitFromPointer(SPLIT_BOOT, 50)).toEqual(open(50))
  })

  it('parks below PARK_AT, keeping the stored width for restore', () => {
    const dragged = splitFromPointer(open(61), SPLIT_PARK_AT - 1)
    expect(dragged).toEqual({ pct: 61, parked: true })
    expect(unparkSplit(dragged)).toEqual(open(61))
  })
})

describe('nudgeSplit — arrow keys', () => {
  it('nudges within bounds', () => {
    expect(nudgeSplit(open(46), 2)).toEqual(open(48))
    expect(nudgeSplit(open(46), -10)).toEqual(open(36))
  })

  it('clamps at both rails', () => {
    expect(nudgeSplit(open(SPLIT_MIN), -2)).toEqual(open(SPLIT_MIN))
    expect(nudgeSplit(open(SPLIT_MAX), 10)).toEqual(open(SPLIT_MAX))
  })

  it('a nudge while parked unparks to the stored width', () => {
    expect(nudgeSplit({ pct: 33, parked: true }, 2)).toEqual(open(33))
  })
})

describe('cycleSplitPreset — Enter / double-click', () => {
  it('advances preset → preset → preset → wraps', () => {
    const [reading, balanced, building] = SPLIT_PRESETS
    expect(cycleSplitPreset(open(reading ?? 60))).toEqual(open(balanced ?? 46))
    expect(cycleSplitPreset(open(balanced ?? 46))).toEqual(open(building ?? 24))
    expect(cycleSplitPreset(open(building ?? 24))).toEqual(open(reading ?? 60))
  })

  it('treats a hand-dragged near-preset as that preset', () => {
    expect(cycleSplitPreset(open(45))).toEqual(open(24)) // 45 ≈ balanced 46 → building
  })

  it('lands on the first preset from anywhere unrecognized (parked included)', () => {
    expect(cycleSplitPreset(open(37))).toEqual(open(SPLIT_PRESETS[0] ?? 60))
    expect(cycleSplitPreset({ pct: 46, parked: true })).toEqual(open(SPLIT_PRESETS[0] ?? 60))
  })
})

describe('park / unpark / widen', () => {
  it('Home parks, keeping pct; End restores when parked, widens when open', () => {
    const parked = parkSplit(open(58))
    expect(parked).toEqual({ pct: 58, parked: true })
    expect(widenSplit(parked)).toEqual(open(58))
    expect(widenSplit(open(58))).toEqual(open(SPLIT_MAX))
  })
})

describe('persistence — defensive by construction', () => {
  const memory = (): PrefStorage & { map: Map<string, string> } => {
    const map = new Map<string, string>()
    return {
      map,
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value)
      },
    }
  }

  it('round-trips a state', () => {
    const storage = memory()
    writeSplitPref(storage, { pct: 33, parked: true })
    expect(readSplitPref(storage)).toEqual({ pct: 33, parked: true })
  })

  it('boots the default on: no storage, no key, bad JSON, wrong shapes, silly numbers', () => {
    expect(readSplitPref(undefined)).toEqual({ pct: SPLIT_DEFAULT, parked: false })
    expect(readSplitPref(memory())).toEqual(SPLIT_BOOT)
    for (const text of ['garbage', '42', 'null', '{"pct":"wide","parked":false}', '{"pct":46}', '{"pct":1e999,"parked":false}']) {
      const storage = memory()
      storage.map.set(SPLIT_PREF_KEY, text)
      expect(readSplitPref(storage)).toEqual(SPLIT_BOOT)
    }
  })

  it('clamps a stored out-of-range width instead of trusting it', () => {
    const storage = memory()
    storage.map.set(SPLIT_PREF_KEY, JSON.stringify({ pct: 95, parked: false }))
    expect(readSplitPref(storage)).toEqual(open(SPLIT_MAX))
  })

  it('swallows storage throws (privacy mode) without crashing', () => {
    const throwing: PrefStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readSplitPref(throwing)).toEqual(SPLIT_BOOT)
    expect(() => writeSplitPref(throwing, SPLIT_BOOT)).not.toThrow()
  })
})
