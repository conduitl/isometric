import { describe, expect, it } from 'vitest'
import type { Rng } from '@engine/math'
import { createRng } from '@engine/math'
import type { DepthSortable } from '../src/index'
import { createIso, paintersOrder } from '../src/index'

/** Deterministic Fisher–Yates shuffle driven by a seeded rng. */
const shuffle = <T>(items: readonly T[], rng: Rng): T[] => {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1)
    const a = out[i]
    const b = out[j]
    if (a === undefined || b === undefined) continue
    out[i] = b
    out[j] = a
  }
  return out
}

const ids = (items: readonly DepthSortable[]): string[] => items.map((item) => item.id)

describe('paintersOrder basics', () => {
  it('sorts ascending by depth — back first, front last', () => {
    const sorted = paintersOrder([
      { id: 'e3', depth: 5 },
      { id: 'e1', depth: -2 },
      { id: 'e2', depth: 0 },
    ])
    expect(ids(sorted)).toEqual(['e1', 'e2', 'e3'])
  })

  it('returns a NEW array and never mutates its input', () => {
    const input = [
      { id: 'e2', depth: 1 },
      { id: 'e1', depth: 0 },
    ]
    const snapshot = [...input]
    const sorted = paintersOrder(input)
    expect(sorted).not.toBe(input)
    expect(input).toEqual(snapshot)
  })

  it('breaks depth ties with NUMERIC suffix order: e2 before e10, e9 before e10', () => {
    // Plain string comparison gets both of these wrong ("e10" < "e2" and
    // "e10" < "e9" lexicographically) — the 1.png/10.png file-listing trap.
    const sorted = paintersOrder([
      { id: 'e10', depth: 7 },
      { id: 'e9', depth: 7 },
      { id: 'e2', depth: 7 },
    ])
    expect(ids(sorted)).toEqual(['e2', 'e9', 'e10'])
  })

  it('orders ids with different prefixes by plain string order on the prefix', () => {
    // One key per id: "a5" → ("a", 5), "b2" → ("b", 2), and digitless
    // "player" takes its whole string as prefix → ("player", −1).
    const sorted = paintersOrder([
      { id: 'b2', depth: 0 },
      { id: 'a5', depth: 0 },
      { id: 'player', depth: 0 },
    ])
    expect(ids(sorted)).toEqual(['a5', 'b2', 'player'])
  })

  it('keeps the order total for numerically-equal ids with leading zeros', () => {
    const sorted = paintersOrder([
      { id: 'e2', depth: 0 },
      { id: 'e02', depth: 0 },
    ])
    expect(ids(sorted)).toEqual(['e02', 'e2']) // numeric tie; the key's full-id field decides
  })

  it('input order NEVER leaks through: any shuffle of the same set sorts identically', () => {
    const rng = createRng(440)
    const items: DepthSortable[] = [
      { id: 'e5', depth: 3 },
      { id: 'e12', depth: 3 },
      { id: 'e3', depth: 3 }, // three-way tie — the dangerous case
      { id: 'e7', depth: 1 },
      { id: 'e2', depth: 9 },
      { id: 'e11', depth: 1 }, // two-way tie
    ]
    const reference = ids(paintersOrder(items))
    expect(reference).toEqual(['e7', 'e11', 'e3', 'e5', 'e12', 'e2'])
    for (let k = 0; k < 25; k++) {
      expect(ids(paintersOrder(shuffle(items, rng)))).toEqual(reference)
    }
  })
})

describe('review regression: the tiebreak is ONE total order, never two interleaved', () => {
  // The original comparator used numeric order for same-prefix pairs and
  // plain string order for everything else. Each pairwise answer looked
  // reasonable, but chained together they cycled: e2 < e10 (numeric),
  // e10 < e1x (string — "e1x" has no trailing digits), e1x < e2 (string).
  // A comparator with a cycle is not an order, and Array.sort fed one can
  // return DIFFERENT outputs for different input arrangements. The fix
  // sorts every id by one (prefix, number, full id) key; this set contains
  // exactly the pairs that used to cycle, at equal depth so only the
  // tiebreak decides.
  const CYCLE_PRONE: readonly DepthSortable[] = [
    { id: 'e2', depth: 0 },
    { id: 'e10', depth: 0 },
    { id: 'e1x', depth: 0 }, // digitless tail: whole id is its prefix
    { id: 'ground2', depth: 0 },
    { id: 'ground10', depth: 0 },
    { id: 'ground1a', depth: 0 }, // the same trap with a longer prefix
  ]

  // Key order: prefix "e" (e2 then e10, numerically) < prefix "e1x"
  // < prefix "ground" (ground2 then ground10) < prefix "ground1a".
  const EXPECTED = ['e2', 'e10', 'e1x', 'ground2', 'ground10', 'ground1a']

  /** Every arrangement of the items — all 720 permutations of six. */
  const permutations = <T>(items: readonly T[]): T[][] => {
    if (items.length <= 1) return [[...items]]
    const out: T[][] = []
    items.forEach((head, i) => {
      const rest = items.filter((_, j) => j !== i)
      for (const tail of permutations(rest)) out.push([head, ...tail])
    })
    return out
  }

  it('ALL permutations of the equal-depth cycle-prone set sort identically', () => {
    const arrangements = permutations(CYCLE_PRONE)
    expect(arrangements).toHaveLength(720)
    for (const arrangement of arrangements) {
      expect(ids(paintersOrder(arrangement))).toEqual(EXPECTED)
    }
  })
})

describe('committed expected ordering: the iso fixture scene', () => {
  // ~10 entities across three layer bands, with an elevation stack and a
  // three-way same-row tie. This exact ordering is a roadmap exit criterion:
  // if a refactor changes it, rendering changed, and this test says so.
  //
  // With the default iso lens (tileWidth 2, tileHeight 1, zScale 1) the
  // within-band key is x − y + z — the south-east camera: east and up are
  // nearer, north is farther — and bands dominate via DEPTH_BAND_STRIDE.
  const iso = createIso()
  const scene = [
    { id: 'e1', band: 0, at: { x: 0, y: 0, z: 0 } },
    { id: 'e2', band: 0, at: { x: 2, y: 1, z: 0 } },
    { id: 'e3', band: 0, at: { x: 3, y: 2, z: 0 } },
    { id: 'e10', band: 0, at: { x: 1, y: 0, z: 0 } },
    { id: 'e4', band: 0, at: { x: 2, y: 1, z: 1 } },
    { id: 'e5', band: 0, at: { x: 2, y: 1, z: 2 } },
    { id: 'e6', band: 0, at: { x: 5, y: 0, z: 0 } },
    { id: 'e7', band: 1, at: { x: 0, y: 0, z: 0 } },
    { id: 'e8', band: 1, at: { x: 1, y: 0, z: 0 } },
    { id: 'e9', band: 2, at: { x: 0, y: 0, z: 0 } },
  ]

  // WHY this order is right, entity by entity:
  //   e1  — band 0, key 0−0+0 = 0: farthest from the south-east camera in
  //         this scene, painted first.
  //   e2  — band 0, key 2−1+0 = 1: on the x−y = 1 screen row...
  //   e3  — band 0, key 3−2+0 = 1: ...same row, so same key; the numeric
  //         id tiebreak puts e2 (2) before e3 (3)...
  //   e10 — band 0, key 1−0+0 = 1: ...and e10 (10) after both — lexicographic
  //         sorting would have wrongly painted e10 FIRST of the three.
  //   e4  — band 0, key 2−1+1 = 2: one storey up on e2's tile; higher on the
  //         stack means nearer, painted after its base.
  //   e5  — band 0, key 2−1+2 = 3: second storey, painted after e4.
  //   e6  — band 0, key 5−0+0 = 5: far east along the south edge — the
  //         nearest point in band 0, painted last within it.
  //   e7  — band 1, key 0: band 1 starts AFTER everything in band 0, even
  //         though its within-band key (0) is smaller than e6's (5) — the
  //         DEPTH_BAND_STRIDE dominance rule.
  //   e8  — band 1, key 1−0+0 = 1: after e7 within its band.
  //   e9  — band 2, key 0: the topmost band, painted last of all.
  const EXPECTED_ORDER = ['e1', 'e2', 'e3', 'e10', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9']

  const drawables = scene.map((entity) => ({
    id: entity.id,
    depth: iso.depth(entity.at, entity.band),
  }))

  it('matches the committed expected ordering exactly', () => {
    expect(ids(paintersOrder(drawables))).toEqual(EXPECTED_ORDER)
  })

  it('matches it from ANY input arrangement — iso sorting is deterministic', () => {
    const rng = createRng(441)
    for (let k = 0; k < 25; k++) {
      expect(ids(paintersOrder(shuffle(drawables, rng)))).toEqual(EXPECTED_ORDER)
    }
    // And from reversed input, the classic stability leak.
    expect(ids(paintersOrder([...drawables].reverse()))).toEqual(EXPECTED_ORDER)
  })
})
