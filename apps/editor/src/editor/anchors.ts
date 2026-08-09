/**
 * The anchor registry — how lessons will ever point at editor chrome.
 *
 * A lesson step that says "now press Save" must highlight the Save button —
 * but lessons are data with a decade lifespan, and buttons move. So lessons
 * never reference chrome by DOM structure; they reference it by ANCHOR ID,
 * and the editor promises every registered anchor exists as a
 * `data-anchor="…"` attribute somewhere in the mounted UI
 * (docs/ARCHITECTURE.md §8, docs/DECISIONS.md D5).
 *
 * Governance, same as the event vocabulary: additive-only once lessons ship
 * (Phase 3 freeze). Deleting or renaming an anchor without leaving a
 * forwarding trail fails CI — ANCHOR_HISTORY records every id ever
 * registered, and the registry test demands each entry still be alive in
 * ANCHOR_IDS, forwarded through ANCHOR_ALIASES, or consciously listed in
 * RETIRED_ANCHORS. Until the freeze this is a draft, which is why the
 * alias and retirement lists are empty.
 *
 * Naming convention: `region.thing`, camelCase thing, regions from the
 * fixed CSS grid — toolbar, palette, panel, viewport, status.
 */

/** Every anchor the editor UI currently carries. Alphabetical; add, don't
 * rename (after Phase 3: add, NEVER rename without an alias). */
export const ANCHOR_IDS = [
  'palette.entities',
  'palette.tiles',
  'panel.entities',
  'panel.inspector',
  'panel.layers',
  'panel.lesson',
  'panel.lessonHint',
  'panel.lessonPicker',
  'panel.lessonReset',
  'panel.lessonShowMe',
  'status.announcements',
  'status.coords',
  'status.saveState',
  'status.zoom',
  'toolbar.brush',
  'toolbar.export',
  'toolbar.import',
  'toolbar.placer',
  'toolbar.redo',
  'toolbar.restoreBackup',
  'toolbar.save',
  'toolbar.select',
  'toolbar.undo',
  'toolbar.viewIso',
  'toolbar.viewProfile',
  'toolbar.viewTopdown',
  'toolbar.worldName',
  'viewport.canvas',
] as const

export type AnchorId = (typeof ANCHOR_IDS)[number]

/**
 * Old name → current name. When a post-freeze rename ever happens, the old
 * id lives here forever and lesson data referencing it keeps resolving.
 */
export const ANCHOR_ALIASES: Readonly<Record<string, AnchorId>> = {}

/**
 * Anchors that have EVER existed and were deliberately retired (allowed only
 * pre-freeze). The registry test fails if an id disappears from ANCHOR_IDS
 * without landing here or in ANCHOR_ALIASES — that is the CI tripwire D5
 * demands.
 */
export const RETIRED_ANCHORS: ReadonlyArray<string> = []

/**
 * Every anchor id EVER registered — the vanishing tripwire. ANCHOR_IDS says
 * what is live *now*; this list says what has *existed*, so an anchor cannot
 * silently disappear: the registry test walks every entry here and demands
 * it still resolve somewhere — live in ANCHOR_IDS, forwarded via
 * ANCHOR_ALIASES, or consciously listed in RETIRED_ANCHORS (the CI failure
 * docs/DECISIONS.md D5 demands). Forgetting to append is caught from the
 * other direction: the test also demands every live id appear here.
 */
export const ANCHOR_HISTORY: ReadonlyArray<string> = [
  // Append-only: add new ids as they are registered, NEVER remove a line.
  'palette.entities',
  'palette.tiles',
  'panel.entities',
  'panel.inspector',
  'panel.layers',
  'panel.lesson',
  'status.announcements',
  'status.coords',
  'status.saveState',
  'status.zoom',
  'toolbar.brush',
  'toolbar.export',
  'toolbar.import',
  'toolbar.placer',
  'toolbar.redo',
  'toolbar.restoreBackup',
  'toolbar.save',
  'toolbar.select',
  'toolbar.undo',
  'toolbar.worldName',
  'viewport.canvas',
  // Phase 3 (tutorial + view lens):
  'panel.lessonHint',
  'panel.lessonPicker',
  'panel.lessonReset',
  'panel.lessonShowMe',
  'toolbar.viewIso',
  'toolbar.viewProfile',
  'toolbar.viewTopdown',
]

/** Resolve an id through the alias table to a live anchor, or null. */
export function resolveAnchor(id: string): AnchorId | null {
  if ((ANCHOR_IDS as ReadonlyArray<string>).includes(id)) return id as AnchorId
  return ANCHOR_ALIASES[id] ?? null
}

/**
 * The typed pass-through the UI uses at every attachment site:
 * `data-anchor={anchor('toolbar.save')}`. Its only job is the compile
 * error when a component typos an id or invents one without registering it.
 */
export function anchor(id: AnchorId): AnchorId {
  return id
}
