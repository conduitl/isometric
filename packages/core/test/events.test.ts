import { describe, expect, it } from 'vitest'
import { createEventBus } from '../src/events'

describe('the mailbox rule: emit goes to the write buffer', () => {
  it('emitted mail is not readable until swap', () => {
    const bus = createEventBus()
    bus.emit('hit', { damage: 3 })

    expect(bus.read('hit')).toEqual([])
    expect(bus.pendingCount()).toBe(1)

    bus.swap()
    expect(bus.read('hit')).toEqual([{ damage: 3 }])
    expect(bus.pendingCount()).toBe(0)
  })

  it('reading a type nobody wrote to yields an empty list, never undefined', () => {
    const bus = createEventBus()
    expect(bus.read('never-sent')).toEqual([])
    bus.swap()
    expect(bus.read('never-sent')).toEqual([])
  })

  it('preserves emission order within a type', () => {
    const bus = createEventBus()
    bus.emit('log', 'first')
    bus.emit('log', 'second')
    bus.emit('log', 'third')
    bus.swap()
    expect(bus.read('log')).toEqual(['first', 'second', 'third'])
  })

  it('keeps types independent', () => {
    const bus = createEventBus()
    bus.emit('hit', 1)
    bus.emit('heal', 2)
    bus.swap()
    expect(bus.read('hit')).toEqual([1])
    expect(bus.read('heal')).toEqual([2])
  })
})

describe('double-buffering across swaps', () => {
  it('mail emitted WHILE reading the same type waits for the next tick', () => {
    const bus = createEventBus()
    bus.emit('hit', 'a')
    bus.swap() // tick boundary: 'a' is delivered

    // A system reacts to 'a' by emitting 'b' of the same type — mid-read.
    expect(bus.read('hit')).toEqual(['a'])
    bus.emit('hit', 'b')

    // The reaction is invisible this tick: reads stay stable no matter how
    // many systems have already run.
    expect(bus.read('hit')).toEqual(['a'])
    expect(bus.pendingCount()).toBe(1)

    bus.swap() // next tick boundary
    expect(bus.read('hit')).toEqual(['b'])
  })

  it('swap starts a fresh outgoing bin — old mail is delivered exactly once', () => {
    const bus = createEventBus()
    bus.emit('ping', 1)
    bus.swap()
    expect(bus.read('ping')).toEqual([1])

    bus.swap() // nothing new was emitted
    expect(bus.read('ping')).toEqual([])
    expect(bus.pendingCount()).toBe(0)
  })

  it('an array handed out by read is a stable snapshot of its tick', () => {
    const bus = createEventBus()
    bus.emit('ping', 1)
    bus.swap()
    const firstDelivery = bus.read('ping')

    bus.emit('ping', 2)
    bus.swap()

    // Later swaps never mutate mail already handed out.
    expect(firstDelivery).toEqual([1])
    expect(bus.read('ping')).toEqual([2])
  })

  it('pendingCount totals all waiting mail across types', () => {
    const bus = createEventBus()
    expect(bus.pendingCount()).toBe(0)
    bus.emit('hit', 1)
    bus.emit('hit', 2)
    bus.emit('heal', 3)
    expect(bus.pendingCount()).toBe(3)
    bus.swap()
    expect(bus.pendingCount()).toBe(0)
  })
})

describe('clear — new world, empty mailboxes', () => {
  it('empties both bins: delivered mail and pending mail are both gone', () => {
    const bus = createEventBus()
    bus.emit('hit', { target: 'e1' })
    bus.swap() // 'hit' is now delivered mail
    bus.emit('heal', { target: 'e2' }) // ...and 'heal' is pending

    bus.clear()

    expect(bus.read('hit')).toEqual([])
    expect(bus.pendingCount()).toBe(0)
    bus.swap() // the pending bin really was empty, not just hidden
    expect(bus.read('heal')).toEqual([])
  })

  it('reassigns rather than mutates: snapshots handed out earlier survive', () => {
    const bus = createEventBus()
    bus.emit('hit', 1)
    bus.swap()
    const snapshot = bus.read('hit')

    bus.clear()

    expect(snapshot).toEqual([1]) // a stable snapshot of its tick, still
    expect(bus.read('hit')).toEqual([])
  })
})
