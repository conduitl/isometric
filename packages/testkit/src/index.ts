/**
 * @engine/testkit — replay hashing: the machinery behind our determinism promise.
 *
 * The whole engine rests on one claim: same seed + same inputs → the exact same
 * world, every time, forever (docs/ROADMAP.md, Phase 0 exit). But how do you PROVE
 * two worlds are identical without comparing thousands of numbers by hand? You
 * boil each world down to a short fingerprint — a hash — and compare fingerprints.
 * CI runs the simulation twice; if the two 8-character fingerprints match, every
 * position, velocity, and phase underneath them matched too (with overwhelming
 * probability). If they differ, something non-deterministic snuck in — a wall
 * clock, an unseeded random, an unstable iteration order — and the build fails.
 *
 * Two ingredients: a CANONICAL serializer (turn a world into the one-and-only
 * string that represents it) and a FAST hash (turn that string into a short hex
 * fingerprint). Both live here.
 */

/**
 * Serialize a value to JSON with object keys sorted at every depth — the
 * canonical form that makes hashing meaningful.
 *
 * Why not plain JSON.stringify? Because it prints object keys in INSERTION
 * order: `{a:1, b:2}` and `{b:2, a:1}` are the same data but print differently,
 * so their hashes would differ and our determinism test would cry wolf. Sorting
 * the keys at every level removes the one degree of freedom JSON leaves open —
 * equal data now always produces byte-identical text.
 *
 * Everything else follows JSON.stringify's rules, so the output is real JSON:
 * - NaN and ±Infinity become `null` (JSON has no way to spell them),
 * - `undefined`, functions, and symbols are dropped from objects and become
 *   `null` inside arrays,
 * - objects with a `toJSON()` method (like Date) are asked to convert first,
 * - BigInt throws, exactly like JSON.stringify.
 *
 * One deliberate difference: a circular structure (an object that eventually
 * contains itself) throws immediately. A cycle has no finite text form, and in
 * a world snapshot it almost always means a bug — better a loud error than a
 * hang or a lie.
 */
export function stableStringify(value: unknown): string {
  // Objects currently on the path from the root to where we are now. If we meet
  // one of these again while still inside it, we have walked in a circle. Note
  // this is a PATH set, not a "seen ever" set: the same object may appear twice
  // as two siblings (a diamond shape) — that is fine and serializes fine.
  const path = new Set<object>()
  return serialize(value, path) ?? 'null'
}

/**
 * The recursive worker. Returns `undefined` for values JSON cannot represent
 * (undefined/function/symbol) so the caller can decide: objects drop the entry,
 * arrays substitute `null` — the same two rules JSON.stringify uses.
 */
function serialize(value: unknown, path: Set<object>): string | undefined {
  // Honor toJSON first, like JSON.stringify does — this is how Date turns
  // itself into an ISO string before serialization ever sees it.
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  ) {
    value = (value as { toJSON(): unknown }).toJSON()
  }

  switch (typeof value) {
    case 'string':
      // JSON.stringify handles all the escaping rules (quotes, newlines,
      // weird control characters) — no reason to rewrite that by hand.
      return JSON.stringify(value)
    case 'number':
      // JSON has no NaN or Infinity, so JSON.stringify prints them as null.
      // We do the same: the fingerprint must never contain unparseable text.
      return Number.isFinite(value) ? String(value) : 'null'
    case 'boolean':
      return value ? 'true' : 'false'
    case 'bigint':
      throw new TypeError('stableStringify: BigInt values are not serializable (same rule as JSON.stringify)')
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined
  }

  if (value === null) return 'null'

  // From here on, `value` is an object or an array — the recursive cases.
  const obj = value as object
  if (path.has(obj)) {
    throw new TypeError('stableStringify: circular structure — the value contains itself')
  }
  path.add(obj)
  try {
    if (Array.isArray(obj)) {
      const parts: string[] = []
      for (const item of obj) {
        // Inside an array, a hole that JSON can't express becomes null —
        // otherwise indexes would silently shift and [1, undefined, 3]
        // would collide with [1, 3].
        parts.push(serialize(item, path) ?? 'null')
      }
      return `[${parts.join(',')}]`
    }

    // The heart of the function: sort() puts keys in one agreed-upon order
    // (plain code-unit order — we don't care WHICH order, only that there is
    // exactly one), so equal objects always print identically.
    const keys = Object.keys(obj).sort()
    const parts: string[] = []
    for (const key of keys) {
      const serialized = serialize((obj as Record<string, unknown>)[key], path)
      if (serialized !== undefined) {
        parts.push(`${JSON.stringify(key)}:${serialized}`)
      }
    }
    return `{${parts.join(',')}}`
  } finally {
    // We are done with this object — remove it from the path so a SIBLING
    // reference to the same object (legal!) is not mistaken for a cycle.
    path.delete(obj)
  }
}

/**
 * Hash a string to an 8-character lowercase hex fingerprint using FNV-1a
 * (Fowler–Noll–Vo, 32-bit).
 *
 * FNV-1a is beautifully simple: start from a magic "offset basis"
 * (0x811c9dc5), then for every character do two things — XOR the character in,
 * then multiply by a magic prime (0x01000193 = 16777619). The XOR folds the new
 * character into the low bits; the prime multiplication then smears those bits
 * across the whole 32-bit word, so by the time the next character arrives, the
 * previous one has influenced every bit. Change any single character anywhere
 * and the final number changes almost unrecognizably — exactly what you want
 * from a fingerprint. (The magic constants aren't arbitrary: the FNV authors
 * chose primes with a bit pattern that maximizes this mixing.)
 *
 * Two implementation notes worth knowing:
 * - We feed in UTF-16 code units (what charCodeAt gives us) rather than UTF-8
 *   bytes. For the ASCII JSON we hash, the two are identical; for anything
 *   else it is still a fixed, deterministic recipe — which is the only
 *   property replay hashing needs.
 * - Math.imul does the multiplication the way a 32-bit CPU would, wrapping on
 *   overflow, and `>>> 0` reinterprets the result as unsigned so toString(16)
 *   never prints a minus sign.
 *
 * This is NOT cryptography — it is fast and tiny, and collisions are merely
 * astronomically unlikely rather than impossible. For a CI test that compares
 * a run against itself, that trade is exactly right.
 */
export function hashString(s: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Fingerprint any plain-data value: canonical text first, then hash.
 *
 * This is the one-liner the determinism tests actually call:
 * `hashValue(worldState)` after run A must equal `hashValue(worldState)` after
 * run B, or the engine has broken its central promise. Because
 * stableStringify sorts keys everywhere, the fingerprint depends only on the
 * DATA — never on the order the code happened to assign its fields.
 */
export function hashValue(value: unknown): string {
  return hashString(stableStringify(value))
}
