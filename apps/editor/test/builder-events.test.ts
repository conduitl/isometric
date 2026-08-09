/**
 * The boundary emitter, pinned. Small surface, load-bearing promises:
 * synchronous delivery in subscription order (lessons see the event in the
 * same instant the action completed), unsubscribe by returned function, and
 * containment — one listener's crash never starves the others, because a
 * broken lesson panel must never eat a save event.
 */

import { describe, expect, it, vi } from 'vitest'
import { BUILDER_EVENT_ALIASES, createBuilderEmitter } from '../src/editor/events/builder'
import type { BuilderEvent } from '../src/editor/events/builder'

const savedEvent: BuilderEvent = { type: 'builder.world-saved', worldId: 'w7' }
const renamedEvent: BuilderEvent = { type: 'builder.world-renamed', from: 'a', to: 'b' }

describe('createBuilderEmitter', () => {
  it('delivers synchronously, in subscription order', () => {
    const emitter = createBuilderEmitter()
    const order: string[] = []
    emitter.on(() => order.push('first'))
    emitter.on(() => order.push('second'))
    emitter.on(() => order.push('third'))
    emitter.emit(savedEvent)
    // No await, no flush: the emit call itself did all the delivering.
    expect(order).toEqual(['first', 'second', 'third'])
  })

  it('hands every listener the same event object', () => {
    const emitter = createBuilderEmitter()
    const seen: BuilderEvent[] = []
    emitter.on((event) => seen.push(event))
    emitter.on((event) => seen.push(event))
    emitter.emit(savedEvent)
    expect(seen).toEqual([savedEvent, savedEvent])
    expect(seen[0]).toBe(savedEvent)
  })

  it('unsubscribing stops future deliveries without touching other listeners', () => {
    const emitter = createBuilderEmitter()
    const received: string[] = []
    const off = emitter.on((event) => received.push(`a:${event.type}`))
    emitter.on((event) => received.push(`b:${event.type}`))
    emitter.emit(savedEvent)
    off()
    emitter.emit(renamedEvent)
    expect(received).toEqual(['a:builder.world-saved', 'b:builder.world-saved', 'b:builder.world-renamed'])
  })

  it('a throwing listener is contained: later listeners still hear the event', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const emitter = createBuilderEmitter()
      const received: string[] = []
      emitter.on(() => {
        throw new Error('broken lesson panel')
      })
      emitter.on((event) => received.push(event.type))
      emitter.emit(savedEvent)
      expect(received).toEqual(['builder.world-saved'])
      // The failure is reported, not swallowed silently — and not rethrown.
      expect(errorSpy).toHaveBeenCalledTimes(1)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('emitting with no listeners is a quiet no-op', () => {
    const emitter = createBuilderEmitter()
    expect(() => emitter.emit(savedEvent)).not.toThrow()
  })
})

describe('freeze discipline', () => {
  it('the alias table is empty until the Phase 3 freeze', () => {
    // This test IS the reminder: nothing can need an alias before anything
    // is frozen (D4). The first legitimate entry arrives only when a frozen
    // name is superseded — and lands here with a lesson-replay test beside it.
    expect(Object.keys(BUILDER_EVENT_ALIASES)).toHaveLength(0)
  })
})
