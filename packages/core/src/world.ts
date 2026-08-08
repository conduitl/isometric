/*
 * The World — one big, readable spreadsheet of everything in the game.
 *
 * ## Entities are rows, components are columns, systems are verbs
 *
 * That sentence is the whole data model, and it is a taught lesson, not a
 * slogan. Picture a spreadsheet:
 *
 * - Each ENTITY is a row — one thing in the world, with an id and a name.
 * - Each COMPONENT is a column — a named bag of plain data like
 *   `position: { x: 3, y: 4 }`. A row only fills in the columns it needs;
 *   a decorative rock has `position` but no `velocity`.
 * - Each SYSTEM (see scheduler.ts) is a verb — a function that walks the rows
 *   having certain columns and does one job: "move everything with a position
 *   and a velocity".
 *
 * There is no Entity class and no inheritance tree. An entity is a plain JSON
 * object you can `console.log` and read out loud — that is the glass-box
 * promise. What an entity IS is exactly the sum of what its columns SAY.
 *
 * ## Two decisions worth pausing on
 *
 * 1. **Ids are monotonic and never recycled.** Entities are named "e1", "e2",
 *    "e3"… by a counter (`nextEntityId`) that only ever counts up — despawning
 *    e2 does NOT let a later spawn become a different e2. Editor selection,
 *    undo patches, and tutorial checks all remember entities by id; a recycled
 *    id would silently point them at a stranger. The counter is saved in the
 *    world file so identity survives save/load too. (This is a declared
 *    one-way door — see docs/ARCHITECTURE.md §3.)
 *
 * 2. **In memory, entities live in a Record keyed by id** — not an array.
 *    Undo works by recording patches with paths like `entities.e42.name`, and
 *    an id-keyed path stays correct no matter what was created or deleted in
 *    between. An array index would shift under those patches. The serialized
 *    FILE stores entities as a sorted array instead; @engine/world-format
 *    converts at that boundary.
 *
 * A Record has no built-in order, so `entityIds()` defines THE iteration
 * order for the whole engine: ascending by the number in the id. Every system
 * and query walks entities in that order, which is one of the small,
 * deliberate choices that make two runs of the same world identical.
 *
 * Everything in a World is JSON-serializable plain data, with one deliberate
 * exception: tile layer cells are a Uint16Array (a flat, memory-cheap grid of
 * numbers), converted to a plain array only at the file boundary.
 */

/**
 * An entity's id: the letter 'e' followed by a counter — "e1", "e2", "e42".
 * Ids are handed out in spawn order and NEVER reused, even after despawn.
 */
export type EntityId = string

/**
 * One row of the spreadsheet. `components` is the row's filled-in columns:
 * a plain record from column name to plain data. Log one and you can read
 * exactly what it is — nothing hides in a class or a closure.
 */
export interface Entity {
  readonly id: EntityId
  name: string
  components: Record<string, unknown>
}

/**
 * Per-world knobs that shape simulation and display: the size of one tile in
 * world units, which projection the world was authored for (alternate views
 * render as schematic "X-ray" lenses), the fixed simulation timestep in
 * seconds (see clock.ts for why it is fixed), and the seed that makes this
 * world's randomness repeatable.
 */
export interface WorldSettings {
  tileSize: number
  primaryProjection: 'profile' | 'topdown' | 'iso'
  fixedDt: number
  seed: number
}

/** Identity of the world document itself: a stable id plus a human name. */
export interface WorldMeta {
  worldId: string
  name: string
}

/**
 * One kind of tile, drawn procedurally from named colors: `top` is the face
 * you see from above (and the diamond top in iso); `left`/`right` are the iso
 * side faces of raised tiles; `side` is the edge-on slab color in profile
 * view. Only `top` is required — the renderer picks sensible fallbacks.
 */
export interface TileDef {
  name: string
  colors: { top: string; left?: string; right?: string; side?: string }
}

/**
 * A palette of tiles. Cell values in a layer index into `tiles` OFF BY ONE:
 * cell value N > 0 means `tiles[N - 1]`, because 0 is reserved for "empty".
 * (A grid full of zeroes is a blank map — that convention is worth the
 * one-based shift.)
 */
export interface Tileset {
  id: string
  name: string
  tiles: TileDef[]
}

/**
 * A rectangular grid of tiles at one elevation. `cells` is a flat row-major
 * Uint16Array: the cell at (x, y) lives at index `y * width + x` — a formula
 * taught on purpose (see @engine/tilemap). `layerBand` groups layers for
 * depth sorting: everything in band 0 draws behind everything in band 1,
 * regardless of within-layer depth.
 *
 * The Uint16Array is the World's one exception to "JSON everywhere": 65,536
 * tile kinds is plenty, and two bytes per cell keeps even a 256×256 layer
 * at 128 KB. @engine/world-format converts to a plain array in the file.
 */
export interface TileLayer {
  id: string
  name: string
  width: number
  height: number
  elevation: number
  layerBand: number
  tilesetId: string
  cells: Uint16Array
}

/**
 * The whole world document: identity, settings, the entity spreadsheet (plus
 * the counter that names new rows), and the tile terrain. This one object is
 * what gets saved, loaded, undone, and inspected — there is no hidden state
 * beside it.
 */
export interface World {
  meta: WorldMeta
  settings: WorldSettings
  nextEntityId: number
  entities: Record<EntityId, Entity>
  tilesets: Tileset[]
  layers: TileLayer[]
}

/**
 * Build an empty world. Defaults: 1-unit tiles, top-down projection, 60 ticks
 * per second, seed 1, named 'untitled world'.
 *
 * The world id is derived from the seed ('w' + seed) rather than from the
 * wall clock or a random generator — creating a world is itself deterministic,
 * so tests and tutorials can predict every field of a fresh document.
 */
export function createWorld(options: { name?: string; settings?: Partial<WorldSettings> } = {}): World {
  const settings: WorldSettings = {
    tileSize: 1,
    primaryProjection: 'topdown',
    fixedDt: 1 / 60,
    seed: 1,
    ...options.settings,
  }
  return {
    meta: { worldId: `w${settings.seed}`, name: options.name ?? 'untitled world' },
    settings,
    nextEntityId: 1,
    entities: {},
    tilesets: [],
    layers: [],
  }
}

/**
 * Add a row to the spreadsheet: mint the next id, bump the counter, store the
 * entity, hand it back. The name defaults to the id itself, so even a bare
 * `spawn(world)` produces something legible in the console.
 *
 * The components record is copied shallowly, so the caller's init object can
 * be reused or mutated without reaching into the world behind its back. The
 * component VALUES are shared — they are plain data owned by the world from
 * here on.
 */
export function spawn(world: World, init: { name?: string; components?: Record<string, unknown> } = {}): Entity {
  const id: EntityId = `e${world.nextEntityId}`
  world.nextEntityId += 1
  const entity: Entity = {
    id,
    name: init.name ?? id,
    components: { ...init.components },
  }
  world.entities[id] = entity
  return entity
}

/**
 * Remove a row. Returns false when no such entity exists (already despawned,
 * or never spawned) so callers can tell "removed it" from "nothing there".
 * The id is retired forever — `nextEntityId` never rewinds.
 */
export function despawn(world: World, id: EntityId): boolean {
  if (!Object.hasOwn(world.entities, id)) return false
  delete world.entities[id]
  return true
}

/** Look up one entity by id, or undefined if it does not exist. */
export function getEntity(world: World, id: EntityId): Entity | undefined {
  return world.entities[id]
}

/**
 * The shape of every engine-minted id: the letter 'e' then digits. Ids that
 * do NOT match — a hand-edited file might contain 'player' or 'e1e3' — are
 * still legal entities; they just sort by a different rule below.
 */
const POLICY_ID = /^e[0-9]+$/

/**
 * THE total order on entity ids, shared by everything that walks the
 * spreadsheet — and by @engine/world-format when it sorts the file's entity
 * array. One comparator, one order, everywhere.
 *
 * The rule is a tuple: first "is it a policy id?", then the tie-breaker
 * within each group.
 *
 * 1. Policy ids ('e' + digits: 'e1', 'e42') sort NUMERICALLY among
 *    themselves — e2 before e10, which plain text sorting gets wrong.
 * 2. Every policy id sorts BEFORE every non-policy id.
 * 3. Non-policy ids ('player', 'e1e3', anything else) sort by plain string
 *    comparison among themselves.
 *
 * Why the two groups, instead of "parse a number when you can and fall back
 * to text"? Transitivity. A comparator that judges some PAIRS numerically
 * and others textually can rank a before b, b before c, yet c before a — and
 * a sort fed a self-contradicting comparator returns an order that depends
 * on the input's arrangement. The tuple rule cannot contradict itself, so
 * the order is a property of the data alone.
 */
export function compareEntityIds(a: string, b: string): number {
  const aPolicy = POLICY_ID.test(a)
  const bPolicy = POLICY_ID.test(b)
  if (aPolicy !== bPolicy) return aPolicy ? -1 : 1
  if (aPolicy) return Number(a.slice(1)) - Number(b.slice(1))
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Every entity id, in {@link compareEntityIds} order. This is THE
 * deterministic iteration order: every query, every system, every serializer
 * walks entities in this order and no other. JavaScript objects do have an
 * inherited key order, but it depends on insertion history; sorting by the
 * shared comparator makes the order a property of the DATA, so a world built
 * live and the same world loaded from a file iterate identically.
 */
export function entityIds(world: World): EntityId[] {
  return Object.keys(world.entities).sort(compareEntityIds)
}

/**
 * The spreadsheet filter: all entities that have EVERY named column, in
 * entityIds() order. `query(world, 'position', 'velocity')` is how a movement
 * system finds its rows. With no names it returns every entity (all rows pass
 * an empty filter).
 *
 * A component counts as present when its KEY exists — even if its value is
 * still the empty object `{}`. Presence of the column, not richness of the
 * data, is what systems select on.
 */
export function query(world: World, ...componentNames: string[]): Entity[] {
  const found: Entity[] = []
  for (const id of entityIds(world)) {
    const entity = world.entities[id]
    if (entity === undefined) continue
    if (componentNames.every((name) => Object.hasOwn(entity.components, name))) {
      found.push(entity)
    }
  }
  return found
}
