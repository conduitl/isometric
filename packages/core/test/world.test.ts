import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/registry'
import { compareEntityIds, createWorld, despawn, entityIds, getEntity, query, spawn } from '../src/world'

/** Every ordering of a (small) list — for proving a sort ignores its input arrangement. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  const out: T[][] = []
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const tail of permutations(rest)) {
      out.push([items[i] as T, ...tail])
    }
  }
  return out
}

describe('createWorld', () => {
  it('builds an empty world with the documented defaults', () => {
    const world = createWorld()
    expect(world.settings).toEqual({ tileSize: 1, primaryProjection: 'topdown', fixedDt: 1 / 60, seed: 1 })
    expect(world.meta).toEqual({ worldId: 'w1', name: 'untitled world' })
    expect(world.nextEntityId).toBe(1)
    expect(world.entities).toEqual({})
    expect(world.tilesets).toEqual([])
    expect(world.layers).toEqual([])
  })

  it('merges partial settings over the defaults', () => {
    const world = createWorld({ name: 'island', settings: { seed: 42, primaryProjection: 'iso' } })
    expect(world.meta.name).toBe('island')
    expect(world.settings.seed).toBe(42)
    expect(world.settings.primaryProjection).toBe('iso')
    expect(world.settings.tileSize).toBe(1) // untouched default
    expect(world.settings.fixedDt).toBe(1 / 60)
  })

  it('derives worldId from the seed — no wall-clock entropy anywhere', () => {
    expect(createWorld({ settings: { seed: 42 } }).meta.worldId).toBe('w42')
    // Two identical calls produce identical documents, field for field.
    expect(createWorld({ settings: { seed: 7 } })).toEqual(createWorld({ settings: { seed: 7 } }))
  })
})

describe('spawn / despawn / getEntity', () => {
  it('mints monotonic ids and bumps nextEntityId', () => {
    const world = createWorld()
    expect(spawn(world).id).toBe('e1')
    expect(spawn(world).id).toBe('e2')
    expect(spawn(world).id).toBe('e3')
    expect(world.nextEntityId).toBe(4)
  })

  it('never recycles an id across despawn/spawn', () => {
    const world = createWorld()
    spawn(world) // e1
    const victim = spawn(world) // e2
    spawn(world) // e3

    expect(despawn(world, victim.id)).toBe(true)
    const next = spawn(world)

    // The freed 'e2' is retired forever: selection, undo patches, and
    // tutorial predicates that remembered e2 must never meet a stranger.
    expect(next.id).toBe('e4')
    expect(getEntity(world, 'e2')).toBeUndefined()
    expect(world.nextEntityId).toBe(5)
  })

  it('defaults the name to the id, so a bare spawn is still console-legible', () => {
    const world = createWorld()
    expect(spawn(world).name).toBe('e1')
    expect(spawn(world, { name: 'player' }).name).toBe('player')
  })

  it('despawn reports whether anything was removed', () => {
    const world = createWorld()
    const e = spawn(world)
    expect(despawn(world, 'e99')).toBe(false)
    expect(despawn(world, e.id)).toBe(true)
    expect(despawn(world, e.id)).toBe(false) // already gone
  })

  it('copies the components record so the init object is not aliased', () => {
    const world = createWorld()
    const init = { position: { x: 0, y: 0 } }
    const entity = spawn(world, { components: init })

    // Adding a key to the caller's record must not grow the entity.
    ;(init as Record<string, unknown>)['velocity'] = { x: 1, y: 0 }
    expect(Object.keys(entity.components)).toEqual(['position'])
  })

  it('an entity is plain JSON a 12-year-old can read in the console', () => {
    const world = createWorld()
    const entity = spawn(world, {
      name: 'player',
      components: { position: { x: 3, y: 4 }, elevation: { z: 0 } },
    })
    expect(JSON.parse(JSON.stringify(entity))).toEqual(entity)
  })
})

describe('entityIds — THE deterministic iteration order', () => {
  it('sorts by the numeric suffix: e2 before e10', () => {
    const world = createWorld()
    for (let i = 0; i < 12; i += 1) spawn(world)

    // Plain string sorting would yield e1, e10, e11, e12, e2, ... — wrong.
    expect(entityIds(world)).toEqual([
      'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12',
    ])
  })

  it('order is a property of the data, not of insertion history', () => {
    // Simulate a loaded world whose record was built in scrambled order.
    const world = createWorld()
    for (const n of [10, 2, 33, 1]) {
      world.entities[`e${n}`] = { id: `e${n}`, name: `e${n}`, components: {} }
    }
    world.nextEntityId = 34
    expect(entityIds(world)).toEqual(['e1', 'e2', 'e10', 'e33'])
  })
})

describe('compareEntityIds — the shared total order', () => {
  it('policy ids sort numerically among themselves, and always before non-policy ids', () => {
    expect(compareEntityIds('e2', 'e10')).toBeLessThan(0) // numeric, not textual
    expect(compareEntityIds('e10', 'e2')).toBeGreaterThan(0)
    expect(compareEntityIds('e999', 'aardvark')).toBeLessThan(0) // policy first, even against earlier letters
    expect(compareEntityIds('apple', 'banana')).toBeLessThan(0) // plain string order among non-policy
  })

  it("'e1e3' is NOT a policy id — it sorts after every policy id, by string order", () => {
    expect(compareEntityIds('e1e3', 'e999')).toBeGreaterThan(0)
    expect(compareEntityIds('e1e3', 'player')).toBeLessThan(0) // 'e...' < 'p...' as text
  })

  it('is permutation-invariant over a mixed id set — no non-transitive surprises', () => {
    const expected = ['e2', 'e10', 'e1e3', 'player']
    for (const arrangement of permutations(['e1e3', 'player', 'e2', 'e10'])) {
      expect([...arrangement].sort(compareEntityIds)).toEqual(expected)
    }
  })

  it('entityIds uses it: mixed hand-edited ids iterate identically regardless of insertion order', () => {
    const build = (order: string[]): string[] => {
      const world = createWorld()
      for (const id of order) {
        world.entities[id] = { id, name: id, components: {} }
      }
      return entityIds(world)
    }

    expect(build(['player', 'e2', 'e1e3', 'e10'])).toEqual(['e2', 'e10', 'e1e3', 'player'])
    expect(build(['e10', 'e1e3', 'e2', 'player'])).toEqual(['e2', 'e10', 'e1e3', 'player'])
  })
})

describe('query — the spreadsheet filter', () => {
  it('returns entities having ALL named components, in entityIds order', () => {
    const world = createWorld()
    spawn(world, { components: { position: { x: 0, y: 0 } } }) // e1: position only
    spawn(world, { components: { position: { x: 1, y: 1 }, velocity: { x: 1, y: 0 } } }) // e2: both
    spawn(world, { components: { velocity: { x: 0, y: 1 } } }) // e3: velocity only
    spawn(world, { components: { position: { x: 2, y: 2 }, velocity: { x: 0, y: 0 } } }) // e4: both

    expect(query(world, 'position').map((e) => e.id)).toEqual(['e1', 'e2', 'e4'])
    expect(query(world, 'position', 'velocity').map((e) => e.id)).toEqual(['e2', 'e4'])
    expect(query(world, 'position', 'velocity', 'sprite')).toEqual([])
  })

  it('with no component names, every row passes the empty filter', () => {
    const world = createWorld()
    spawn(world)
    spawn(world)
    expect(query(world).map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('keeps numeric id order even past e9', () => {
    const world = createWorld()
    for (let i = 0; i < 11; i += 1) spawn(world, { components: { tag: {} } })
    const ids = query(world, 'tag').map((e) => e.id)
    expect(ids.indexOf('e2')).toBeLessThan(ids.indexOf('e10'))
    expect(ids).toHaveLength(11)
  })

  it('presence of the column is what counts, even with an empty value', () => {
    const world = createWorld()
    spawn(world, { components: { frozen: {} } })
    expect(query(world, 'frozen').map((e) => e.id)).toEqual(['e1'])
  })
})

describe('component registry', () => {
  it('registers, looks up, and lists definitions in registration order', () => {
    const registry = createRegistry()
    registry.register({ name: 'position', defaults: () => ({ x: 0, y: 0 }) })
    registry.register({
      name: 'velocity',
      defaults: () => ({ x: 0, y: 0 }),
      meta: { unit: 'units/second', description: 'How position changes each second' },
    })

    expect(registry.has('position')).toBe(true)
    expect(registry.has('sprite')).toBe(false)
    expect(registry.get('velocity')?.meta?.unit).toBe('units/second')
    expect(registry.get('sprite')).toBeUndefined()
    expect(registry.names()).toEqual(['position', 'velocity'])
  })

  it('throws on a duplicate name — two definitions must not fight over one column', () => {
    const registry = createRegistry()
    registry.register({ name: 'position', defaults: () => ({ x: 0, y: 0 }) })
    expect(() => registry.register({ name: 'position', defaults: () => ({ x: 9, y: 9 }) })).toThrow(/position/)
  })

  it('defaults() returns a FRESH object every call — no shared-state aliasing', () => {
    const registry = createRegistry()
    registry.register({ name: 'position', defaults: () => ({ x: 0, y: 0 }) })

    const def = registry.get('position')
    expect(def).toBeDefined()
    const a = def?.defaults() as { x: number; y: number }
    const b = def?.defaults() as { x: number; y: number }

    expect(a).toEqual(b)
    expect(a).not.toBe(b) // distinct objects: mutating one entity's default must not move another's
    a.x = 99
    expect(b.x).toBe(0)
  })

  it('validate speaks student, not validator jargon', () => {
    const registry = createRegistry()
    registry.register({
      name: 'health',
      defaults: () => ({ current: 10, max: 10 }),
      validate: (value) => {
        const health = value as { current?: unknown; max?: unknown }
        if (typeof health?.current !== 'number' || typeof health?.max !== 'number') {
          return 'health needs two numbers: current and max'
        }
        return null
      },
    })

    const def = registry.get('health')
    expect(def?.validate?.({ current: 5, max: 10 })).toBeNull()
    expect(def?.validate?.({ current: 'full' })).toBe('health needs two numbers: current and max')
  })
})
