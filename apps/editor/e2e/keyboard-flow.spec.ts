/**
 * Phase 2 exit gate: the keyboard-only build-save-reload flow, plus the
 * axe-core scan (docs/ROADMAP.md — "keyboard-only build-save-reload
 * Playwright flow + axe-core scan green").
 *
 * Everything after page load happens through the KEYBOARD — no page.click,
 * no mouse, no locator.focus() seeding. Focus travels exclusively by real
 * Tab / Shift+Tab presses starting from the page's own initial focus (the
 * body), which makes the tab ring itself an assertion: if a control ever
 * drops out of the focus order, `tabTo` exhausts its budget and fails with
 * the path it walked. (Tab-from-body proved reliable in headless Chromium,
 * so the allowed fallback of seeding the first focus was never needed.)
 *
 * The flow leans on the pinned starter-world contract
 * (src/editor/types.ts): a 32×24 grass ground layer with a water pond and
 * its one-cell sand rim, a player standing at (16.5, 12.5) — the CENTER of
 * cell (16, 12), where cell-dwellers stand — and the name "my first world";
 * the session boots with the brush active and activeTile 1 (grass), so any
 * real paint must first pick a different tile — water, palette value 2.
 * Assertion strings come from THE announcement table (describeEvent in
 * src/editor/session.ts) and the command labels
 * (src/editor/commands/entity-commands.ts), so a wording change there fails
 * here by design; announcer assertions go through expectAnnouncement (shared
 * plumbing in ./helpers.ts, alongside tabTo and the anchor selectors),
 * which tolerates the StatusBar's zero-width re-announcement suffix.
 *
 * A fresh boot with no stored progress now greets the student with the
 * catalogue's FIRST lesson, 'Paint by numbers' — a fixture lesson that parks
 * whatever world was live (main.tsx). This suite's subject is the starter
 * world, walked by 'First tiles' (now second), so the build flow opens that
 * lesson from the library, KEYBOARD-only, before it starts — the twin of
 * tutorial-flow's pointer openLessonFromLibrary, shared here as
 * openLessonFromLibraryByKeyboard (./helpers.ts). Opening a NON-fixture
 * lesson restores the boot-parked starter world first (LessonPane.
 * openLesson), so the walkthrough below meets exactly the contract above.
 *
 * Keyboard chords use Control (not Meta) even on darwin hosts: the shell
 * binds both (App.tsx checks `e.ctrlKey || e.metaKey`), and headless
 * Chromium receives page-level Control+S without a browser save dialog —
 * verified working in this suite.
 */

import { expect, test } from '@playwright/test'
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
  openLessonFromLibraryByKeyboard,
  SAVE_STATE,
  tabTo,
  THINGS_GROUP,
  TILES_GROUP,
  WORLD_NAME,
} from './helpers'

/** The save badge right after opening a non-fixture lesson from the library
 * with a park waiting (session.ts PARK_RESTORED_MESSAGE): the restored
 * bytes sit in NO save slot until the student saves, so the badge stays
 * honestly 'unsaved' with the keep-it message appended. */
const PARK_RESTORED_BADGE = 'back from the lesson — press Ctrl+S to keep your world'

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

test('keyboard-only build → move → save → reload → restore-backup', async ({ page }) => {
  // Entity rows render in entityIds() order — THE deterministic order — so
  // exact toHaveText([...]) assertions on this locator are stable.
  const entityRows = page.locator(`${ENTITIES_PANEL} ul button`)

  // ---- 1. Fresh boot, then keyboard-switch to 'First tiles' -------------
  // Fresh boot now opens 'Paint by numbers' on the bear-portrait fixture
  // (main.tsx) — this flow is First tiles's own starter-world walkthrough,
  // so it opens that lesson from the library first. Keyboard-only, like
  // every other step here: 'All lessons' is the lesson pane's own back
  // control, reachable the moment a lesson document is on screen.
  await bootFresh(page)
  await expect(page.locator(`${LESSON} h2`)).toHaveText('Paint by numbers')
  await openLessonFromLibraryByKeyboard(page, 'First tiles')

  // Opening a NON-fixture lesson restores the boot-parked starter world
  // first (LessonPane.openLesson), so the walkthrough meets exactly the
  // starter-world contract the header describes. The badge is honestly
  // UNSAVED with the keep-it message: the just-restored bytes sit in no
  // save slot yet — 'saved' here would be a silent data-loss window.
  await expect(entityRows).toHaveText(['player'])
  await expect(page.locator(`${LESSON} h2`)).toHaveText('First tiles')
  await expect(page.locator(LESSON)).toContainText('step 1 of 5')
  await expect(page.locator(WORLD_NAME)).toHaveValue('my first world')
  await expect(page.locator(SAVE_STATE)).toContainText('unsaved')
  await expect(page.locator(SAVE_STATE)).toContainText(PARK_RESTORED_BADGE)

  // ---- 2. Keyboard-paint water -----------------------------------------
  // Boot state is brush + grass, and painting grass on grass is a no-op —
  // so the first real paint starts at the water swatch (palette value 2).
  await tabTo(page, { within: TILES_GROUP, text: 'water' })
  await page.keyboard.press('Enter')
  await expect(page.locator(TILES_GROUP).getByRole('button', { name: 'water' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // Picking a tile auto-switches to the brush; the toolbar toggle agrees.
  await expect(page.locator('[data-anchor="toolbar.brush"]')).toHaveAttribute('aria-pressed', 'true')

  await tabTo(page, { anchor: 'viewport.canvas' })
  await expect(page.locator(CANVAS)).toBeFocused()

  // First arrow press SUMMONS the cursor at the layer center (16, 12) —
  // the press spends itself on appearing; its delta is deliberately ignored.
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator(COORDS)).toHaveText('(16, 12)')
  // Walk to (18, 12): clear of the pond, the player's cell, and the shore.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator(COORDS)).toHaveText('(18, 12)')

  await page.keyboard.press('Enter')
  // The tile-painted event completes lesson step 1, and the rail's advance
  // speaks LAST through the one voice — so the live region ends the batch
  // on the step announcement, not 'painted 1 tile' (the tutorial change is
  // the news a screen-reader user needs; the paint was their own action).
  await expectAnnouncement(page, 'step 2 of 5: Find the address (12, 4)')
  await expect(page.locator(LESSON)).toContainText('step 2 of 5')

  // ---- 3. Keyboard-place a crate ---------------------------------------
  // The entity palette sits before the canvas in the tab ring: Shift+Tab.
  await tabTo(page, { within: THINGS_GROUP, text: 'crate' }, { backward: true })
  await page.keyboard.press('Enter')
  await expect(page.locator(THINGS_GROUP).getByRole('button', { name: 'crate' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // Picking a marker auto-switches to the placer.
  await expect(page.locator('[data-anchor="toolbar.placer"]')).toHaveAttribute('aria-pressed', 'true')

  await tabTo(page, { anchor: 'viewport.canvas' })
  await expect(page.locator(CANVAS)).toBeFocused()
  // The cell cursor survives palette round-trips: still at (18, 12).
  await page.keyboard.press('ArrowUp') // (18, 13) — its own cell (up = north = +y)
  await expect(page.locator(COORDS)).toHaveText('(18, 13)')
  await page.keyboard.press('Enter')
  await expectAnnouncement(page, 'placed crate')
  await expect(entityRows).toHaveText(['player', 'crate'])

  // ---- 4. Undo/redo from the keyboard ----------------------------------
  // Focus is on the canvas; its handler passes chords through to the
  // window-level listener (App.tsx), which binds Control AND Meta — the
  // suite uses Control, which headless Chromium delivers on every host.
  await page.keyboard.press('Control+z')
  await expectAnnouncement(page, 'undid: place crate')
  await expect(entityRows).toHaveText(['player'])

  await page.keyboard.press('Control+Shift+z')
  await expectAnnouncement(page, 'redid: place crate')
  await expect(entityRows).toHaveText(['player', 'crate'])

  // ---- 5. Keyboard-move the crate: select → grab → carry → drop --------
  // The keyboard twin of a pointer drag (select.ts): Enter on the SELECTED
  // entity's cell grabs it, arrows carry the ghost cell-center to
  // cell-center, Enter drops — one move-entity, one announcement. The redo
  // above left the crate selected (the placer selects what it makes, and
  // the mirror re-read the restored entity), so the walk starts by
  // selecting a plain tile — proving on the way that Enter on a cell the
  // selected entity does NOT stand on picks instead of grabbing.
  await page.keyboard.press('v')
  await expect(page.locator('[data-anchor="toolbar.select"]')).toHaveAttribute('aria-pressed', 'true')
  // The cell cursor survived the undo/redo: still on the crate's (18, 13).
  await page.keyboard.press('ArrowLeft') // step off to (17, 13)
  await expect(page.locator(COORDS)).toHaveText('(17, 13)')
  await page.keyboard.press('Enter') // selects the grass tile there
  await expect(page.locator(INSPECTOR)).toContainText('(17, 13)')
  await expect(page.locator(INSPECTOR)).toContainText('grass')
  // Walk back onto the crate's cell: the selection is a tile right now, so
  // this Enter SELECTS the crate (a pick, not a grab).
  await page.keyboard.press('ArrowRight') // (18, 13)
  await expect(page.locator(COORDS)).toHaveText('(18, 13)')
  await page.keyboard.press('Enter')
  await expect(page.locator(INSPECTOR)).toContainText('crate')
  // The placer stood it on the CELL CENTER — the tileToWorld +0.5 lesson.
  await expect(page.locator(INSPECTOR)).toContainText('(18.5, 13.5)')
  // Enter again on the selected crate's own cell GRABS it; two arrows
  // carry; Enter drops. The announcement string is describeEvent's
  // builder.entity-moved line: "moved " + the entity's name.
  await page.keyboard.press('Enter') // grab — silent by design
  await page.keyboard.press('ArrowRight') // carry to (19, 13)
  await page.keyboard.press('ArrowUp') // carry to (19, 14) — north is up
  await expect(page.locator(COORDS)).toHaveText('(19, 14)')
  await page.keyboard.press('Enter') // drop
  await expectAnnouncement(page, 'moved crate')
  // The inspector's position line moved with it: the drop cell's center.
  await expect(page.locator(INSPECTOR)).toContainText('(19.5, 14.5)')

  // ---- 6. Save with Control+S ------------------------------------------
  await page.keyboard.press('Control+s')
  await expectAnnouncement(page, 'saved world')
  await expect(page.locator(SAVE_STATE)).toHaveText('saved')

  const savedText = await page.evaluate(() => localStorage.getItem('editor:world'))
  expect(savedText).not.toBeNull()
  const savedWorld = JSON.parse(savedText ?? 'null') as { meta: { name: string } }
  expect(savedWorld.meta.name).toBe('my first world')

  // ---- 7. Reload — the world came back ---------------------------------
  await page.reload()
  await expect(page.locator(CANVAS)).toBeVisible()
  await expect(entityRows).toHaveText(['player', 'crate'])
  await expect(page.locator(SAVE_STATE)).toHaveText('saved')
  await expect(page.locator(WORLD_NAME)).toHaveValue('my first world')

  // Keyboard-verify the painted tile survived: select tool, walk the fresh
  // cursor (summoned at center again — new session) to (18, 12), Enter.
  await tabTo(page, { anchor: 'viewport.canvas' })
  await expect(page.locator(CANVAS)).toBeFocused()
  await page.keyboard.press('v')
  await expect(page.locator('[data-anchor="toolbar.select"]')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator(COORDS)).toHaveText('(16, 12)')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator(COORDS)).toHaveText('(18, 12)')
  await page.keyboard.press('Enter')
  await expect(page.locator(INSPECTOR)).toContainText('(18, 12)')
  await expect(page.locator(INSPECTOR)).toContainText('water')

  // ---- 8. Restore-backup smoke -----------------------------------------
  // A backup slot appears when a save demotes a previous save. Make one
  // more visible change (paint (19, 12) water) and save again.
  await tabTo(page, { within: TILES_GROUP, text: 'water' }, { backward: true })
  await page.keyboard.press('Enter')
  await tabTo(page, { anchor: 'viewport.canvas' })
  await expect(page.locator(CANVAS)).toBeFocused()
  await page.keyboard.press('ArrowRight') // cursor was at (18, 12)
  await expect(page.locator(COORDS)).toHaveText('(19, 12)')
  await page.keyboard.press('Enter')
  await expectAnnouncement(page, 'painted 1 tile')

  await page.keyboard.press('Control+s')
  await expect(page.locator(SAVE_STATE)).toHaveText('saved')
  const backupText = await page.evaluate(() => localStorage.getItem('editor:world.backup'))
  expect(backupText).not.toBeNull()

  // Corrupt the base slot; the boot ladder must rescue from the backup and
  // SAY SO in the UI (state 'restored' + the student-language sentence).
  await page.evaluate(() => localStorage.setItem('editor:world', 'garbage'))
  await page.reload()
  await expect(page.locator(CANVAS)).toBeVisible()
  await expect(page.locator(SAVE_STATE)).toContainText('restored')
  await expect(page.locator(SAVE_STATE)).toContainText('backup')
  await expect(page.locator(ANNOUNCEMENTS)).toContainText('brought back from a backup')
  // The backup is the FIRST save — crate included: the world truly came back.
  await expect(entityRows).toHaveText(['player', 'crate'])
})

// ---------------------------------------------------------------------------
// The axe-core scan
// ---------------------------------------------------------------------------

test('axe-core scan: no serious or critical violations on the booted editor', async ({ page }) => {
  await bootFresh(page)
  // Fully booted: the lesson rail has published the tutorial engine's first
  // step — the last panel to fill in — so the scan sees the editor a student
  // actually meets. That is 'Paint by numbers' on the bear-portrait fixture
  // now (main.tsx) — a pixel-art character carries no entities, so the
  // panel shows its own empty state instead of 'player'.
  await expect(page.locator(`${LESSON} h2`)).toHaveText('Paint by numbers')
  await expect(page.locator(ENTITIES_PANEL)).toContainText('Nothing in the world yet')

  const results = await new AxeBuilder({ page }).analyze()

  const severe = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  const lesser = results.violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical')

  // Lesser violations are informational, not gate failures — but they are
  // printed so nobody has to re-run axe by hand to learn about them.
  if (lesser.length > 0) {
    console.log(`[axe] ${lesser.length} non-serious violation(s), informational only:`)
    for (const v of lesser) {
      const targets = v.nodes.map((n) => n.target.join(' ')).join(' | ')
      console.log(`  - ${v.id} (impact: ${v.impact ?? 'none'}): ${v.help} — at: ${targets}`)
    }
  }

  expect(
    severe,
    `serious/critical axe violations:\n${JSON.stringify(severe, null, 2)}`,
  ).toEqual([])
})
