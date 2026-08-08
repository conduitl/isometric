/**
 * Visual regression on a deterministic scene — the renderer-parity contract in miniature.
 *
 * Because the simulation is seeded and the clock is fixed-timestep, tick 240 is the SAME
 * world every run; the blessed screenshot is therefore a real contract, not a flaky hope.
 * When a second renderer backend lands (docs/ROADMAP.md Phase 6), it must pass this same
 * suite — backend parity as an executable contract.
 *
 * Baselines are per-browser and per-platform (vitest names them so); the pinned browser is
 * Playwright's bundled Chromium, and upgrading it is a deliberate re-bless PR.
 */
import { createClock } from '@engine/core'
import { createCanvas2dBackend } from '@engine/renderer-canvas2d'
import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { renderScene } from '../src/render'
import { createSim } from '../src/sim'

it('reference scene at tick 240 matches the blessed screenshot', async () => {
  const canvas = document.createElement('canvas')
  canvas.style.width = '800px'
  canvas.style.height = '450px'
  canvas.style.display = 'block'
  document.body.style.margin = '0'
  document.body.appendChild(canvas)

  const { state, stages } = createSim(12345)
  const clock = createClock()
  for (let i = 0; i < 300; i++) {
    if (clock.tick >= 240) break
    clock.advance(clock.fixedDt, stages)
  }

  const backend = createCanvas2dBackend(canvas)
  renderScene(backend, { width: 800, height: 450, dpr: 1 }, state, 0, {
    tick: clock.tick,
    paused: false,
    pendingStage: null,
    timeScale: 1,
  })

  await expect(page.elementLocator(canvas)).toMatchScreenshot('bedrock-scene-tick240')
})
