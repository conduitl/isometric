/*
 * Reading world files defensively — because real files come from real kids.
 *
 * A world file arriving here may have been truncated by a full disk, synced
 * halfway by a flaky classroom network, or lovingly hand-edited by its
 * ten-year-old owner (we ENCOURAGE that — the glass box is the product).
 * So the loader is a ladder of ever-stricter checks, and every rung that can
 * fail produces a diagnosis a student can act on. A raw TypeError escaping
 * this file is a bug by definition (docs/RISKS.md).
 *
 * The ladder, top to bottom:
 *
 *   1. Is it JSON at all?                        → 'not-json'
 *   2. Is it one { … } object?                   → 'not-an-object'
 *   3. Does it say which format version it is?   → 'invalid-structure'
 *   4. Is that version from the future?          → 'newer-version'
 *   5. Climb the migration chain, one pure
 *      function per released version, each
 *      checking its input's minimal shape        → 'migration-failed'
 *   6. Validate the final shape properly          → 'invalid-structure'
 *   7. Build the in-memory World (cells become
 *      Uint16Array, the entities array becomes
 *      an id-keyed record).
 *
 * MIGRATIONS are the time machine: migrations[n] upgrades a version-n
 * document to version n+1, and old steps are never edited once released —
 * only new steps are appended. A file saved in 2026 must still open in 2036,
 * whatever the engine looks like by then (docs/DECISIONS.md D1).
 *
 * SALVAGE is the emergency room: when strict parsing fails, salvageWorld
 * keeps every individually-healthy entity and layer, repairs what it safely
 * can (a cells list cut short is padded with empty tiles), and reports every
 * loss in student language — "2 objects couldn't be read and were left out",
 * never a stack trace.
 *
 * UNKNOWN KEYS have two fates, and both are policy (docs/DECISIONS.md D1):
 * inside an entity's components they are opaque blobs that round-trip
 * byte-for-byte — the format's one extension point. Everywhere else (the top
 * level, meta, settings, and each tileset/layer/entity) an unknown key is
 * DROPPED on the next save; the loader says so up front with one warning per
 * location, naming each doomed field and pointing at components as the place
 * where custom data actually survives.
 */

import { compareEntityIds } from '@engine/core'
import type { Entity, EntityId, TileLayer, Tileset, World, WorldSettings } from '@engine/core'
import {
  FORMAT_VERSION,
  defaultWorldSettings,
  describeValue,
  entitySchema,
  knownKeys,
  layerBaseSchema,
  metaSchema,
  settingsFieldSchemas,
  tilesetSchema,
  translateZodError,
  worldDocSchema,
} from './schema'
import type { ParsedEntity, ParsedLayerBase, ParsedTileset, WorldDocV1 } from './schema'
import { entityIdNumber } from './serialize'

/**
 * Why a load failed. `message` is written for the person who owns the file —
 * a curious kid, ages 10 and up — and always suggests where to look or what
 * to do. `technical` carries the unvarnished details (parser output, issue
 * codes) for bug reports and grown-ups; it never appears in `message`.
 */
export interface LoadError {
  code: 'not-json' | 'not-an-object' | 'newer-version' | 'invalid-structure' | 'migration-failed'
  message: string
  technical?: string
}

/**
 * The outcome of parseWorld: a world plus non-fatal warnings (unknown
 * components kept as blobs, a repaired nextEntityId), or one LoadError.
 */
export type LoadResult =
  | { ok: true; world: World; warnings: string[] }
  | { ok: false; error: LoadError }

/**
 * Component names this version of the engine understands. Unknown names are
 * NOT errors — they are kept verbatim and written back untouched (a newer
 * app version or a plugin probably owns them). The list exists only so the
 * loader can give a heads-up naming them; real component validation belongs
 * to the runtime schema registry in @engine/core, not to the file format.
 *
 * This list must track what actually gets REGISTERED, nothing more: today
 * that is position/elevation/marker (the established app's components) and
 * tilePosition (registered by @engine/tilemap's tilemapPlugin). A name
 * listed here that nothing registers would silence the heads-up for a
 * component that is, in truth, unknown.
 */
const KNOWN_COMPONENT_NAMES: ReadonlySet<string> = new Set([
  'position',
  'elevation',
  'marker',
  'tilePosition',
])

// ---------------------------------------------------------------------------
// Migrations — one pure function per released format version
// ---------------------------------------------------------------------------

/**
 * Thrown inside a migration step when its input doesn't have the minimal
 * shape that version promised. The message is written in student language;
 * the runner wraps it into a 'migration-failed' LoadError untouched.
 */
class MigrationProblem extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * v0 → v1. Version 0 is the synthetic pre-release format: entities carried
 * plain NUMERIC ids and layers had no layerBand. This step renames id 7 to
 * "e7", computes nextEntityId as one past the biggest id (ids are monotonic
 * and never recycled — docs/DECISIONS.md D2), and gives every layer
 * layerBand 0. It exists partly to upgrade genuinely old files and partly so
 * the migration runner is exercised by a REAL step from day one.
 */
function migrateV0ToV1(doc: Record<string, unknown>): Record<string, unknown> {
  const rawEntities = doc.entities ?? []
  if (!Array.isArray(rawEntities)) {
    throw new MigrationProblem(`the old world's "entities" should be a list, but it's ${describeValue(rawEntities)}`)
  }

  let maxId = 0
  const entities = rawEntities.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new MigrationProblem(`object #${index + 1} in this old world isn't an { … } object — it's ${describeValue(raw)}`)
    }
    const id = raw.id
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) {
      throw new MigrationProblem(
        `object #${index + 1} should have a plain number id (old worlds used numbers), but it has ${describeValue(id)}`,
      )
    }
    maxId = Math.max(maxId, id)
    return { ...raw, id: `e${id}` }
  })

  const rawLayers = doc.layers ?? []
  if (!Array.isArray(rawLayers)) {
    throw new MigrationProblem(`the old world's "layers" should be a list, but it's ${describeValue(rawLayers)}`)
  }
  const layers = rawLayers.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new MigrationProblem(`layer #${index + 1} in this old world isn't an { … } object — it's ${describeValue(raw)}`)
    }
    return Number.isInteger(raw.layerBand) ? { ...raw } : { ...raw, layerBand: 0 }
  })

  const computedNext = maxId + 1
  const existingNext = doc.nextEntityId
  const nextEntityId =
    typeof existingNext === 'number' && Number.isInteger(existingNext) && existingNext > computedNext
      ? existingNext
      : computedNext

  return {
    ...doc,
    formatVersion: 1,
    nextEntityId,
    tilesets: Array.isArray(doc.tilesets) ? doc.tilesets : [],
    layers,
    entities,
  }
}

/**
 * The ordered migration chain: migrations[n] upgrades a version-n document
 * to version n+1. Steps are pure (fresh objects out, inputs untouched) and,
 * once released, frozen forever — new versions only APPEND to this array.
 */
export const migrations: ReadonlyArray<(doc: Record<string, unknown>) => Record<string, unknown>> = [
  migrateV0ToV1,
]

// ---------------------------------------------------------------------------
// parseWorld — the strict ladder
// ---------------------------------------------------------------------------

function failure(code: LoadError['code'], message: string, technical?: string): LoadResult {
  return technical === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, technical } }
}

/**
 * Parses world-file text into a World, or explains — kindly — why it can't.
 * Never throws; every failure mode is a LoadResult with a student-legible
 * message (see the ladder in the file header).
 */
export function parseWorld(text: string): LoadResult {
  if (text.trim() === '') {
    return failure('not-json', "This file is empty — there's no world inside it to load.")
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return failure(
      'not-json',
      "This file doesn't look like a world file — it isn't valid JSON. " +
        'If you edited it by hand, look for a missing quote, comma, or bracket. ' +
        "If it was copied or synced, the copy may not have finished — try Salvage to rescue what's readable.",
      err instanceof Error ? err.message : String(err),
    )
  }

  if (!isRecord(raw)) {
    return failure(
      'not-an-object',
      "This file is valid JSON, but it isn't a world — a world file is one { … } object " +
        `with meta, settings, layers, and entities inside. This file's top level is ${describeValue(raw)}.`,
    )
  }

  const version = raw.formatVersion
  if (version === undefined) {
    return failure(
      'invalid-structure',
      'This file never says which world-format version it is. Every world file needs a line like ' +
        '"formatVersion": 1 near the top — if the rest of the file looks healthy, adding that line may fix it.',
    )
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return failure(
      'invalid-structure',
      `The file's "formatVersion" should be a whole number like 1, but it's ${describeValue(version)}.`,
    )
  }
  if (version > FORMAT_VERSION) {
    return failure(
      'newer-version',
      'This world was saved by a NEWER version of this app — it uses world-format ' +
        `${version}, and this app can only read up to ${FORMAT_VERSION}. The world itself is fine: ` +
        'update the app, then open it again.',
      `file formatVersion ${version} > supported ${FORMAT_VERSION}`,
    )
  }

  let doc: Record<string, unknown> = raw
  for (let from = version; from < FORMAT_VERSION; from += 1) {
    const step = migrations[from]
    if (step === undefined) {
      return failure(
        'migration-failed',
        `This file says it is world-format ${from}, and this app has no upgrade path from there. ` +
          'It may come from a very old test build — ask for help rescuing it.',
      )
    }
    try {
      doc = step(doc)
    } catch (err) {
      const detail =
        err instanceof MigrationProblem ? err.message : "something inside had a shape the upgrader didn't expect"
      return failure(
        'migration-failed',
        `While upgrading this world from format ${from} to ${from + 1}: ${detail}. ` +
          'Nothing was changed on disk — the original file is untouched.',
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      )
    }
  }

  const checked = worldDocSchema.safeParse(doc)
  if (!checked.success) {
    const translated = translateZodError(checked.error, doc)
    return failure('invalid-structure', translated.message, translated.technical)
  }

  const warnings: string[] = []
  const world = buildWorld(checked.data, warnings)
  warnUnknownKeys(doc, warnings)
  return { ok: true, world, warnings }
}

// ---------------------------------------------------------------------------
// The unknown-key policy, made visible
// ---------------------------------------------------------------------------

/**
 * Diffs the raw document's keys against the schema's known keys (schema.ts's
 * `knownKeys`) and pushes ONE warning per location naming the fields that
 * will not survive a save. This is the loud half of a deliberate policy:
 * outside components, unknown keys are stripped by validation — a hand-added
 * "difficulty": 3 at the top level would otherwise vanish on the next save
 * with nobody the wiser. Inside components, custom data round-trips
 * untouched, which is exactly what the warning suggests.
 */
function warnUnknownKeys(doc: Record<string, unknown>, warnings: string[]): void {
  const check = (where: string, value: unknown, known: ReadonlySet<string>): void => {
    if (!isRecord(value)) return
    const extras = Object.keys(value).filter((key) => !known.has(key))
    if (extras.length === 0) return
    const names = extras
      .sort()
      .map((n) => `"${n}"`)
      .join(', ')
    warnings.push(
      extras.length === 1
        ? `This file has an extra field at ${where} this app doesn't know: ${names}. It will NOT survive the next save — custom data only round-trips inside an object's components, so move it into a component to keep it.`
        : `This file has ${extras.length} extra fields at ${where} this app doesn't know: ${names}. They will NOT survive the next save — custom data only round-trips inside an object's components, so move them into a component to keep them.`,
    )
  }

  check('the top of the file', doc, knownKeys.topLevel)
  check('meta', doc.meta, knownKeys.meta)
  check('settings', doc.settings, knownKeys.settings)
  if (Array.isArray(doc.tilesets)) {
    doc.tilesets.forEach((tileset, index) => check(`tilesets → #${index + 1}`, tileset, knownKeys.tileset))
  }
  if (Array.isArray(doc.layers)) {
    doc.layers.forEach((layer, index) => check(`layers → #${index + 1}`, layer, knownKeys.layer))
  }
  if (Array.isArray(doc.entities)) {
    doc.entities.forEach((entity, index) => check(`entities → #${index + 1}`, entity, knownKeys.entity))
  }
}

// ---------------------------------------------------------------------------
// Building the in-memory World from a validated document
// ---------------------------------------------------------------------------

function toTileset(parsed: ParsedTileset): Tileset {
  return {
    id: parsed.id,
    name: parsed.name,
    tiles: parsed.tiles.map((tile) => {
      const colors: Tileset['tiles'][number]['colors'] = { top: tile.colors.top }
      if (tile.colors.left !== undefined) colors.left = tile.colors.left
      if (tile.colors.right !== undefined) colors.right = tile.colors.right
      if (tile.colors.side !== undefined) colors.side = tile.colors.side
      return { name: tile.name, colors }
    }),
  }
}

function toLayer(parsed: ParsedLayerBase, cells: ReadonlyArray<number>): TileLayer {
  return {
    id: parsed.id,
    name: parsed.name,
    width: parsed.width,
    height: parsed.height,
    elevation: parsed.elevation,
    layerBand: parsed.layerBand,
    tilesetId: parsed.tilesetId,
    // The file keeps plain numbers (ordinary JSON); in memory, cells live in
    // a Uint16Array — the one deliberate exception to JSON-everywhere,
    // made for tile-painting speed (docs/ARCHITECTURE.md §3).
    cells: Uint16Array.from(cells),
  }
}

function toEntityRecord(entities: ReadonlyArray<ParsedEntity>): Record<EntityId, Entity> {
  // The file holds an array; memory holds an id-keyed record (undo patch
  // paths stay id-stable that way — docs/ARCHITECTURE.md §6). Insertion
  // happens in entityIds() order so plain Object.keys walks are deterministic.
  const sorted = entities.slice().sort((a, b) => compareEntityIds(a.id, b.id))
  const record: Record<EntityId, Entity> = {}
  for (const entity of sorted) {
    record[entity.id] = { id: entity.id, name: entity.name, components: entity.components }
  }
  return record
}

function maxEntitySuffix(ids: ReadonlyArray<string>): number {
  let max = 0
  for (const id of ids) {
    const n = entityIdNumber(id)
    if (!Number.isNaN(n) && n > max) max = n
  }
  return max
}

function buildWorld(data: WorldDocV1, warnings: string[]): World {
  const entities = toEntityRecord(data.entities)
  const ids = Object.keys(entities)

  // Heads-up (not an error): components we don't recognize round-trip as
  // opaque blobs. One warning, naming names, so nobody is surprised later.
  const unknown = new Set<string>()
  for (const id of ids) {
    for (const name of Object.keys(entities[id]?.components ?? {})) {
      if (!KNOWN_COMPONENT_NAMES.has(name)) unknown.add(name)
    }
  }
  if (unknown.size > 0) {
    const names = [...unknown].sort().map((n) => `"${n}"`).join(', ')
    warnings.push(
      unknown.size === 1
        ? `This world uses a component this app doesn't know yet: ${names}. It was kept exactly as saved and will write back untouched.`
        : `This world uses ${unknown.size} components this app doesn't know yet: ${names}. They were kept exactly as saved and will write back untouched.`,
    )
  }

  // nextEntityId must stay ahead of every id ever handed out — ids are never
  // recycled (docs/DECISIONS.md D2). A hand-edited file can break that
  // quietly, so it is repaired here with a warning instead of trusted.
  const maxSuffix = maxEntitySuffix(ids)
  let nextEntityId = data.nextEntityId
  if (nextEntityId <= maxSuffix) {
    warnings.push(
      `This file's nextEntityId (${nextEntityId}) was too small for its biggest object id ("e${maxSuffix}"), ` +
        `so it was raised to ${maxSuffix + 1} — new objects must get ids nobody has used before.`,
    )
    nextEntityId = maxSuffix + 1
  }

  const tilesets = data.tilesets.map(toTileset)
  const tilesetIds = new Set(tilesets.map((tileset) => tileset.id))
  const layers = data.layers.map((layer) => toLayer(layer, layer.cells))
  for (const layer of layers) {
    if (!tilesetIds.has(layer.tilesetId)) {
      warnings.push(
        `Layer "${layer.name}" points at a tileset ("${layer.tilesetId}") that isn't in this file — its tiles may draw as blanks.`,
      )
    }
  }

  return {
    meta: { worldId: data.meta.worldId, name: data.meta.name },
    settings: {
      tileSize: data.settings.tileSize,
      primaryProjection: data.settings.primaryProjection,
      fixedDt: data.settings.fixedDt,
      seed: data.settings.seed,
    },
    nextEntityId,
    entities,
    tilesets,
    layers,
  }
}

// ---------------------------------------------------------------------------
// Salvage — the emergency room
// ---------------------------------------------------------------------------

/**
 * Best-effort recovery for a file parseWorld rejected. Keeps every
 * individually-valid entity, layer, and tileset; repairs what it safely can
 * (settings fall back field by field, a cells list cut short is padded with
 * empty tiles); and reports every loss in student language. Returns null
 * only when nothing at all is recoverable — and never throws.
 */
export function salvageWorld(text: string): { world: World; report: string[] } | null {
  const report: string[] = []

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    const repaired = repairTruncatedJson(text)
    if (repaired === null) return null
    raw = repaired.doc
    report.push('The end of this file was damaged, so everything after the last readable part was set aside.')
  }
  if (!isRecord(raw)) return null

  let doc: Record<string, unknown> = raw
  const version = doc.formatVersion
  if (typeof version === 'number' && Number.isInteger(version)) {
    if (version >= 0 && version < FORMAT_VERSION) {
      try {
        for (let from = version; from < FORMAT_VERSION; from += 1) {
          const step = migrations[from]
          if (step === undefined) break
          doc = step(doc)
        }
      } catch {
        report.push("This world is in an old format and couldn't be fully upgraded — the parts that didn't survive are listed below.")
      }
    } else if (version > FORMAT_VERSION) {
      report.push('This world was saved by a newer version of the app — everything this version understands was loaded.')
    }
  }

  let anythingRecovered = false

  // Settings: field by field, so one mangled value costs one field.
  const rawSettings = isRecord(doc.settings) ? doc.settings : {}
  const brokenSettings: string[] = []
  const tileSize = settingsFieldSchemas.tileSize.safeParse(rawSettings.tileSize)
  const primaryProjection = settingsFieldSchemas.primaryProjection.safeParse(rawSettings.primaryProjection)
  const fixedDt = settingsFieldSchemas.fixedDt.safeParse(rawSettings.fixedDt)
  const seed = settingsFieldSchemas.seed.safeParse(rawSettings.seed)
  const settings: WorldSettings = {
    tileSize: tileSize.success ? tileSize.data : defaultWorldSettings.tileSize,
    primaryProjection: primaryProjection.success ? primaryProjection.data : defaultWorldSettings.primaryProjection,
    fixedDt: fixedDt.success ? fixedDt.data : defaultWorldSettings.fixedDt,
    seed: seed.success ? seed.data : defaultWorldSettings.seed,
  }
  const fieldResults = { tileSize, primaryProjection, fixedDt, seed } as const
  for (const key of ['tileSize', 'primaryProjection', 'fixedDt', 'seed'] as const) {
    if (fieldResults[key].success) {
      anythingRecovered = true
    } else if (rawSettings[key] !== undefined) {
      brokenSettings.push(key)
    }
  }
  if (brokenSettings.length > 0) {
    report.push(`Some settings couldn't be read and were reset to normal: ${brokenSettings.join(', ')}.`)
  }

  // Meta: whole-or-fallback (a name is not worth partial repairs).
  const metaTry = metaSchema.safeParse(doc.meta)
  let meta: World['meta']
  if (metaTry.success) {
    meta = { worldId: metaTry.data.worldId, name: metaTry.data.name }
    anythingRecovered = true
  } else {
    meta = { worldId: `w${settings.seed}`, name: 'recovered world' }
    report.push('The world\'s name couldn\'t be read — it\'s called "recovered world" for now.')
  }

  // Tilesets: keep each one that reads cleanly.
  const tilesets: Tileset[] = []
  let lostTilesets = 0
  if (Array.isArray(doc.tilesets)) {
    for (const rawTileset of doc.tilesets) {
      const result = tilesetSchema.safeParse(rawTileset)
      if (result.success) {
        tilesets.push(toTileset(result.data))
        anythingRecovered = true
      } else {
        lostTilesets += 1
      }
    }
  }
  if (lostTilesets > 0) {
    report.push(
      lostTilesets === 1
        ? "1 tileset couldn't be read and was left out."
        : `${lostTilesets} tilesets couldn't be read and were left out.`,
    )
  }

  // Layers: keep each valid one; a cells list with the wrong length is
  // repaired (pad with empty tiles / trim the extras) rather than dropped —
  // truncated cell data is the SIGNATURE injury of a mid-write crash.
  const layers: TileLayer[] = []
  let lostLayers = 0
  if (Array.isArray(doc.layers)) {
    for (const rawLayer of doc.layers) {
      const result = layerBaseSchema.safeParse(rawLayer)
      if (!result.success) {
        lostLayers += 1
        continue
      }
      const expected = result.data.width * result.data.height
      let cells = result.data.cells
      if (cells.length < expected) {
        report.push(`Layer "${result.data.name}" was missing part of its tile data — the missing tiles were left blank.`)
        cells = cells.concat(new Array<number>(expected - cells.length).fill(0))
      } else if (cells.length > expected) {
        report.push(`Layer "${result.data.name}" had extra tile data past its edge — the extras were trimmed off.`)
        cells = cells.slice(0, expected)
      }
      layers.push(toLayer(result.data, cells))
      anythingRecovered = true
    }
  }
  if (lostLayers > 0) {
    report.push(
      lostLayers === 1
        ? "1 tile layer couldn't be read and was left out."
        : `${lostLayers} tile layers couldn't be read and were left out.`,
    )
  }

  // Entities: keep each valid one; duplicates keep the first claimant.
  const kept: ParsedEntity[] = []
  const seenIds = new Set<string>()
  let lostEntities = 0
  if (Array.isArray(doc.entities)) {
    for (const rawEntity of doc.entities) {
      const result = entitySchema.safeParse(rawEntity)
      if (!result.success) {
        lostEntities += 1
        continue
      }
      if (seenIds.has(result.data.id)) {
        report.push(`Two objects shared the id "${result.data.id}" — only the first one was kept.`)
        continue
      }
      seenIds.add(result.data.id)
      kept.push(result.data)
      anythingRecovered = true
    }
  }
  if (lostEntities > 0) {
    report.push(
      lostEntities === 1
        ? "1 object couldn't be read and was left out."
        : `${lostEntities} objects couldn't be read and were left out.`,
    )
  }

  if (!anythingRecovered) return null

  const entities = toEntityRecord(kept)
  const computedNext = maxEntitySuffix(Object.keys(entities)) + 1
  const fileNext = doc.nextEntityId
  const nextEntityId =
    typeof fileNext === 'number' && Number.isInteger(fileNext) && fileNext >= computedNext
      ? fileNext
      : computedNext

  return { world: { meta, settings, nextEntityId, entities, tilesets, layers }, report }
}

// ---------------------------------------------------------------------------
// Repairing truncated JSON — cutting back to the last complete word
// ---------------------------------------------------------------------------

/**
 * When a file stops mid-sentence (truncation, or garbage where a sync died),
 * the fix is the same one you'd use on a torn page: cut back to the end of
 * the last COMPLETE word, then close the quotes and brackets still open.
 *
 * A tiny JSON state machine walks the text and remembers every position
 * where a whole value just finished, along with which brackets were open
 * there. At the first character that couldn't possibly come next — a NUL
 * byte, a letter where a comma belongs, the end of the file inside a string
 * — it stops, takes the latest finish line, appends the matching closers,
 * and lets JSON.parse be the final judge (working backwards through earlier
 * finish lines if needed).
 *
 * One honesty rule: a number touching the very end of the text is NOT
 * trusted, because "42" might be the front half of "4200" — a truncated
 * string at least shows its missing quote, but a truncated number looks
 * innocent and would silently corrupt data.
 */
function repairTruncatedJson(text: string): { doc: unknown } | null {
  interface Candidate {
    end: number
    closers: string
  }
  const candidates: Candidate[] = []
  const stack: Array<'{' | '['> = []
  type Expect = 'value' | 'key' | 'colon' | 'commaOrEnd' | 'done'
  let expect: Expect = 'value'
  let i = 0
  const n = text.length

  const closersFor = (): string => {
    let closers = ''
    for (let k = stack.length - 1; k >= 0; k -= 1) {
      closers += stack[k] === '{' ? '}' : ']'
    }
    return closers
  }

  // Records a finish line and answers what must come next. (It RETURNS the
  // next state instead of assigning it so the assignment stays visible in
  // the loop body — TypeScript's flow analysis rightly distrusts mutations
  // hidden inside closures.)
  const completeValue = (endExclusive: number): Expect => {
    candidates.push({ end: endExclusive, closers: closersFor() })
    return stack.length === 0 ? 'done' : 'commaOrEnd'
  }

  // Returns the index just past the closing quote, or null if the string
  // never closes (i.e. the text was cut off inside it).
  const scanString = (start: number): number | null => {
    let j = start + 1
    while (j < n) {
      const ch = text[j]
      if (ch === '\\') {
        j += 2
        continue
      }
      if (ch === '"') return j + 1
      j += 1
    }
    return null
  }

  scan: while (i < n) {
    const ch = text[i]
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      i += 1
      continue
    }
    switch (expect) {
      case 'done':
        // A complete document followed by anything at all: that tail is
        // garbage (the classic mid-write signature). The finished document
        // is already on the candidate list.
        break scan
      case 'value': {
        if (ch === '{') {
          stack.push('{')
          expect = 'key'
          i += 1
          continue
        }
        if (ch === '[') {
          stack.push('[')
          expect = 'value'
          i += 1
          continue
        }
        if (ch === ']' && stack[stack.length - 1] === '[') {
          // An empty array: '[' immediately followed by ']'.
          stack.pop()
          expect = completeValue(i + 1)
          i += 1
          continue
        }
        if (ch === '"') {
          const end = scanString(i)
          if (end === null) break scan
          expect = completeValue(end)
          i = end
          continue
        }
        if (ch === '-' || (ch !== undefined && ch >= '0' && ch <= '9')) {
          let j = i + 1
          while (j < n && /[0-9+\-.eE]/.test(text[j] ?? '')) j += 1
          if (j >= n) break scan // number touching EOF: might be cut mid-digit — never trust it
          expect = completeValue(j)
          i = j
          continue
        }
        if (text.startsWith('true', i)) {
          expect = completeValue(i + 4)
          i += 4
          continue
        }
        if (text.startsWith('false', i)) {
          expect = completeValue(i + 5)
          i += 5
          continue
        }
        if (text.startsWith('null', i)) {
          expect = completeValue(i + 4)
          i += 4
          continue
        }
        break scan
      }
      case 'key': {
        if (ch === '}' && stack[stack.length - 1] === '{') {
          stack.pop()
          expect = completeValue(i + 1)
          i += 1
          continue
        }
        if (ch === '"') {
          const end = scanString(i)
          if (end === null) break scan
          expect = 'colon'
          i = end
          continue
        }
        break scan
      }
      case 'colon': {
        if (ch === ':') {
          expect = 'value'
          i += 1
          continue
        }
        break scan
      }
      case 'commaOrEnd': {
        if (ch === ',') {
          expect = stack[stack.length - 1] === '{' ? 'key' : 'value'
          i += 1
          continue
        }
        if (ch === '}' && stack[stack.length - 1] === '{') {
          stack.pop()
          expect = completeValue(i + 1)
          i += 1
          continue
        }
        if (ch === ']' && stack[stack.length - 1] === '[') {
          stack.pop()
          expect = completeValue(i + 1)
          i += 1
          continue
        }
        break scan
      }
    }
  }

  for (let k = candidates.length - 1; k >= 0; k -= 1) {
    const candidate = candidates[k]
    if (candidate === undefined) continue
    try {
      return { doc: JSON.parse(text.slice(0, candidate.end) + candidate.closers) }
    } catch {
      // A candidate can be structurally fine yet still unparsable (e.g. the
      // cut exposed a trailing comma) — fall back to the previous one.
    }
  }
  return null
}
