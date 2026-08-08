/*
 * What a well-formed world file looks like — and how to explain a broken one
 * to a ten-year-old.
 *
 * Two jobs live in this file, deliberately side by side:
 *
 * 1. THE SHAPE. Zod schemas describing exactly what a version-1 world file
 *    contains. Zod is quarantined inside this package (docs/DECISIONS.md R5):
 *    no Zod type appears in anything @engine/world-format exports, so the
 *    validator could be swapped out next year without touching a single
 *    public signature. Everything in this file is package-internal.
 *
 * 2. THE TRANSLATION TABLE. Zod speaks compiler ("Invalid input: expected
 *    number, received string"). Our users are kids who hand-edit their world
 *    files — the glass-box ethos ENCOURAGES that — and raw validator prose
 *    reaching a student is a named bug class (docs/RISKS.md). So every
 *    validation failure is rewritten here into one sentence that says WHERE
 *    to look ("settings → tileSize") and WHAT is wrong ("it should be a
 *    number, but right now it's the text \"big\""). The untranslated details
 *    still ride along in LoadError.technical for grown-ups and bug reports.
 */

import { z } from 'zod'

/**
 * The current world-file format version. Bumping this is a ceremony, not an
 * edit: the old schema keeps existing forever, a new pure migration function
 * is appended to `migrations` (see parse.ts), and a fixture file saved by the
 * OLD version joins the test corpus permanently. Old semantics are never
 * mutated — classroom files outlive every library choice (docs/DECISIONS.md D1).
 */
export const FORMAT_VERSION = 1 as const

/**
 * The default settings a brand-new world gets — also what salvage falls back
 * to, field by field, when a damaged file's settings can't be read. Kept in
 * lockstep with @engine/core's createWorld defaults.
 */
export const defaultWorldSettings = {
  tileSize: 1,
  primaryProjection: 'topdown',
  fixedDt: 1 / 60,
  seed: 1,
} as const

// ---------------------------------------------------------------------------
// The shape of a version-1 world file
// ---------------------------------------------------------------------------

// Integer checks are written as .refine(Number.isInteger, …) rather than
// Zod's own integer type on purpose: the failure then carries OUR message
// (issue code 'custom'), which the translation table passes straight through.
// The wording of a student-facing error should never depend on which Zod
// version happens to be installed.

// PRE-RELEASE-ONLY CAPS. The three limits below (layer size, tileSize,
// layerBand) make previously-legal files illegal — a move that is only cheap
// NOW, while no real classroom files exist. After release, tightening a cap
// is a format-version bump with a migration, never an edit here
// (docs/DECISIONS.md D1). The upstream stride/dominance math assumes these
// bounds; without them the schema was writing checks the code couldn't cash.

/**
 * No layer dimension may exceed 256 cells — the SAME cap as @engine/tilemap's
 * MAX_LAYER_SIZE, kept in lockstep by hand (this package can't import tilemap;
 * the file format sits below it). Why 256: a school Chromebook's frame budget
 * can absorb a full 256×256 = 65,536-cell redraw, but not much more
 * (docs/RISKS.md, docs/DECISIONS.md R1).
 */
const MAX_LAYER_DIMENSION = 256

/** One tile spanning more than 64 world units is almost certainly a typo. */
const MAX_TILE_SIZE = 64

/**
 * |layerBand| ≤ 2^20 = 1,048,576. The draw-order math multiplies bands into
 * strides, and the product must stay comfortably inside safe-integer range.
 */
const MAX_LAYER_BAND = 1_048_576

const metaSchema = z.object({
  worldId: z.string(),
  name: z.string(),
})

const tileSizeSchema = z
  .number()
  .positive()
  .refine((v) => v <= MAX_TILE_SIZE, {
    message: `tileSize should be bigger than 0 and at most ${MAX_TILE_SIZE} — one tile spanning more than ${MAX_TILE_SIZE} world units is almost certainly a typo`,
  })
const primaryProjectionSchema = z.enum(['profile', 'topdown', 'iso'])
const fixedDtSchema = z.number().positive()
const seedSchema = z.number().refine(Number.isInteger, { message: 'the seed must be a whole number' })

const settingsSchema = z.object({
  tileSize: tileSizeSchema,
  primaryProjection: primaryProjectionSchema,
  fixedDt: fixedDtSchema,
  seed: seedSchema,
})

/**
 * The settings schema, taken apart — salvage mode validates each field on its
 * own so one hand-mangled value ("tileSize": "big") costs exactly one field,
 * not the whole settings block.
 */
export const settingsFieldSchemas = {
  tileSize: tileSizeSchema,
  primaryProjection: primaryProjectionSchema,
  fixedDt: fixedDtSchema,
  seed: seedSchema,
} as const

const tileDefSchema = z.object({
  name: z.string(),
  colors: z.object({
    top: z.string(),
    left: z.string().optional(),
    right: z.string().optional(),
    side: z.string().optional(),
  }),
})

const tilesetSchema = z.object({
  id: z.string(),
  name: z.string(),
  tiles: z.array(tileDefSchema),
})

const entityIdPattern = /^e[0-9]+$/

const entitySchema = z.object({
  id: z
    .string()
    .refine((id) => entityIdPattern.test(id), {
      message: 'an object\'s id must be the letter "e" followed by a number, like "e12"',
    }),
  name: z.string(),
  // The values are z.unknown() ON PURPOSE: component contents are opaque
  // blobs at the file boundary. A component this app has never heard of
  // (from a newer version, or a plugin) round-trips byte-for-byte — that is
  // the forward-compatibility promise of docs/DECISIONS.md D1.
  components: z.record(z.string(), z.unknown()),
})

const wholeNumber = (what: string) =>
  z.number().refine(Number.isInteger, { message: `${what} must be a whole number (no decimals)` })

/**
 * A tile layer minus the cell-count cross-check. Salvage uses this lenient
 * shape so a layer whose cells array was cut short by a mid-write crash can
 * still be rescued (the missing tail is padded with empty cells) instead of
 * being thrown away whole.
 */
export const layerBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  width: z
    .number()
    .min(1)
    .refine(Number.isInteger, { message: 'a layer\'s width must be a whole number' })
    .refine((v) => v <= MAX_LAYER_DIMENSION, {
      message:
        `a layer can be at most ${MAX_LAYER_DIMENSION} tiles wide — ${MAX_LAYER_DIMENSION}×${MAX_LAYER_DIMENSION} is the most ` +
        'a school Chromebook can redraw in one frame; build bigger places out of several layers',
    }),
  height: z
    .number()
    .min(1)
    .refine(Number.isInteger, { message: 'a layer\'s height must be a whole number' })
    .refine((v) => v <= MAX_LAYER_DIMENSION, {
      message:
        `a layer can be at most ${MAX_LAYER_DIMENSION} tiles tall — ${MAX_LAYER_DIMENSION}×${MAX_LAYER_DIMENSION} is the most ` +
        'a school Chromebook can redraw in one frame; build bigger places out of several layers',
    }),
  elevation: z.number(),
  layerBand: wholeNumber('layerBand').refine((v) => Math.abs(v) <= MAX_LAYER_BAND, {
    message:
      'layerBand must stay between -1,048,576 and 1,048,576 (a million bands is plenty) — ' +
      'the draw-order math multiplies bands together and needs room to breathe',
  }),
  tilesetId: z.string(),
  cells: z.array(
    z
      .number()
      .min(0)
      .max(65535)
      .refine(Number.isInteger, { message: 'tile numbers must be whole numbers' }),
  ),
})

const layerSchema = layerBaseSchema.superRefine((layer, ctx) => {
  const expected = layer.width * layer.height
  if (layer.cells.length !== expected) {
    ctx.addIssue({
      code: 'custom',
      path: ['cells'],
      message:
        `this layer says it is ${layer.width}×${layer.height}, so it needs exactly ` +
        `${expected} numbers in its cells list, but it has ${layer.cells.length}`,
    })
  }
})

/**
 * The whole version-1 document. Strict parsing (parseWorld) requires this to
 * hold end to end; salvage picks it apart and rescues the pieces that do.
 *
 * Zod's z.object STRIPS keys the schema doesn't name — and that stripping is
 * a POLICY of this format, not an accident: outside components, an unknown
 * key does not survive a save. parse.ts turns every such drop into a named
 * warning (see `knownKeys` below), so nothing disappears silently.
 */
export const worldDocSchema = z
  .object({
    formatVersion: z.literal(FORMAT_VERSION),
    meta: metaSchema,
    settings: settingsSchema,
    nextEntityId: z.number().min(1).refine(Number.isInteger, { message: 'nextEntityId must be a whole number' }),
    tilesets: z.array(tilesetSchema),
    layers: z.array(layerSchema),
    entities: z.array(entitySchema),
  })
  .superRefine((doc, ctx) => {
    // Ids are the one thing everything else keys on (docs/DECISIONS.md D2),
    // so two objects claiming the same id is real corruption, not a nitpick.
    const seen = new Set<string>()
    doc.entities.forEach((entity, index) => {
      if (seen.has(entity.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entities', index, 'id'],
          message: `two objects share the id "${entity.id}" — every object needs its own id`,
        })
      }
      seen.add(entity.id)
    })
  })

export type WorldDocV1 = z.infer<typeof worldDocSchema>
export type ParsedEntity = z.infer<typeof entitySchema>
export type ParsedTileset = z.infer<typeof tilesetSchema>
export type ParsedLayerBase = z.infer<typeof layerBaseSchema>

/** The individually-salvageable piece schemas, re-exported for salvage mode. */
export { entitySchema, metaSchema, tilesetSchema }

/**
 * The key names each schema actually reads — DERIVED from the schemas'
 * shapes, so this can never drift from the validation above. parse.ts diffs
 * a raw document against these to warn, by name, about every key that will
 * not survive a save (unknown keys outside components are stripped — the
 * stated policy; see worldDocSchema).
 */
export const knownKeys = {
  topLevel: new Set(Object.keys(worldDocSchema.shape)) as ReadonlySet<string>,
  meta: new Set(Object.keys(metaSchema.shape)) as ReadonlySet<string>,
  settings: new Set(Object.keys(settingsSchema.shape)) as ReadonlySet<string>,
  tileset: new Set(Object.keys(tilesetSchema.shape)) as ReadonlySet<string>,
  layer: new Set(Object.keys(layerBaseSchema.shape)) as ReadonlySet<string>,
  entity: new Set(Object.keys(entitySchema.shape)) as ReadonlySet<string>,
} as const

// ---------------------------------------------------------------------------
// The translation table: validator-speak -> student-speak
// ---------------------------------------------------------------------------

/**
 * Describes any JavaScript value the way you would say it out loud to a kid
 * reading their own file: not "received string" but 'the text "big"'.
 * Used both by the translation below and by parse.ts's structural pre-checks,
 * so the whole loader speaks with one voice.
 */
export function describeValue(value: unknown): string {
  if (value === undefined) return 'missing'
  if (value === null) return 'null (an empty nothing)'
  if (typeof value === 'string') {
    const shown = value.length > 40 ? `${value.slice(0, 40)}…` : value
    return `the text "${shown}"`
  }
  if (typeof value === 'number') return `the number ${String(value)}`
  if (typeof value === 'boolean') return `the value ${String(value)}`
  if (Array.isArray(value)) return 'a list'
  if (typeof value === 'object') return 'an object'
  return `something unexpected (${typeof value})`
}

// The subset of a Zod issue the translator reads. Typed by hand (and filled
// via a cast) so the translation logic depends on documented issue fields,
// not on Zod's internal type gymnastics.
interface IssueView {
  code?: string
  path?: ReadonlyArray<PropertyKey>
  message?: string
  expected?: string
  values?: ReadonlyArray<unknown>
  minimum?: number | bigint
  maximum?: number | bigint
  inclusive?: boolean
  origin?: string
}

/** "settings → tileSize", "layers → #2 → cells" — where to look, in file order, 1-based. */
function humanPath(path: ReadonlyArray<PropertyKey> | undefined): string {
  if (path === undefined || path.length === 0) return 'the top of the file'
  return path.map((step) => (typeof step === 'number' ? `#${step + 1}` : String(step))).join(' → ')
}

/** The same path in classic JSON notation, for the technical note. */
function jsonPath(path: ReadonlyArray<PropertyKey> | undefined): string {
  if (path === undefined || path.length === 0) return '$'
  return `$${path.map((step) => (typeof step === 'number' ? `[${step}]` : `.${String(step)}`)).join('')}`
}

/** Walks the raw document down an issue's path to find the actual offending value. */
function valueAt(doc: unknown, path: ReadonlyArray<PropertyKey> | undefined): unknown {
  let current: unknown = doc
  for (const step of path ?? []) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<PropertyKey, unknown>)[step]
  }
  return current
}

/** Zod's type names, reworded for someone who has never read a stack trace. */
const expectedNames: Record<string, string> = {
  string: 'some text in quotes',
  number: 'a number',
  boolean: 'true or false',
  object: 'an object with { }',
  record: 'an object with { }',
  array: 'a list with [ ]',
  int: 'a whole number',
  integer: 'a whole number',
}

function nameExpected(expected: string | undefined): string {
  if (expected === undefined) return 'something else'
  return expectedNames[expected] ?? `a ${expected}`
}

/** '"profile", "topdown" or "iso"' — options listed the way a person would say them. */
function listValues(values: ReadonlyArray<unknown>): string {
  const shown = values.map((v) => JSON.stringify(v))
  if (shown.length === 0) return 'something else'
  if (shown.length === 1) return shown[0] ?? 'something else'
  return `one of ${shown.slice(0, -1).join(', ')} or ${shown[shown.length - 1] ?? ''}`
}

/**
 * Turns a Zod validation failure into { message, technical }:
 *
 * - `message` is the student-facing sentence. It always names the place to
 *   look, in the same order the file reads, and describes the value actually
 *   found there (we walk the document ourselves rather than trusting the
 *   validator to phrase it kindly).
 * - `technical` is the compressed raw story — issue codes, JSON paths, Zod's
 *   own words — for the adults.
 *
 * Only the FIRST problem becomes the message. A kid staring at twelve errors
 * fixes none of them; a kid told "fix this one, then load again to see the
 * next" fixes all twelve, one at a time.
 */
export function translateZodError(
  error: z.ZodError,
  doc: unknown,
): { message: string; technical: string } {
  const issues = error.issues as unknown as ReadonlyArray<IssueView>
  const first = issues[0]

  const technical =
    issues
      .slice(0, 3)
      .map((issue) => `[${issue.code ?? 'unknown'}] ${jsonPath(issue.path)}: ${issue.message ?? ''}`)
      .join(' | ') + (issues.length > 3 ? ` | +${issues.length - 3} more` : '')

  if (first === undefined) {
    return { message: 'Something in this file isn\'t shaped like a world, but the checker couldn\'t say what.', technical }
  }

  const where = humanPath(first.path)
  const actual = valueAt(doc, first.path)
  const followUp =
    issues.length > 1
      ? ` (That's the first of ${issues.length} problems — fix it, then load again to see the next.)`
      : ''

  let message: string
  switch (first.code) {
    case 'invalid_type':
      message =
        actual === undefined
          ? `Check ${where}: it's missing — it should be ${nameExpected(first.expected)}.`
          : `Check ${where}: it should be ${nameExpected(first.expected)}, but right now it's ${describeValue(actual)}.`
      break
    case 'invalid_value':
      message = `Check ${where}: it should be ${listValues(first.values ?? [])}, but right now it's ${describeValue(actual)}.`
      break
    case 'too_small':
      if (first.origin === 'string') {
        message = `Check ${where}: that text is too short — it needs at least ${String(first.minimum)} character(s).`
      } else if (first.origin === 'array') {
        message = `Check ${where}: that list is too short — it needs at least ${String(first.minimum)} entr${first.minimum === 1 ? 'y' : 'ies'}.`
      } else {
        const bound = first.inclusive === false ? 'bigger than' : 'at least'
        message = `Check ${where}: that number is too small — it needs to be ${bound} ${String(first.minimum)}.`
      }
      break
    case 'too_big':
      if (first.origin === 'string') {
        message = `Check ${where}: that text is too long — it can have at most ${String(first.maximum)} character(s).`
      } else if (first.origin === 'array') {
        message = `Check ${where}: that list is too long — it can have at most ${String(first.maximum)} entries.`
      } else {
        const bound = first.inclusive === false ? 'smaller than' : 'at most'
        message = `Check ${where}: that number is too big — it needs to be ${bound} ${String(first.maximum)}.`
      }
      break
    case 'custom':
      // Custom messages are written in this file (and in the migrations) in
      // student language already — they only need the "where" prefixed.
      message =
        first.path === undefined || first.path.length === 0
          ? `${capitalize(first.message ?? 'something here isn\'t right')}.`
          : `Check ${where}: ${first.message ?? 'something here isn\'t right'}.`
      break
    default:
      message = `Check ${where}: that value isn't right for a world file — the technical note below says more.`
      break
  }

  return { message: message + followUp, technical }
}

function capitalize(sentence: string): string {
  return sentence.length === 0 ? sentence : sentence.charAt(0).toUpperCase() + sentence.slice(1)
}
