/**
 * The spotlight's guarantees, proven in a real Chromium: the four-panel mask
 * exists, the ring hugs the target, and — the whole point of the design —
 * the hole is real ABSENCE: elementFromPoint at the target's center finds
 * the target itself, and a real user click there is a plain click on the
 * button, no interception, no re-dispatch. Same browser-project conventions
 * as apps/three-windows/test/views.browser.test.ts, minus the screenshots —
 * these assertions are about hit-testing, which no screenshot can see.
 */

import { afterEach, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createDomSpotlight } from '../src/spotlight'
import type { DomSpotlight } from '../src/types'

let spotlight: DomSpotlight | null = null
const mounted: HTMLElement[] = []

afterEach(() => {
  spotlight?.dispose()
  spotlight = null
  for (const element of mounted) element.remove()
  mounted.length = 0
})

/** A real, visible, fixed-position button — the thing being spotlit. */
function mountButton(name: string, left: number, top: number): HTMLButtonElement {
  const button = document.createElement('button')
  button.textContent = name
  const style = button.style
  style.position = 'fixed'
  style.left = `${left}px`
  style.top = `${top}px`
  style.width = '120px'
  style.height = '40px'
  document.body.appendChild(button)
  mounted.push(button)
  return button
}

function panels(): HTMLElement[] {
  // Array.from, not spread: the shared tsconfig lib is DOM without
  // DOM.Iterable, so NodeList is ArrayLike but not spreadable.
  return Array.from(document.querySelectorAll<HTMLElement>('[data-lens-spotlight="panel"]'))
}

function ring(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-lens-spotlight="ring"]')
}

function center(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

it('show() builds four panels and a ring that contains the target rect', () => {
  const button = mountButton('spotlit', 200, 200)
  spotlight = createDomSpotlight()
  spotlight.show(button)

  expect(panels()).toHaveLength(4)
  const outline = ring()
  expect(outline).not.toBeNull()

  const buttonRect = button.getBoundingClientRect()
  const ringRect = outline!.getBoundingClientRect()
  expect(ringRect.left).toBeLessThan(buttonRect.left)
  expect(ringRect.top).toBeLessThan(buttonRect.top)
  expect(ringRect.right).toBeGreaterThan(buttonRect.right)
  expect(ringRect.bottom).toBeGreaterThan(buttonRect.bottom)

  // The click-through guarantee, statically: nothing sits over the hole.
  const point = center(button)
  expect(document.elementFromPoint(point.x, point.y)).toBe(button)
})

it('a real click in the hole is a plain click on the button; outside clicks land on the dimmer', async () => {
  const button = mountButton('spotlit', 200, 200)
  let buttonClicks = 0
  button.addEventListener('click', () => {
    buttonClicks += 1
  })
  const pageTargets: EventTarget[] = []
  const recordTarget = (event: MouseEvent): void => {
    if (event.target !== null) pageTargets.push(event.target)
  }
  document.addEventListener('click', recordTarget)

  spotlight = createDomSpotlight()
  spotlight.show(button)

  try {
    // Through the hole: the button's own listener fires from an untouched click.
    await userEvent.click(button)
    expect(buttonClicks).toBe(1)
    expect(pageTargets.at(-1)).toBe(button)

    // Outside: the dimmer swallows it — the page sees a PANEL as the target,
    // never the button.
    const [topPanel] = panels()
    await userEvent.click(topPanel!)
    expect(buttonClicks).toBe(1)
    expect(pageTargets.at(-1)).toBe(topPanel)
    expect(pageTargets.at(-1)).not.toBe(button)
  } finally {
    document.removeEventListener('click', recordTarget)
  }
})

it('show() while visible retargets: same mask, ring moved to the new element', () => {
  const first = mountButton('first', 200, 200)
  const second = mountButton('second', 500, 80)
  spotlight = createDomSpotlight()
  spotlight.show(first)
  const before = ring()!.getBoundingClientRect()

  spotlight.show(second)
  expect(panels()).toHaveLength(4) // reused, not duplicated
  expect(document.querySelectorAll('[data-lens-spotlight="ring"]')).toHaveLength(1)

  const after = ring()!.getBoundingClientRect()
  expect(after.left).not.toBe(before.left)
  const rect = second.getBoundingClientRect()
  expect(after.left).toBeLessThan(rect.left)
  expect(after.top).toBeLessThan(rect.top)
  expect(after.right).toBeGreaterThan(rect.right)
  expect(after.bottom).toBeGreaterThan(rect.bottom)

  // The hole moved with the ring: the new target is the hit target now.
  const point = center(second)
  expect(document.elementFromPoint(point.x, point.y)).toBe(second)
})

it('hide() removes every panel and the ring', () => {
  const button = mountButton('spotlit', 200, 200)
  spotlight = createDomSpotlight()
  spotlight.show(button)
  spotlight.hide()
  expect(document.querySelectorAll('[data-lens-spotlight]')).toHaveLength(0)
})

it('dispose() is idempotent — before any show, after show, and repeated', () => {
  const untouched = createDomSpotlight()
  untouched.dispose()
  untouched.dispose() // never shown: nothing to tear down, nothing thrown

  const button = mountButton('spotlit', 200, 200)
  spotlight = createDomSpotlight()
  spotlight.show(button)
  spotlight.dispose()
  spotlight.dispose()
  expect(document.querySelectorAll('[data-lens-spotlight]')).toHaveLength(0)
})

it('a phantom target (display:none or removed) hides the mask instead of click-blocking; a real rect brings it back', () => {
  // The failure this pins: a target that unmounts or display:none's mid-show
  // reads back a 0×0-at-(0,0) rect, which used to collapse the hole to a
  // top-left notch while the four panels click-blocked the whole page. Now a
  // phantom rect hides the mask (display only — the spotlight stays shown and
  // keeps watching), and the next reposition with an honest rect restores it.
  // The window resize event drives reposition deterministically — no
  // ResizeObserver timing to await.
  const button = mountButton('spotlit', 200, 200)
  spotlight = createDomSpotlight()
  spotlight.show(button)
  for (const panel of panels()) expect(panel.style.display).not.toBe('none')

  // display:none: the rect collapses to zero-size — the mask hides.
  button.style.display = 'none'
  window.dispatchEvent(new Event('resize'))
  for (const panel of panels()) expect(panel.style.display).toBe('none')
  expect(ring()!.style.display).toBe('none')
  // Nothing click-blocks where the phantom notch used to sit.
  const cornerHit = document.elementFromPoint(5, 5)
  expect(cornerHit === null || (cornerHit as HTMLElement).dataset['lensSpotlight'] === undefined).toBe(true)

  // The target comes back: the same signals restore the mask in place.
  button.style.display = ''
  window.dispatchEvent(new Event('resize'))
  for (const panel of panels()) expect(panel.style.display).not.toBe('none')
  expect(ring()!.style.display).not.toBe('none')
  const point = center(button)
  expect(document.elementFromPoint(point.x, point.y)).toBe(button)

  // Removal is the other phantom: a disconnected target also hides the mask.
  button.remove()
  window.dispatchEvent(new Event('resize'))
  for (const panel of panels()) expect(panel.style.display).toBe('none')
  expect(ring()!.style.display).toBe('none')
})
