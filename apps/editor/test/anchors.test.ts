/**
 * Anchor-registry governance (docs/DECISIONS.md D5). Lessons reference
 * editor chrome only through registered anchor ids, so the registry gets the
 * same treatment as the event vocabulary: well-formed ids, aliases that
 * never shadow live ids, and THE TRIPWIRE — a filesystem scan of the React
 * shell asserting that every `data-anchor` literal in the mounted UI
 * resolves through the registry, and that every registered id is actually
 * attached somewhere. A registered-but-unused anchor is a lesson pointing
 * at nothing; an attached-but-unregistered one is a highlight no lesson can
 * ever request. Both directions fail CI here.
 *
 * There is a second tripwire, against VANISHING: ANCHOR_HISTORY records
 * every id ever registered, and this suite demands each entry still resolve
 * somewhere (live, aliased, or retired) — so deleting an anchor without a
 * forwarding trail fails CI too, in both directions (a live id missing from
 * the history is equally an error).
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ANCHOR_ALIASES, ANCHOR_HISTORY, ANCHOR_IDS, RETIRED_ANCHORS, resolveAnchor } from '../src/editor/anchors'

const REGIONS = ['toolbar', 'palette', 'panel', 'viewport', 'status'] as const

describe('registry shape', () => {
  it('contains no duplicate ids', () => {
    expect(new Set(ANCHOR_IDS).size).toBe(ANCHOR_IDS.length)
  })

  it('every id is region.thing with a known region prefix', () => {
    for (const id of ANCHOR_IDS) {
      expect(id, `anchor '${id}' is not region.camelCaseThing`).toMatch(/^[a-z]+\.[a-zA-Z]+$/)
      const region = id.split('.')[0]
      expect(REGIONS as readonly string[], `anchor '${id}' names unknown region '${region}'`).toContain(region)
    }
  })
})

describe('resolution', () => {
  it('resolves every live id to itself', () => {
    for (const id of ANCHOR_IDS) {
      expect(resolveAnchor(id)).toBe(id)
    }
  })

  it('resolves every alias to its live target', () => {
    // Vacuous until a post-freeze rename ever happens — the walk is the point.
    for (const [oldId, target] of Object.entries(ANCHOR_ALIASES)) {
      expect(ANCHOR_IDS as readonly string[], `alias '${oldId}' targets non-live '${target}'`).toContain(target)
      expect(resolveAnchor(oldId)).toBe(target)
    }
  })

  it('answers null for unknown ids, never a guess', () => {
    expect(resolveAnchor('toolbar.doesNotExist')).toBeNull()
    expect(resolveAnchor('')).toBeNull()
    expect(resolveAnchor('toolbar')).toBeNull()
  })
})

describe('governance: nothing shadows a live id', () => {
  it('no alias key is also a live id', () => {
    for (const oldId of Object.keys(ANCHOR_ALIASES)) {
      expect(ANCHOR_IDS as readonly string[], `alias '${oldId}' shadows a live anchor`).not.toContain(oldId)
    }
  })

  it('no retired id is also a live id or an alias key', () => {
    for (const retired of RETIRED_ANCHORS) {
      expect(ANCHOR_IDS as readonly string[], `retired '${retired}' is still live`).not.toContain(retired)
      expect(Object.keys(ANCHOR_ALIASES), `retired '${retired}' is also aliased`).not.toContain(retired)
    }
  })
})

describe('governance: the vanishing tripwire (ANCHOR_HISTORY, docs/DECISIONS.md D5)', () => {
  it('every id ever registered still resolves somewhere — live, aliased, or retired', () => {
    // The D5 failure mode: an anchor deleted from ANCHOR_IDS with no
    // forwarding trail, silently breaking every lesson that pointed at it.
    for (const id of ANCHOR_HISTORY) {
      const accounted =
        (ANCHOR_IDS as readonly string[]).includes(id) ||
        Object.keys(ANCHOR_ALIASES).includes(id) ||
        RETIRED_ANCHORS.includes(id)
      expect(
        accounted,
        `anchor '${id}' vanished: not in ANCHOR_IDS, not an ANCHOR_ALIASES key, not in RETIRED_ANCHORS — leave a forwarding trail (D5)`,
      ).toBe(true)
    }
  })

  it('every live id is recorded in ANCHOR_HISTORY — appending is part of registering', () => {
    // The other hole: a new anchor that never enters the history could later
    // vanish without tripping the check above.
    for (const id of ANCHOR_IDS) {
      expect(ANCHOR_HISTORY, `anchor '${id}' is live but missing from ANCHOR_HISTORY`).toContain(id)
    }
  })
})

// ---------------------------------------------------------------------------
// THE TRIPWIRE: the mounted UI vs the registry, both directions
// ---------------------------------------------------------------------------

/** Recursively gather .tsx files under a directory; a missing directory is
 * an empty list (the ui/ tree may not exist yet in this wave). */
function tsxFilesUnder(dir: string): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...tsxFilesUnder(full))
    else if (entry.name.endsWith('.tsx')) files.push(full)
  }
  return files
}

/** Every string literal attached via a data-anchor attribute in TSX source:
 * matches both `data-anchor="panel.lesson"` and expression forms like
 * `data-anchor={anchor('panel.lesson')}`. */
function dataAnchorLiterals(source: string): string[] {
  const found: string[] = []
  const attr = /data-anchor=(?:"([^"]*)"|'([^']*)'|\{[^}]*?['"`]([^'"`]*)['"`][^}]*?\})/g
  for (const match of source.matchAll(attr)) {
    const literal = match[1] ?? match[2] ?? match[3]
    if (literal !== undefined) found.push(literal)
  }
  return found
}

const uiDir = fileURLToPath(new URL('../src/ui', import.meta.url))
const uiFiles = tsxFilesUnder(uiDir)

describe('the data-anchor tripwire (scan of apps/editor/src/ui/**/*.tsx)', () => {
  it(
    uiFiles.length === 0
      ? 'vacuous this wave: no src/ui tree exists yet, so the scan passes by absence'
      : `every data-anchor literal in ${uiFiles.length} ui file(s) resolves through the registry`,
    () => {
      for (const file of uiFiles) {
        for (const literal of dataAnchorLiterals(readFileSync(file, 'utf8'))) {
          expect(resolveAnchor(literal), `${file}: data-anchor '${literal}' does not resolve`).not.toBeNull()
        }
      }
    },
  )

  it(
    uiFiles.length === 0
      ? 'vacuous this wave: unused-anchor check waits for the ui/ tree'
      : 'every registered anchor id is attached at least once — no lesson may point at nothing',
    () => {
      if (uiFiles.length === 0) return
      const attached = new Set<string>()
      for (const file of uiFiles) {
        for (const literal of dataAnchorLiterals(readFileSync(file, 'utf8'))) {
          const live = resolveAnchor(literal)
          if (live !== null) attached.add(live)
        }
      }
      for (const id of ANCHOR_IDS) {
        expect(attached, `anchor '${id}' is registered but attached nowhere in src/ui`).toContain(id)
      }
    },
  )
})
