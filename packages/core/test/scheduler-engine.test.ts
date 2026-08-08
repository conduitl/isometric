import { createRng } from '@engine/math'
import { describe, expect, it } from 'vitest'
import { createEngine } from '../src/engine'
import type { Engine, EnginePlugin } from '../src/engine'
import { SYSTEM_PHASES, createScheduler } from '../src/scheduler'
import type { System, SystemCtx, SystemPhase } from '../src/scheduler'
import { createWorld, spawn } from '../src/world'

const FIXED = 1 / 60

/** A do-nothing system with the given name and phase. */
function system(name: string, phase: SystemPhase, run: (ctx: SystemCtx) => void = () => {}): System {
  return { name, phase, run }
}

describe('scheduler', () => {
  it('exposes the four phases in execution order', () => {
    expect(SYSTEM_PHASES).toEqual(['input', 'simulate', 'post', 'renderMirror'])
  })

  it('orders systems by phase then insertion order, regardless of add order', () => {
    const scheduler = createScheduler()
    scheduler.add(system('mirror', 'renderMirror'))
    scheduler.add(system('score', 'post'))
    scheduler.add(system('keys', 'input'))
    scheduler.add(system('move', 'simulate'))
    scheduler.add(system('gamepad', 'input')) // second input system, added last

    expect(scheduler.systems().map((s) => s.name)).toEqual(['keys', 'gamepad', 'move', 'score', 'mirror'])
  })

  it('rejects duplicate names, even across phases', () => {
    const scheduler = createScheduler()
    scheduler.add(system('move', 'simulate'))
    expect(() => scheduler.add(system('move', 'post'))).toThrow(/move/)
  })

  it('rejects an unknown phase loudly instead of silently never running it', () => {
    const scheduler = createScheduler()
    expect(() => scheduler.add(system('typo', 'update' as SystemPhase))).toThrow(/input, simulate, post, renderMirror/)
  })

  it('remove reports whether anything was removed', () => {
    const scheduler = createScheduler()
    scheduler.add(system('move', 'simulate'))
    expect(scheduler.remove('gravity')).toBe(false)
    expect(scheduler.remove('move')).toBe(true)
    expect(scheduler.remove('move')).toBe(false)
    expect(scheduler.systems()).toEqual([])
  })
})

describe('createEngine wiring', () => {
  it('builds a default world and seeds the rng from its settings', () => {
    const engine = createEngine()
    expect(engine.world.meta.worldId).toBe('w1')
    expect(engine.tick).toBe(0)
    expect(engine.clock.fixedDt).toBe(engine.world.settings.fixedDt)
    expect(engine.plugins()).toEqual([])
    // Same seed, same stream: the engine's rng is createRng(seed), nothing more.
    expect(engine.rng.next()).toBe(createRng(1).next())
  })

  it('adopts a provided world, seed and all', () => {
    const world = createWorld({ settings: { seed: 42 } })
    const engine = createEngine({ world })
    expect(engine.world).toBe(world)
    expect(engine.rng.next()).toBe(createRng(42).next())
  })

  it('stages() names Clock stages "<phase>:<systemName>" and ends with #tick-end', () => {
    const engine = createEngine()
    engine.scheduler.add(system('move', 'simulate'))
    engine.scheduler.add(system('keys', 'input'))

    expect(engine.stages().map((s) => s.name)).toEqual(['input:keys', 'simulate:move', '#tick-end'])
  })

  it('stages() is recomputed on each call, so newly added systems appear', () => {
    const engine = createEngine()
    expect(engine.stages().map((s) => s.name)).toEqual(['#tick-end'])

    engine.scheduler.add(system('move', 'simulate'))
    expect(engine.stages().map((s) => s.name)).toEqual(['simulate:move', '#tick-end'])
  })
})

describe('engine.stages() drives the Clock (the real loop, end to end)', () => {
  it('runs systems in phase order every tick, with ctx.tick counting up', () => {
    const engine = createEngine()
    const log: string[] = []
    engine.scheduler.add(system('score', 'post', (ctx) => log.push(`post@${ctx.tick}`)))
    engine.scheduler.add(system('keys', 'input', (ctx) => log.push(`input@${ctx.tick}`)))
    engine.scheduler.add(system('move', 'simulate', (ctx) => log.push(`simulate@${ctx.tick}`)))

    const ran = engine.clock.advance(2.5 * FIXED, engine.stages())

    expect(ran).toBe(2)
    expect(engine.tick).toBe(2)
    expect(log).toEqual([
      'input@0', 'simulate@0', 'post@0',
      'input@1', 'simulate@1', 'post@1',
    ])
  })

  it('systems receive the fixed dt and the live world', () => {
    const engine = createEngine()
    spawn(engine.world, { name: 'player' })
    const dts: number[] = []
    engine.scheduler.add(
      system('probe', 'simulate', (ctx) => {
        dts.push(ctx.dt)
        expect(ctx.world).toBe(engine.world)
      }),
    )

    engine.clock.advance(3 * FIXED, engine.stages())
    expect(dts).toEqual([FIXED, FIXED, FIXED])
  })

  it('events emitted in tick N are readable in tick N+1, never sooner', () => {
    const engine = createEngine()
    const seen: unknown[][] = []
    // 'listen' runs in input — BEFORE 'shout' within each tick — yet still
    // sees the previous tick's mail: delivery is the swap at #tick-end,
    // not system ordering.
    engine.scheduler.add(system('listen', 'input', (ctx) => seen.push([...ctx.events.read('ping')])))
    engine.scheduler.add(system('shout', 'simulate', (ctx) => ctx.events.emit('ping', ctx.tick)))

    engine.clock.advance(3.5 * FIXED, engine.stages())

    expect(seen).toEqual([[], [0], [1]])
    expect(engine.events.pendingCount()).toBe(0) // tick 2's mail was swapped in at its #tick-end
    expect(engine.events.read('ping')).toEqual([2]) // ...and would be read in tick 3
  })

  it('ctx.rng draws are deterministic: same seed, same systems, same numbers', () => {
    const draws = (): number[] => {
      const engine = createEngine({ world: createWorld({ settings: { seed: 99 } }) })
      const out: number[] = []
      engine.scheduler.add(system('roll', 'simulate', (ctx) => out.push(ctx.rng.next())))
      engine.clock.advance(5 * FIXED, engine.stages())
      return out
    }

    const first = draws()
    expect(first).toHaveLength(5)
    expect(draws()).toEqual(first) // exact — same floats, bit for bit
  })
})

describe('plugins', () => {
  function countingPlugin(name: string, seen: Engine[]): EnginePlugin {
    return { name, version: '1.0.0', register: (engine) => seen.push(engine) }
  }

  it('use() registers, passes the engine in, and chains', () => {
    const engine = createEngine()
    const seen: Engine[] = []

    const returned = engine.use(countingPlugin('tilemap', seen)).use(countingPlugin('physics', seen))

    expect(returned).toBe(engine)
    expect(seen).toEqual([engine, engine])
    expect(engine.plugins()).toEqual(['tilemap', 'physics'])
  })

  it('rejects a duplicate plugin name', () => {
    const engine = createEngine()
    const seen: Engine[] = []
    engine.use(countingPlugin('tilemap', seen))

    expect(() => engine.use(countingPlugin('tilemap', seen))).toThrow(/tilemap/)
    expect(seen).toHaveLength(1) // the second register never ran
  })

  it('a plugin can wire systems through the public API — no private door', () => {
    const engine = createEngine()
    const log: string[] = []
    engine.use({
      name: 'mover',
      version: '0.1.0',
      register: (e) => {
        e.registry.register({ name: 'velocity', defaults: () => ({ x: 0, y: 0 }) })
        e.scheduler.add(system('move', 'simulate', () => log.push('moved')))
      },
    })

    expect(engine.registry.has('velocity')).toBe(true)
    engine.clock.advance(FIXED, engine.stages())
    expect(log).toEqual(['moved'])
  })
})

describe('loadWorld', () => {
  it('re-seeds the rng deterministically: loading the same world twice replays the same draws', () => {
    const engine = createEngine() // default seed 1
    const before = [engine.rng.next(), engine.rng.next(), engine.rng.next()]

    engine.loadWorld(createWorld()) // same default seed
    const after = [engine.rng.next(), engine.rng.next(), engine.rng.next()]

    expect(after).toEqual(before) // a save file carries its luck with it
  })

  it('seeds from the NEW world settings and resets the engine tick, not the clock', () => {
    const engine = createEngine()
    engine.clock.advance(2 * FIXED, engine.stages())
    expect(engine.tick).toBe(2)
    expect(engine.clock.tick).toBe(2)

    engine.loadWorld(createWorld({ settings: { seed: 7 } }))

    expect(engine.tick).toBe(0)
    expect(engine.clock.tick).toBe(2) // the clock belongs to whoever pumps it
    expect(engine.rng.next()).toBe(createRng(7).next())
  })

  it('already-built stage lists simulate the CURRENT world after a swap', () => {
    const engine = createEngine()
    const namesSeen: string[] = []
    engine.scheduler.add(
      system('census', 'simulate', (ctx) => {
        namesSeen.push(...Object.values(ctx.world.entities).map((e) => e.name))
      }),
    )
    const stages = engine.stages() // captured BEFORE the swap

    const island = createWorld({ name: 'island' })
    spawn(island, { name: 'palm' })
    engine.loadWorld(island)
    engine.clock.advance(FIXED, stages)

    expect(namesSeen).toEqual(['palm']) // ctx was built at run time, against the live world
  })

  it('assigning engine.world is loadWorld by another name', () => {
    const engine = createEngine()
    engine.clock.advance(2 * FIXED, engine.stages())
    expect(engine.tick).toBe(2)

    const next = createWorld({ settings: { seed: 5 } })
    engine.world = next

    expect(engine.world).toBe(next)
    expect(engine.tick).toBe(0)
    expect(engine.rng.next()).toBe(createRng(5).next())
  })

  it("adopts the new world's fixedDt — the world file, not the machine, sets the cadence", () => {
    const engine = createEngine() // default fixedDt 1/60
    const dts: number[] = []
    engine.scheduler.add(system('probe', 'simulate', (ctx) => dts.push(ctx.dt)))
    expect(engine.clock.fixedDt).toBe(FIXED)

    engine.loadWorld(createWorld({ settings: { fixedDt: 0.1 } }))

    expect(engine.clock.fixedDt).toBe(0.1)
    // 0.25s of real time at 10 ticks/s is 2 ticks — a still-1/60 clock would
    // have run 5 (its per-advance cap). The cadence genuinely changed.
    expect(engine.clock.advance(0.25, engine.stages())).toBe(2)
    expect(engine.tick).toBe(2)
    expect(dts).toEqual([0.1, 0.1])
  })

  it("empties the mailboxes: the old world's delivered mail is unreadable on the new world's tick 0", () => {
    const engine = createEngine()
    const seen: unknown[][] = []
    engine.scheduler.add(system('listen', 'input', (ctx) => seen.push([...ctx.events.read('boom')])))

    engine.events.emit('boom', { target: 'e1' })
    engine.clock.advance(FIXED, engine.stages()) // #tick-end swaps: 'boom' is delivered mail now
    expect(engine.events.read('boom')).toEqual([{ target: 'e1' }])

    engine.loadWorld(createWorld())

    expect(engine.events.read('boom')).toEqual([]) // stale mail is gone, not waiting
    engine.clock.advance(FIXED, engine.stages()) // the new world's tick 0
    expect(seen).toEqual([[], []]) // tick 0 of EACH world read an empty mailbox
  })

  it('discards pending mail too: pendingCount() is 0 after loadWorld', () => {
    const engine = createEngine()
    engine.events.emit('ping', 1)
    expect(engine.events.pendingCount()).toBe(1)

    engine.loadWorld(createWorld())

    expect(engine.events.pendingCount()).toBe(0)
  })

  it('loading the same world twice gives identical first-tick reads, whatever was emitted before', () => {
    const firstTickReads = (preload: (engine: Engine) => void): unknown[] => {
      const engine = createEngine()
      const out: unknown[] = []
      engine.scheduler.add(system('listen', 'input', (ctx) => out.push(...ctx.events.read('ping'))))
      preload(engine)
      engine.loadWorld(createWorld({ settings: { seed: 3 } }))
      engine.clock.advance(FIXED, engine.stages())
      return out
    }

    const quiet = firstTickReads(() => {})
    const noisy = firstTickReads((engine) => {
      engine.events.emit('ping', 'becomes delivered mail')
      engine.events.swap()
      engine.events.emit('ping', 'stays pending mail')
    })

    expect(quiet).toEqual([])
    expect(noisy).toEqual(quiet) // pre-load emissions leave no trace
  })
})
