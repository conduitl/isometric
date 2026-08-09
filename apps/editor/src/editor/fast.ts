/**
 * The fast channel — pointer-rate values, straight past React.
 *
 * The cursor readout in the status bar updates on every pointer move. Route
 * that through the zustand store and React re-renders panels at pointer rate
 * — precisely what the store's throttled-by-construction contract forbids.
 * So pointer-rate data rides this tiny channel instead: the session
 * publishes, the status bar's imperative DOM writer subscribes, and React
 * never hears about any of it (ARCHITECTURE §6: "linked numeric displays at
 * rAF rate outside React's throttled store").
 *
 * `last` is kept so a late subscriber (a panel mounting mid-session) can
 * paint the current readout immediately instead of waiting for the next
 * pointer twitch. A listener that throws is ITS OWN bug: the publish still
 * reaches everyone else, same policy as the builder event emitter — a broken
 * readout must never eat everyone else's.
 */

import type { CursorReadout, FastChannel } from './types'

/** Build the session's one fast channel. */
export function createFastChannel(): FastChannel {
  const listeners = new Set<(readout: CursorReadout) => void>()
  let last: CursorReadout | null = null

  return {
    publish(readout: CursorReadout): void {
      last = readout
      // Snapshot the set: a listener unsubscribing (or subscribing) during
      // notification must not change who THIS publish reaches.
      for (const listener of [...listeners]) {
        try {
          listener(readout)
        } catch (error) {
          console.error('fast channel listener failed', error)
        }
      }
    },

    subscribe(listener: (readout: CursorReadout) => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    get last(): CursorReadout | null {
      return last
    },
  }
}
