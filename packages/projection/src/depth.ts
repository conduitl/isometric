/**
 * The painter's algorithm — depth as an ORDERING RELATION, not a place.
 *
 * A 2D canvas has no z-buffer; whatever is drawn last simply covers what
 * came before, like coats of paint. So "what is in front?" becomes "what is
 * drawn later?", and the whole 2.5D illusion reduces to sorting: give every
 * drawable one number (its depth key, from Projection.depth) and paint in
 * ascending order — back first, front last.
 *
 * The subtle requirement is DETERMINISM. Two entities on the same iso
 * diagonal have equal keys, and a sort with unresolved ties lets the
 * INPUT ORDER leak into the picture — the same world could render two
 * different ways depending on the order some Map happened to iterate. The
 * fix is to make the comparison total: ties break by entity id, so every
 * pair of distinct drawables has exactly one correct order and the input
 * arrangement can never show through.
 */

/** Anything that can take its place in the painting queue: one key, one identity. */
export interface DepthSortable {
  readonly depth: number
  readonly id: string
}

/**
 * Compare entity ids the way a human counts, not the way strings sort.
 *
 * Entity ids are 'e' + a monotonic counter ("e2", "e10"), and plain string
 * comparison gets them WRONG: "e10" < "e2" lexicographically, because
 * strings compare character by character and '1' < '2' — the same trap that
 * files named 1.png … 10.png fall into.
 *
 * The safe way to fix that is to give EVERY id one sort key and order ALL
 * ids by that single key — never "numeric order for some pairs, string
 * order for others". (Mixing two orders is a real bug this file once had:
 * pair-by-pair rules can chain into a cycle like a < b < c < a, and a
 * comparator with a cycle is not an ordering at all.) The key is the triple
 *
 *     (prefix, numeric suffix, full id)
 *
 * An id ending in digits splits there: "e10" → ("e", 10, "e10"). An id with
 * no trailing digits takes its WHOLE string as the prefix and −1 as the
 * suffix: "player" → ("player", −1, "player") — the −1 just means "before
 * any real counter value", so "e" would sort before "e0". Keys compare
 * lexicographically: prefix first (plain string order), then suffix as a
 * NUMBER (2 < 10, fixing the trap), then the full id as the final
 * tie-breaker so leading-zero twins like "e02" vs "e2" — equal in the first
 * two fields — still settle deterministically. One key per id, compared
 * field by field, is transitive by construction, the same way alphabetical
 * order is.
 */
const TRAILING_DIGITS = /^(.*?)(\d+)$/

const compareIds = (a: string, b: string): number => {
  // Compute both keys field-on-demand — no tuple objects allocated.
  const ma = TRAILING_DIGITS.exec(a)
  const mb = TRAILING_DIGITS.exec(b)
  const prefixA = ma === null ? a : (ma[1] as string)
  const prefixB = mb === null ? b : (mb[1] as string)
  if (prefixA !== prefixB) return prefixA < prefixB ? -1 : 1
  const suffixA = ma === null ? -1 : Number(ma[2])
  const suffixB = mb === null ? -1 : Number(mb[2])
  if (suffixA !== suffixB) return suffixA - suffixB
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Sort drawables into painting order: ascending depth, ties broken by
 * numeric-suffix-aware id comparison. Returns a NEW array; the input is
 * never touched.
 *
 * The comparison is a total ORDER over (depth, id) — every distinct pair
 * compares one way (antisymmetric), AND the pairwise answers chain
 * consistently (transitive: a before b and b before c forces a before c).
 * Both halves matter. Antisymmetry alone is not enough: hand Array.sort a
 * comparator whose answers form a cycle and the "sorted" output can differ
 * between input arrangements, because sorting algorithms only ever compare
 * SOME pairs and trust transitivity to pin down the rest. With a genuine
 * total order, the output depends only on WHAT is in the list, never on how
 * it happened to be arranged — shuffle the input any way you like and the
 * painting order is identical. That theorem is what makes iso rendering
 * replayable and hash-stable.
 */
export function paintersOrder<T extends DepthSortable>(items: readonly T[]): T[] {
  const queue = [...items]
  queue.sort((a, b) => (a.depth !== b.depth ? a.depth - b.depth : compareIds(a.id, b.id)))
  return queue
}
