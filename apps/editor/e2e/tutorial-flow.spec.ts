/**
 * Phase 3 exit gates: the tutorial engine as browser truths (docs/ROADMAP.md
 * — resume survives reload, hint + start-over escapes on every step, the
 * lesson picker, the fixture park/restore choreography, the "show me"
 * spotlight, and the axe-core scan across tutorial states).
 *
 * The suite leans on the same contracts the keyboard-flow gate pinned (the
 * starter world of src/editor/types.ts, the announcement table of
 * src/editor/session.ts) plus the Phase 3 ones:
 *
 * - Lesson DATA is the oracle: step counts, titles, hint texts, and the
 *   step ids asserted here come from content/lessons/src/*.ts — a curriculum
 *   edit fails these gates by design, exactly like a wording change fails
 *   the announcement assertions.
 * - Progress lives at 'editor:tutorial-progress', the parked world at
 *   'editor:parked-world' (src/editor/tutorial-host.ts), the save slot at
 *   'editor:world' — asserted directly where the UI alone could not
 *   distinguish two histories (the mid-fixture reload cycle).
 * - Persistence sentences come from session.ts verbatim: the fixture badge
 *   ("lesson world — your own world is parked and safe") and save()'s
 *   refusal ("This is a lesson world you are visiting — …").
 *
 * Keyboard-first, like keyboard-flow: the picker is driven by Tab +
 * type-ahead at least once (the lesson-02 switch — see that test for why
 * arrow keys cannot be pinned on a native select under the darwin keyboard
 * model), the view buttons by Tab + Enter for the whole three-views walk;
 * pointer-free helpers are shared via ./helpers.ts.
 * Where a keyboard twin is already proved (the picker in the reset test),
 * later tests may use selectOption — the semantics under test are the
 * engine's, not the select element's, twice over.
 *
 * retries: 0 (playwright.config.ts) — a flaky gate is a broken gate.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import {
  ANNOUNCEMENTS,
  bootFresh,
  CANVAS,
  COORDS,
  ENTITIES_PANEL,
  expectAnnouncement,
  INSPECTOR,
  LESSON,
  SAVE_STATE,
  tabTo,
  THINGS_GROUP,
  TILES_GROUP,
  WORLD_NAME,
} from './helpers'

// ---------------------------------------------------------------------------
// Phase 3 selectors and pinned strings
// ---------------------------------------------------------------------------

const PICKER = '[data-anchor="panel.lessonPicker"]'
const HINT_BUTTON = '[data-anchor="panel.lessonHint"]'
const RESET_BUTTON = '[data-anchor="panel.lessonReset"]'
const SHOW_ME_BUTTON = '[data-anchor="panel.lessonShowMe"]'
const VIEW_TOPDOWN = '[data-anchor="toolbar.viewTopdown"]'
const VIEW_ISO = '[data-anchor="toolbar.viewIso"]'
const VIEW_PROFILE = '[data-anchor="toolbar.viewProfile"]'

/** The DOM spotlight's markup (packages/lens/src/spotlight.ts): four mask
 * panels framing the hole, one decorative ring above them. */
const SPOTLIGHT_PANELS = '[data-lens-spotlight="panel"]'
const SPOTLIGHT_RING = '[data-lens-spotlight="ring"]'

/** Storage keys — tutorial-host.ts (the park) and types.ts (the save slot).
 * Progress ('editor:tutorial-progress') is asserted through the rail only:
 * what survives a reload is the STUDENT-VISIBLE place, not the bytes. */
const PARKED_KEY = 'editor:parked-world'
const WORLD_KEY = 'editor:world'

/** The status-bar badge while a fixture is live (session.ts FIXTURE_MESSAGE). */
const FIXTURE_BADGE = 'lesson world — your own world is parked and safe'
/** The badge right after Back-to-my-world (session.ts PARK_RESTORED_MESSAGE):
 * the restored bytes sit in NO save slot until the student saves — 'saved'
 * here would be a silent data-loss window. */
const PARK_RESTORED_BADGE = 'back from the lesson — press Ctrl+S to keep your world'
/** save()'s refusal while a fixture is live (session.ts, pinned by types.ts). */
const FIXTURE_SAVE_REFUSED =
  'This is a lesson world you are visiting — your own world is parked and safe. ' +
  'Head back to it before saving.'

/** Lesson-01 step 1's hints, exactly as the rail renders them: the mini-
 * markdown formatter consumes ** and ` markers, so the DOM text is the
 * authored string with the markers stripped (lesson-01-first-tiles.ts). */
const LESSON01_STEP1_HINT0 =
  'The brush is in the toolbar. Click it, pick a tile from the palette, ' +
  'then click any square on the map. Any tile, any square — this one is a freebie.'
const LESSON01_STEP1_HINT1 =
  'No mouse needed: press B for the brush, then inside the canvas use the ' +
  'arrow keys to walk the cell cursor and press Enter to paint where it stands.'

/** The showcase island's cast in entityIds() order (fixtures.ts): the crates
 * carry their marker kind as a trailing badge span, hence the prefixes. */
const ISLAND_CAST = ['player', /^crate a/, /^crate b/, 'tree'] as const

// ---------------------------------------------------------------------------
// Small flow helpers
// ---------------------------------------------------------------------------

/** Press one key N times. */
async function pressTimes(page: Page, key: string, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) await page.keyboard.press(key)
}

/**
 * Keyboard-paint water on (12, 4) from a fresh boot: pick the water swatch,
 * focus the canvas, summon the cell cursor (first arrow spends itself at the
 * 32×24 layer's center (16, 12)), walk to (12, 4), Enter. On a fresh
 * lesson-01 this ONE paint advances the rail to step 3 of 5 — the painted
 * event completes step 1, and the event-then-world cascade immediately
 * satisfies step 2's tile-at (12, 4) fact (machine.ts).
 */
async function keyboardPaintWaterAt12x4(page: Page): Promise<void> {
  await tabTo(page, { within: TILES_GROUP, text: 'water' })
  await page.keyboard.press('Enter')
  await expect(page.locator(TILES_GROUP).getByRole('button', { name: 'water' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await tabTo(page, { anchor: 'viewport.canvas' })
  await expect(page.locator(CANVAS)).toBeFocused()
  await page.keyboard.press('ArrowLeft') // summon at (16, 12)
  await expect(page.locator(COORDS)).toHaveText('(16, 12)')
  await pressTimes(page, 'ArrowLeft', 4) // west to x 12
  await pressTimes(page, 'ArrowDown', 8) // south to y 4 (up = north = +y)
  await expect(page.locator(COORDS)).toHaveText('(12, 4)')
  await page.keyboard.press('Enter')
  // The rail advance speaks LAST through the one voice ('painted 1 tile'
  // is overwritten in the same batch): the announcer lands on the step-3
  // announcement the two-step cascade produced.
  await expectAnnouncement(page, 'step 3 of 5: Place a crate')
}

/** Tab to a toolbar view button and press it, keyboard-only. */
async function pressViewButton(
  page: Page,
  anchor: 'toolbar.viewTopdown' | 'toolbar.viewIso' | 'toolbar.viewProfile',
  opts: { backward?: boolean } = {},
): Promise<void> {
  await tabTo(page, { anchor }, { backward: opts.backward ?? false, maxTabs: 60 })
  await page.keyboard.press('Enter')
}

/** Read a localStorage value from the page. */
function readStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), key)
}

// ---------------------------------------------------------------------------
// 1. Resume survives reload — the exit criterion, verbatim
// ---------------------------------------------------------------------------

test('resume survives reload: two completed steps land the rail on step 3, twice', async ({ page }) => {
  await bootFresh(page)

  // Fresh boot: the catalogue's first lesson greets a fresh student, at the
  // first step (main.tsx's resume-aware start with no stored progress).
  await expect(page.locator(`${LESSON} h2`)).toHaveText('First tiles')
  await expect(page.locator(LESSON)).toContainText('step 1 of 5')

  // ---- Complete step 1: pick water, paint anywhere ----------------------
  // Boot state is brush + grass, and grass-on-grass is a no-op, so the
  // first real paint starts at the water swatch — (18, 12) is clear of the
  // pond, the sand rim, and the player's cell.
  await tabTo(page, { within: TILES_GROUP, text: 'water' })
  await page.keyboard.press('Enter')
  await tabTo(page, { anchor: 'viewport.canvas' })
  await expect(page.locator(CANVAS)).toBeFocused()
  await page.keyboard.press('ArrowLeft') // summon at (16, 12)
  await pressTimes(page, 'ArrowRight', 2)
  await expect(page.locator(COORDS)).toHaveText('(18, 12)')
  await page.keyboard.press('Enter')
  // The rail advance is announced through the same one voice, last in the
  // batch — screen readers hear the step change, not just the paint.
  await expectAnnouncement(page, 'step 2 of 5: Find the address (12, 4)')
  await expect(page.locator(LESSON)).toContainText('step 2 of 5')

  // ---- Complete step 2: water on exactly (12, 4) ------------------------
  await pressTimes(page, 'ArrowLeft', 6)
  await pressTimes(page, 'ArrowDown', 8)
  await expect(page.locator(COORDS)).toHaveText('(12, 4)')
  await page.keyboard.press('Enter')
  await expect(page.locator(LESSON)).toContainText('step 3 of 5')
  await expect(page.locator(LESSON)).toContainText('Place a crate')

  // ---- RELOAD: the rail resumes on step 3, not step 1 -------------------
  // The world was never saved, so the document reboots as the starter — but
  // progress survived at 'editor:tutorial-progress', and step 3's
  // completion (entity-exists crate) is a world fact the starter does not
  // satisfy, so resume lands exactly where the student left off.
  await page.reload()
  await expect(page.locator(CANVAS)).toBeVisible()
  await expect(page.locator(`${LESSON} h2`)).toHaveText('First tiles')
  await expect(page.locator(LESSON)).toContainText('step 3 of 5')
  await expect(page.locator(LESSON)).toContainText('Place a crate')

  // ---- RELOAD again, having done nothing: resume is idempotent ----------
  await page.reload()
  await expect(page.locator(CANVAS)).toBeVisible()
  await expect(page.locator(`${LESSON} h2`)).toHaveText('First tiles')
  await expect(page.locator(LESSON)).toContainText('step 3 of 5')
})

// ---------------------------------------------------------------------------
// 2. Hints: reveal one by one, disable at zero, survive reload
// ---------------------------------------------------------------------------

test('hints reveal in order, the button disables at zero, and revealed hints survive reload', async ({
  page,
}) => {
  await bootFresh(page)
  await expect(page.locator(LESSON)).toContainText('step 1 of 5')

  const hintButton = page.locator(HINT_BUTTON)
  const hintItems = page.locator(`${LESSON} .lesson-hints li`)

  // The rail is the last region in the DOM, so the backward ring reaches
  // its buttons in a couple of stops: show-me, start-over, hint.
  await expect(hintButton).toHaveText('hint (2 left)')
  await tabTo(page, { anchor: 'panel.lessonHint' }, { backward: true })

  // First press: hints[0] appears, verbatim from the lesson data.
  await page.keyboard.press('Enter')
  await expect(hintItems).toHaveCount(1)
  await expect(hintItems.nth(0)).toHaveText(LESSON01_STEP1_HINT0)
  await expect(hintButton).toHaveText('hint (1 left)')

  // Second press (the button kept focus): hints[1], and the well runs dry.
  await page.keyboard.press('Enter')
  await expect(hintItems).toHaveCount(2)
  await expect(hintItems.nth(1)).toHaveText(LESSON01_STEP1_HINT1)
  await expect(hintButton).toHaveText('hint (none left)')
  await expect(hintButton).toBeDisabled()

  // RELOAD: progress stores revealedHints, so both hints come back revealed
  // — same step, same texts, same exhausted button.
  await page.reload()
  await expect(page.locator(CANVAS)).toBeVisible()
  await expect(page.locator(LESSON)).toContainText('step 1 of 5')
  await expect(hintItems).toHaveCount(2)
  await expect(hintItems.nth(0)).toHaveText(LESSON01_STEP1_HINT0)
  await expect(hintItems.nth(1)).toHaveText(LESSON01_STEP1_HINT1)
  await expect(hintButton).toBeDisabled()
})

// ---------------------------------------------------------------------------
// 3. Reset: hints collapse, the step does NOT rewind
// ---------------------------------------------------------------------------

test('start-over on an onEnter-overlay step collapses hints without rewinding', async ({ page }) => {
  await bootFresh(page)
  await expect(page.locator(`${LESSON} h2`)).toHaveText('First tiles')

  // Switch to lesson-02 with the KEYBOARD: Tab (backward — the picker sits
  // in the rail at the end of the ring) to the select, then TYPE-AHEAD: 't'
  // jumps the closed select to the next option starting with T ("The
  // distance picture") and fires change. Type-ahead is the closed-select
  // keyboard idiom that works on every platform model; arrow keys cannot be
  // pinned here — under Chromium's darwin keyboard model they open the
  // NATIVE popup, which headless cannot render, so they change nothing
  // (probed and verified on this host; a platform constraint, not an app
  // bug — the select is a native element, and its arrows never reach it).
  await tabTo(page, { anchor: 'panel.lessonPicker' }, { backward: true })
  await page.keyboard.press('t')
  await expect(page.locator(`${LESSON} h2`)).toHaveText('The distance picture')
  await expect(page.locator(LESSON)).toContainText('step 1 of 5')
  await expect(page.locator(LESSON)).toContainText('Three steps east')

  // ---- Legitimately reach step 2 (the onEnter-overlay step): place a
  // crate on (19, 12), three east of the player -------------------------
  await tabTo(page, { within: THINGS_GROUP, text: 'crate' }, { backward: true })
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-anchor="toolbar.placer"]')).toHaveAttribute('aria-pressed', 'true')
  await tabTo(page, { anchor: 'viewport.canvas' })
  await expect(page.locator(CANVAS)).toBeFocused()
  await page.keyboard.press('ArrowLeft') // summon at (16, 12)
  await pressTimes(page, 'ArrowRight', 3)
  await expect(page.locator(COORDS)).toHaveText('(19, 12)')
  await page.keyboard.press('Enter')
  // The step advance speaks last ('placed crate' is overwritten in-batch).
  await expectAnnouncement(page, 'step 2 of 5: Now four north')
  await expect(page.locator(LESSON)).toContainText('step 2 of 5')
  await expect(page.locator(LESSON)).toContainText('Now four north')

  // Reveal a hint on the step whose onEnter declares the distance triangle.
  const hintItems = page.locator(`${LESSON} .lesson-hints li`)
  await tabTo(page, { anchor: 'panel.lessonHint' })
  await page.keyboard.press('Enter')
  await expect(hintItems).toHaveCount(1)
  await expect(page.locator(HINT_BUTTON)).toHaveText('hint (1 left)')

  // Start over: reset re-enters the CURRENT step — revealed hints collapse
  // to none, onEnter re-applies, and progress does NOT rewind to step 1
  // (types.ts: "reset is an escape hatch, not an undo").
  await tabTo(page, { anchor: 'panel.lessonReset' })
  await page.keyboard.press('Enter')
  await expect(hintItems).toHaveCount(0)
  await expect(page.locator(HINT_BUTTON)).toHaveText('hint (2 left)')
  await expect(page.locator(HINT_BUTTON)).toBeEnabled()
  await expect(page.locator(LESSON)).toContainText('step 2 of 5')
  await expect(page.locator(LESSON)).toContainText('Now four north')
})

// ---------------------------------------------------------------------------
// 4. The picker + fixture flow: park, refuse save, finish, come home
// ---------------------------------------------------------------------------

test('three-views parks the world, refuses save, and Back-to-my-world restores it', async ({
  page,
}) => {
  const entityRows = page.locator(`${ENTITIES_PANEL} ul button`)
  await bootFresh(page)

  // Give the student's world a distinctive, UNSAVED mark first: water on
  // (12, 4). On fresh lesson-01 this single paint advances the rail to
  // step 3 of 5 — the event-then-world cascade, pinned in passing.
  await keyboardPaintWaterAt12x4(page)
  await expect(page.locator(LESSON)).toContainText('step 3 of 5')
  await expect(entityRows).toHaveText(['player'])

  // ---- Switch to the fixture lesson (picker keyboard twin proved above) --
  await page.locator(PICKER).selectOption('three-views')
  await expect(page.locator(`${LESSON} h2`)).toHaveText('Three views of one world')
  await expect(page.locator(LESSON)).toContainText('step 1 of 4')
  await expect(page.locator(LESSON)).toContainText('The map view')

  // The world SWAPPED: the island cast, in deterministic entity order — the
  // tree is the distinctive stranger no student world contains.
  await expect(entityRows).toHaveText([...ISLAND_CAST])
  // The student's world is parked, and the status bar keeps telling them so.
  expect(await readStorage(page, PARKED_KEY)).not.toBeNull()
  await expect(page.locator(SAVE_STATE)).toContainText('unsaved')
  await expect(page.locator(SAVE_STATE)).toContainText(FIXTURE_BADGE)
  // The step opened in top-down (onEnter), the toolbar mirror agrees.
  await expect(page.locator(VIEW_TOPDOWN)).toHaveAttribute('aria-checked', 'true')

  // ---- Ctrl+S is REFUSED while the fixture is live ----------------------
  await page.keyboard.press('Control+s')
  await expect(page.locator(SAVE_STATE)).toContainText('unsaved')
  await expect(page.locator(SAVE_STATE)).toContainText(FIXTURE_SAVE_REFUSED)
  // Storage was never touched: the refusal has zero side effects.
  expect(await readStorage(page, WORLD_KEY)).toBeNull()

  // ---- Complete the lesson, keyboard-only, one view flip per step -------
  await pressViewButton(page, 'toolbar.viewIso', { backward: true })
  await expect(page.locator(VIEW_ISO)).toHaveAttribute('aria-checked', 'true')
  // The step advance is the last (and kept) announcement of the batch —
  // 'switched to iso view' was spoken into the same slot and overwritten.
  await expect(page.locator(ANNOUNCEMENTS)).toContainText('step 2 of 4: Squares into diamonds')
  await expect(page.locator(LESSON)).toContainText('step 2 of 4')

  await pressViewButton(page, 'toolbar.viewProfile')
  await expect(page.locator(VIEW_PROFILE)).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator(LESSON)).toContainText('step 3 of 4')

  await pressViewButton(page, 'toolbar.viewTopdown', { backward: true })
  await expect(page.locator(VIEW_TOPDOWN)).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator(LESSON)).toContainText('step 4 of 4')
  await expect(page.locator(LESSON)).toContainText('Three pictures, one world')

  // One more flip — builder's choice — finishes the lesson.
  await pressViewButton(page, 'toolbar.viewIso')
  await expect(page.locator(LESSON)).toContainText('You finished the whole lesson!')
  // Reaching done cleans the stage: the lens returns to the island's own
  // primary projection, so top-down reads pressed again.
  await expect(page.locator(VIEW_TOPDOWN)).toHaveAttribute('aria-checked', 'true')

  // ---- Back to my world -------------------------------------------------
  const backButton = page.locator(LESSON).getByRole('button', { name: 'Back to my world' })
  await expect(backButton).toBeVisible()
  await tabTo(page, { within: LESSON, text: 'Back to my world' })
  await page.keyboard.press('Enter')

  // The student's own world returned — crate-free starter cast, their name,
  // and the park is SPENT (so the button is gone).
  await expect(entityRows).toHaveText(['player'])
  await expect(page.locator(WORLD_NAME)).toHaveValue('my first world')
  expect(await readStorage(page, PARKED_KEY)).toBeNull()
  await expect(backButton).toHaveCount(0)
  // The badge is honestly UNSAVED with the keep-it message: the restored
  // bytes sit in no save slot (the park was just spent, and this world was
  // never saved) — 'saved' here would be a silent data-loss window.
  await expect(page.locator(SAVE_STATE)).toContainText('unsaved')
  await expect(page.locator(SAVE_STATE)).toContainText(PARK_RESTORED_BADGE)

  // The painted water survived the round trip: select-tool inspection at
  // (12, 4), exactly like keyboard-flow verifies a reloaded tile.
  await tabTo(page, { anchor: 'viewport.canvas' })
  await expect(page.locator(CANVAS)).toBeFocused()
  await page.keyboard.press('v')
  await expect(page.locator('[data-anchor="toolbar.select"]')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowLeft') // summon at (16, 12)
  await pressTimes(page, 'ArrowLeft', 4)
  await pressTimes(page, 'ArrowDown', 8)
  await expect(page.locator(COORDS)).toHaveText('(12, 4)')
  await page.keyboard.press('Enter')
  await expect(page.locator(INSPECTOR)).toContainText('(12, 4)')
  await expect(page.locator(INSPECTOR)).toContainText('water')

  // ---- Save works again -------------------------------------------------
  await page.keyboard.press('Control+s')
  await expectAnnouncement(page, 'saved world')
  await expect(page.locator(SAVE_STATE)).toHaveText('saved')
  const savedText = await readStorage(page, WORLD_KEY)
  expect(savedText).not.toBeNull()
  expect((JSON.parse(savedText ?? 'null') as { meta: { name: string } }).meta.name).toBe(
    'my first world',
  )
})

// ---------------------------------------------------------------------------
// 5. Reload mid-fixture: boot restores the park FIRST, resume re-parks
// ---------------------------------------------------------------------------

test('reloading mid-fixture re-parks the student world and resumes on the island', async ({
  page,
}) => {
  const entityRows = page.locator(`${ENTITIES_PANEL} ul button`)
  await bootFresh(page)

  // The student's own (unsaved) world gets its distinctive mark — water on
  // (12, 4) — so the park's CONTENT can be told apart from a plain starter
  // world below. This is what makes the boot cycle observable.
  await keyboardPaintWaterAt12x4(page)

  // Start the fixture lesson (parks the water-marked world), complete just
  // step 1 (switch to Iso), leaving the student mid-fixture on step 2.
  await page.locator(PICKER).selectOption('three-views')
  await expect(entityRows).toHaveText([...ISLAND_CAST])
  await expect(page.locator(LESSON)).toContainText('step 1 of 4')
  await pressViewButton(page, 'toolbar.viewIso', { backward: true })
  await expect(page.locator(LESSON)).toContainText('step 2 of 4')

  // ---- RELOAD mid-fixture ----------------------------------------------
  // main.tsx's cycle: the session boots (no save slot → starter), the boot
  // restore brings the PARKED water-world back and spends the park, and the
  // resume-aware start then RE-PARKS that world and re-loads the island.
  await page.reload()
  await expect(page.locator(CANVAS)).toBeVisible()

  // End state: the island is live and the rail resumed on step 2.
  await expect(entityRows).toHaveText([...ISLAND_CAST])
  await expect(page.locator(`${LESSON} h2`)).toHaveText('Three views of one world')
  await expect(page.locator(LESSON)).toContainText('step 2 of 4')
  await expect(page.locator(LESSON)).toContainText('Squares into diamonds')
  // Step 2's onEnter re-applied its view: the Iso lens is up again.
  await expect(page.locator(VIEW_ISO)).toHaveAttribute('aria-checked', 'true')

  // The park is present — and it holds the STUDENT's world (the painted
  // water at ground cell (12, 4), index 4·32+12), not island scenery and
  // not a plain starter. Had boot skipped the restore, the re-park would
  // have parked an unmarked starter; had resume skipped the re-park, the
  // key would be gone: either failure is visible right here.
  const parkedRaw = await readStorage(page, PARKED_KEY)
  expect(parkedRaw).not.toBeNull()
  const parked = JSON.parse(parkedRaw ?? 'null') as {
    meta: { name: string }
    layers: ReadonlyArray<{ id: string; width: number; cells: ReadonlyArray<number> }>
  }
  expect(parked.meta.name).toBe('my first world')
  const ground = parked.layers.find((layer) => layer.id === 'ground')
  expect(ground).toBeDefined()
  expect(ground?.cells[4 * (ground?.width ?? 0) + 12]).toBe(2) // water at (12, 4)

  // And save is still refused: the live document is a fixture again.
  await page.keyboard.press('Control+s')
  await expect(page.locator(SAVE_STATE)).toContainText('unsaved')
  await expect(page.locator(SAVE_STATE)).toContainText(FIXTURE_SAVE_REFUSED)
  expect(await readStorage(page, WORLD_KEY)).toBeNull()
})

// ---------------------------------------------------------------------------
// 6. The "show me" spotlight: masked, click-through, self-hiding
// ---------------------------------------------------------------------------

test('show-me spotlights the palette with click-through, toggles off, and hides on action', async ({
  page,
}) => {
  await bootFresh(page)
  await expect(page.locator(LESSON)).toContainText('step 1 of 5')

  const panels = page.locator(SPOTLIGHT_PANELS)
  const ring = page.locator(SPOTLIGHT_RING)
  const showMe = page.locator(SHOW_ME_BUTTON)

  // Step 1 targets the tile palette (anchor palette.tiles): show-me raises
  // the DOM spotlight — four mask panels framing the hole plus the ring.
  await tabTo(page, { anchor: 'panel.lessonShowMe' }, { backward: true })
  await page.keyboard.press('Enter')
  await expect(panels).toHaveCount(4)
  await expect(ring).toHaveCount(1)
  await expect(showMe).toHaveAttribute('aria-pressed', 'true')

  // The hole is the ABSENCE of an element: elementFromPoint at the tile
  // palette's center reaches the palette itself (a real click there would
  // be the lesson's real action — nothing intercepts it).
  const reachesPalette = await page.evaluate(() => {
    const group = document.querySelector('[data-anchor="palette.tiles"]')
    if (group === null) return false
    const rect = group.getBoundingClientRect()
    const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return el !== null && el.closest('[data-anchor="palette.tiles"]') !== null
  })
  expect(reachesPalette).toBe(true)

  // Second press: the toggle's other half — everything comes down.
  await page.keyboard.press('Enter')
  await expect(panels).toHaveCount(0)
  await expect(ring).toHaveCount(0)
  await expect(showMe).toHaveAttribute('aria-pressed', 'false')

  // Third press: up again — then the student ACTS, and the pointer puts
  // itself away on the builder event.
  await page.keyboard.press('Enter')
  await expect(panels).toHaveCount(4)

  // Picking a tile is not a builder event — the spotlight stays up while
  // the student sets up the very action it points at.
  await tabTo(page, { within: TILES_GROUP, text: 'water' }, { backward: true })
  await page.keyboard.press('Enter')
  await expect(panels).toHaveCount(4)

  // Paint (the pointed-at action): the tile-painted event hides the
  // spotlight and completes the step.
  await tabTo(page, { anchor: 'viewport.canvas' })
  await expect(page.locator(CANVAS)).toBeFocused()
  await page.keyboard.press('ArrowLeft') // summon at (16, 12)
  await pressTimes(page, 'ArrowRight', 2) // (18, 12): clear of pond and rim
  await page.keyboard.press('Enter')
  // The step advance speaks last through the one voice (see test 1).
  await expectAnnouncement(page, 'step 2 of 5: Find the address (12, 4)')
  await expect(panels).toHaveCount(0)
  await expect(ring).toHaveCount(0)
  await expect(page.locator(LESSON)).toContainText('step 2 of 5')
})

// ---------------------------------------------------------------------------
// 7. axe-core across tutorial states
// ---------------------------------------------------------------------------

/** Serious/critical violations only — the gate's bar, same as keyboard-flow;
 * lesser findings are printed for free but do not fail the gate. */
function severeViolations(results: Awaited<ReturnType<AxeBuilder['analyze']>>, state: string) {
  const severe = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  const lesser = results.violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical')
  if (lesser.length > 0) {
    console.log(`[axe:${state}] ${lesser.length} non-serious violation(s), informational only:`)
    for (const v of lesser) {
      const targets = v.nodes.map((n) => n.target.join(' ')).join(' | ')
      console.log(`  - ${v.id} (impact: ${v.impact ?? 'none'}): ${v.help} — at: ${targets}`)
    }
  }
  return severe
}

test('axe-core scan: no serious/critical violations across four tutorial states', async ({
  page,
}) => {
  await bootFresh(page)

  // ---- State 1: the booted rail ----------------------------------------
  await expect(page.locator(`${LESSON} h2`)).toHaveText('First tiles')
  await expect(page.locator(ENTITIES_PANEL)).toContainText('player')
  let severe = severeViolations(await new AxeBuilder({ page }).analyze(), 'booted-rail')
  expect(severe, `booted rail:\n${JSON.stringify(severe, null, 2)}`).toEqual([])

  // ---- State 2: hints revealed -----------------------------------------
  // The keyboard twin of these presses is proved in the hint test above;
  // the scan only needs the state, so clicks are fine here.
  await page.locator(HINT_BUTTON).click()
  await page.locator(HINT_BUTTON).click()
  await expect(page.locator(`${LESSON} .lesson-hints li`)).toHaveCount(2)
  await expect(page.locator(HINT_BUTTON)).toBeDisabled()
  severe = severeViolations(await new AxeBuilder({ page }).analyze(), 'hints-revealed')
  expect(severe, `hints revealed:\n${JSON.stringify(severe, null, 2)}`).toEqual([])

  // ---- State 3: the spotlight ACTIVE (dimmer up) ------------------------
  // Collapse the hints back (reset) so the scanned state is the spotlight
  // itself, then raise it. The dimmer panels are pure decoration (empty
  // divs — no text of their own), so a color-contrast finding here would
  // have to come from PAGE text axe measures against the dim overlay; the
  // gate keeps the full serious/critical bar and lets the run say whether
  // that ever happens (it did not when this gate was blessed).
  await page.locator(RESET_BUTTON).click()
  await expect(page.locator(`${LESSON} .lesson-hints li`)).toHaveCount(0)
  await page.locator(SHOW_ME_BUTTON).click()
  await expect(page.locator(SPOTLIGHT_PANELS)).toHaveCount(4)
  severe = severeViolations(await new AxeBuilder({ page }).analyze(), 'spotlight-active')
  expect(severe, `spotlight active:\n${JSON.stringify(severe, null, 2)}`).toEqual([])

  // Escape is the spotlight's designed "no thanks" — and the only pointer-
  // free way out, since the show-me button now sits under the dimmer.
  await page.keyboard.press('Escape')
  await expect(page.locator(SPOTLIGHT_PANELS)).toHaveCount(0)

  // ---- State 4: the iso lens on the fixture -----------------------------
  await page.locator(PICKER).selectOption('three-views')
  await expect(page.locator(ENTITIES_PANEL)).toContainText('tree')
  await page.locator(VIEW_ISO).click()
  await expect(page.locator(VIEW_ISO)).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator(LESSON)).toContainText('step 2 of 4')
  severe = severeViolations(await new AxeBuilder({ page }).analyze(), 'iso-fixture')
  expect(severe, `iso view on fixture:\n${JSON.stringify(severe, null, 2)}`).toEqual([])
})
