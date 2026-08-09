/**
 * Shared e2e helpers — extracted verbatim from keyboard-flow.spec.ts so the
 * Phase 3 tutorial gates (tutorial-flow.spec.ts) walk the editor with the
 * exact same keyboard discipline the Phase 2 gate proved out.
 *
 * Everything here is keyboard-first plumbing: focus travels exclusively by
 * real Tab / Shift+Tab presses starting from wherever focus stands, which
 * makes the tab ring itself an assertion — if a control ever drops out of
 * the focus order, `tabTo` exhausts its budget and fails with the path it
 * walked. Announcer assertions go through `expectAnnouncement`, which
 * tolerates the StatusBar's zero-width re-announcement suffix (U+200B on odd
 * action counts — invisible and unspoken, but very much part of textContent).
 */

import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Anchor selectors — the same data-anchor ids lessons target (anchors.ts).
// ---------------------------------------------------------------------------

export const CANVAS = '[data-anchor="viewport.canvas"]'
export const ANNOUNCEMENTS = '[data-anchor="status.announcements"]'
export const SAVE_STATE = '[data-anchor="status.saveState"]'
export const COORDS = '[data-anchor="status.coords"]'
export const WORLD_NAME = '[data-anchor="toolbar.worldName"]'
export const ENTITIES_PANEL = '[data-anchor="panel.entities"]'
export const INSPECTOR = '[data-anchor="panel.inspector"]'
export const LESSON = '[data-anchor="panel.lesson"]'
export const TILES_GROUP = '[data-anchor="palette.tiles"]'
export const THINGS_GROUP = '[data-anchor="palette.entities"]'

/** Where focus should land: an anchored element, or a button (identified by
 * its exact trimmed text) inside a group given as a full CSS selector. */
export type FocusTarget = { anchor: string } | { within: string; text: string }

/** Does document.activeElement match the target right now? */
function focusMatches(page: Page, target: FocusTarget): Promise<boolean> {
  return page.evaluate((t) => {
    const el = document.activeElement
    if (!(el instanceof HTMLElement)) return false
    if ('anchor' in t) return el.dataset['anchor'] === t.anchor
    const group = document.querySelector(t.within)
    return group !== null && group.contains(el) && (el.textContent ?? '').trim() === t.text
  }, target)
}

/** A short name for whatever holds focus — for the failure message only. */
function describeFocus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!(el instanceof HTMLElement)) return '(no element focus)'
    return el.dataset['anchor'] ?? `${el.tagName.toLowerCase()}"${(el.textContent ?? '').trim().slice(0, 24)}"`
  })
}

/**
 * Press Tab (or Shift+Tab) until the target owns document.activeElement.
 * This IS the focus-order assertion: an unreachable control exhausts the
 * budget and fails with the exact ring of stops the keyboard visited.
 */
export async function tabTo(
  page: Page,
  target: FocusTarget,
  opts: { backward?: boolean; maxTabs?: number } = {},
): Promise<void> {
  const key = (opts.backward ?? false) ? 'Shift+Tab' : 'Tab'
  const maxTabs = opts.maxTabs ?? 40
  const walked: string[] = []
  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press(key)
    if (await focusMatches(page, target)) return
    walked.push(await describeFocus(page))
  }
  throw new Error(
    `focus never reached ${JSON.stringify(target)} after ${maxTabs} ${key} presses — ` +
      `the keyboard walked: ${walked.join(' → ')}`,
  )
}

/**
 * Assert the live announcer's exact text. The StatusBar appends a
 * zero-width space (U+200B) to the label on odd action counts so that two
 * identical consecutive labels still mutate the live region's text node
 * (screen readers only re-announce on mutation) — invisible and unspoken,
 * but very much part of textContent, so exact-match assertions must accept
 * an optional trailing U+200B.
 */
export function expectAnnouncement(page: Page, text: string): Promise<void> {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return expect(page.locator(ANNOUNCEMENTS)).toHaveText(new RegExp(`^${escaped}\u200B?$`))
}

/** Boot the editor with EMPTY storage: land on the origin, clear
 * localStorage, reload — the session falls back to the pinned starter. */
export async function bootFresh(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.locator(CANVAS)).toBeVisible()
}
