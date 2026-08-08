/**
 * Pins the PolylineCmd fill contract (review finding): `fill` always paints
 * the interior of the implicitly-closed polygon — the SVG rule — whether or
 * not `closed` adds the return segment to the stroke. A second renderer
 * backend is exactly the place this semantic would silently diverge, so it
 * lives in the executable parity suite, not just in doc comments.
 */
import { createCanvas2dBackend } from '@engine/renderer-canvas2d'
import { expect, it } from 'vitest'
import { page } from 'vitest/browser'

it('fill treats an OPEN polyline as an implicitly closed polygon', async () => {
  const canvas = document.createElement('canvas')
  canvas.style.width = '200px'
  canvas.style.height = '150px'
  canvas.style.display = 'block'
  document.body.style.margin = '0'
  document.body.appendChild(canvas)

  const backend = createCanvas2dBackend(canvas)
  backend.beginFrame({ width: 200, height: 150, dpr: 1, background: '#ffffff' })
  // Two segments of a triangle, deliberately NOT closed — the blue interior
  // in the blessed screenshot is the contract.
  backend.drawPolyline({
    points: [
      { x: 20, y: 130 },
      { x: 100, y: 20 },
      { x: 180, y: 130 },
    ],
    fill: '#3b6fe0',
    stroke: '#182435',
    lineWidth: 3,
  })
  backend.endFrame()

  await expect(page.elementLocator(canvas)).toMatchScreenshot('fill-implicitly-closes')
})
