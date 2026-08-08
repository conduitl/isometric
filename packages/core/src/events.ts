/*
 * Simulation events — mail in a mailbox, delivered once per tick.
 *
 * ## Why not just call the listener right away?
 *
 * The obvious event system (emit → every listener runs immediately) has a
 * hidden dial: WHO reacts WHEN depends on the exact order everything was
 * wired up, and a reaction can emit more events mid-reaction, which trigger
 * more reactions... The simulation's behavior starts depending on call-stack
 * shapes nobody can see or replay. That is poison for a deterministic engine.
 *
 * ## The mailbox rule
 *
 * So instead: events are LETTERS, and there are two mail bins.
 *
 * - `emit` drops a letter in the OUTGOING bin. Nobody reacts yet.
 * - `read` looks at the INCOMING bin — the letters that were swapped in at
 *   the last tick boundary. Reading never removes or changes anything, so
 *   every system sees the same mail no matter what order systems run in.
 * - `swap`, called exactly once per tick (the engine's '#tick-end' stage),
 *   promotes outgoing → incoming and starts a fresh empty outgoing bin.
 *
 * The consequence to internalize: mail sent during tick N is read during
 * tick N+1, never sooner. A one-tick delay in exchange for perfect
 * reproducibility and inspectability — you can pause the clock mid-tick,
 * `console.log` both bins, and see exactly what has been sent and what is
 * about to be delivered. Events that sit still are events you can teach.
 *
 * (This bus is for SIMULATION events only. The engine↔UI boundary uses an
 * ordinary immediate emitter, because a button click doesn't need replay.)
 */

/**
 * The double-buffered event bus.
 *
 * `emit` files a payload under a type name in the write buffer. `read`
 * returns everything of one type from the READ buffer — the mail delivered
 * at the last tick boundary — in the order it was emitted. `swap` is the
 * tick boundary itself: write becomes read, write starts empty. It is called
 * by the engine's own end-of-tick stage; systems never call it.
 * `pendingCount` counts letters in the outgoing bin, mostly so inspectors
 * can show "3 events waiting for the next tick".
 *
 * `clear` is "new world, empty mailboxes": both bins are replaced with fresh
 * empty ones at once. Like `swap`, it is engine machinery, not a system tool —
 * loadWorld calls it so a freshly loaded world never receives the previous
 * world's mail (stale payloads can name entities that no longer exist).
 */
export interface EventBus {
  emit(type: string, payload: unknown): void
  read(type: string): readonly unknown[]
  swap(): void
  clear(): void
  pendingCount(): number
}

/** The empty mailbox, frozen and shared: reading a type nobody wrote to costs no allocation. */
const NO_MAIL: readonly unknown[] = Object.freeze([])

/**
 * Build an event bus: two Maps from type name to payload list, and a swap
 * that just exchanges the roles. Note what swap does NOT do: it does not
 * copy anything. The old write buffer becomes the read buffer wholesale,
 * which also means an array handed out by `read` is a stable snapshot of one
 * tick's mail — later swaps never mutate it.
 */
export function createEventBus(): EventBus {
  let readBuffer = new Map<string, unknown[]>()
  let writeBuffer = new Map<string, unknown[]>()

  return {
    emit(type: string, payload: unknown): void {
      const queue = writeBuffer.get(type)
      if (queue === undefined) {
        writeBuffer.set(type, [payload])
      } else {
        queue.push(payload)
      }
    },

    read(type: string): readonly unknown[] {
      return readBuffer.get(type) ?? NO_MAIL
    },

    swap(): void {
      readBuffer = writeBuffer
      writeBuffer = new Map()
    },

    clear(): void {
      // New world, empty mailboxes. Both bins are REASSIGNED, never emptied
      // in place: arrays already handed out by `read` are stable snapshots
      // of their tick's mail, and clearing must keep that promise exactly
      // the way `swap` does.
      readBuffer = new Map()
      writeBuffer = new Map()
    },

    pendingCount(): number {
      let count = 0
      for (const queue of writeBuffer.values()) {
        count += queue.length
      }
      return count
    },
  }
}
