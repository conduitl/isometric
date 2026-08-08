/**
 * Rendering the bedrock scene: one matrix owns the whole world-to-screen story.
 *
 * The simulation lives in math-class coordinates — meters, y UP, origin at the
 * bottom-left of the world. The screen lives in pixel coordinates — y DOWN,
 * origin at the top-left. Those two disagreements (scale and direction) are
 * settled by ONE affine matrix, built once per frame, and EVERY point we draw
 * goes through Mat3.apply on its way out. The renderer backend only ever sees
 * finished screen-space commands — it knows nothing about meters or gravity.
 * That is the architecture the whole engine is built on, dogfooded here first.
 */

import { Mat3, Vec2 } from '@engine/math'
import type { RendererBackend, SurfaceSize } from '@engine/renderer'
import { GRAVITY, WORLD } from './sim'
import type { SimState } from './sim'

/** Empty margin (CSS pixels) between the world and the edges of the canvas. */
const PAD = 24

/** Arrow scales: meters of drawn arrow per unit of the quantity shown.
 * Velocity in m/s and gravity in m/s² are different kinds of thing, so each
 * gets its own scale — the arrows show DIRECTION truthfully and length only
 * proportionally within their own family. */
const VEL_ARROW_SCALE = 0.25
const GRAVITY_ARROW_SCALE = 0.08

/** How thick the platform is drawn (meters). Purely visual — collision only
 * knows about the top surface. */
const PLATFORM_THICKNESS = 0.3

const COLOR_BACKGROUND = '#0e1420'
const COLOR_GRID = '#1c2a3e'
const COLOR_GROUND = '#5b7ea8'
const COLOR_PLATFORM = '#4f7cc9'
const COLOR_BALL = '#ffd166'
const COLOR_VELOCITY = '#4ade80'
const COLOR_GRAVITY = '#fb923c'
const COLOR_HUD = '#e4eaf4'

/**
 * Draw one frame of the scene.
 *
 * `alpha` is the Clock's interpolation fraction in [0,1): how far we are
 * between the last completed physics tick and the next one. The ball is drawn
 * at lerp(prevPos, pos, alpha), so even though physics moves in fixed 1/60 s
 * jumps, the picture glides — the classic fixed-timestep rendering trick.
 *
 * The frame is fully self-contained (beginFrame → draw → endFrame), which is
 * what lets the determinism test point a recording backend at this exact
 * function and fingerprint the entire draw stream.
 */
export function renderScene(
  backend: RendererBackend,
  view: SurfaceSize,
  state: SimState,
  alpha: number,
  hud: { tick: number; paused: boolean; pendingStage: string | null; timeScale: number },
): void {
  // Fit the 16×10 m world into the view with padding: one scale factor for
  // both axes so meters stay square on screen.
  const s = Math.max(
    1e-6, // degenerate-view guard: a 0×0 canvas should draw nonsense, not crash
    Math.min((view.width - 2 * PAD) / WORLD.width, (view.height - 2 * PAD) / WORLD.ceiling),
  )

  // THE matrix. Read it inside-out, the way compose applies it:
  //   1. scaling(s, -s)  — meters → pixels, and there it is: find the −1 that
  //      flips the graph. World y grows UP, screen y grows DOWN, so the y
  //      scale is negative. This single sign is the only place in the entire
  //      app where the two conventions meet.
  //   2. translation(PAD, view.height − PAD) — after the flip, the world
  //      origin (0,0) would sit at the screen origin (top-left); this slides
  //      it to the bottom-left corner, PAD pixels in from each edge.
  // Every world point below goes through Mat3.apply with this matrix — no
  // point reaches the backend any other way.
  const worldToScreen = Mat3.compose(
    Mat3.translation(PAD, view.height - PAD),
    Mat3.scaling(s, -s),
  )
  const toScreen = (v: Vec2): Vec2 => Mat3.apply(worldToScreen, v)

  backend.beginFrame({
    width: view.width,
    height: view.height,
    dpr: view.dpr,
    background: COLOR_BACKGROUND,
  })

  // Faint grid, one line per meter — the world is literally graph paper.
  for (let x = 0; x <= WORLD.width; x++) {
    backend.drawPolyline({
      points: [toScreen(Vec2.make(x, 0)), toScreen(Vec2.make(x, WORLD.ceiling))],
      stroke: COLOR_GRID,
      lineWidth: 1,
    })
  }
  for (let y = 0; y <= WORLD.ceiling; y++) {
    backend.drawPolyline({
      points: [toScreen(Vec2.make(0, y)), toScreen(Vec2.make(WORLD.width, y))],
      stroke: COLOR_GRID,
      lineWidth: 1,
    })
  }

  // Ground: the x-axis of our graph, drawn heavier.
  backend.drawPolyline({
    points: [toScreen(Vec2.make(0, 0)), toScreen(Vec2.make(WORLD.width, 0))],
    stroke: COLOR_GROUND,
    lineWidth: 2,
  })

  // Platform. The rect command wants a top-left corner in SCREEN space;
  // because our matrix flips y, the world's TOP edge (center.y) lands at the
  // smaller screen y — so we transform the world top-left and bottom-right
  // corners and read the rect straight off them.
  {
    const p = state.platform
    const topLeft = toScreen(Vec2.make(p.center.x - p.halfWidth, p.center.y))
    const bottomRight = toScreen(Vec2.make(p.center.x + p.halfWidth, p.center.y - PLATFORM_THICKNESS))
    backend.drawRect({
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
      fill: COLOR_PLATFORM,
    })
  }

  // Ball, drawn between its last two physics positions. Positions go through
  // the matrix; the radius is a LENGTH, so it just scales by s — lengths are
  // unaffected by the flip (|−s| = s) and never by translation.
  const drawPos = Vec2.lerp(state.ball.prevPos, state.ball.pos, alpha)
  const ballScreen = toScreen(drawPos)
  backend.drawCircle({
    x: ballScreen.x,
    y: ballScreen.y,
    radius: state.ball.radius * s,
    fill: COLOR_BALL,
  })

  // The vector overlays: velocity (green) and gravity (orange), rooted at the
  // ball. Watch them while stepping substages — 'integrate' tilts the green
  // arrow toward the orange one, which is what "gravity accelerates the ball"
  // literally means.
  drawArrow(backend, worldToScreen, drawPos, Vec2.scale(state.ball.vel, VEL_ARROW_SCALE), COLOR_VELOCITY)
  drawArrow(backend, worldToScreen, drawPos, Vec2.scale(GRAVITY, GRAVITY_ARROW_SCALE), COLOR_GRAVITY)

  // HUD — plain screen-space text, top-left. toFixed keeps the strings (and
  // therefore the recorded frame hashes) deterministic.
  const lines = [
    `tick ${hud.tick}`,
    `alpha ${alpha.toFixed(2)}`,
    `pos (${state.ball.pos.x.toFixed(2)}, ${state.ball.pos.y.toFixed(2)}) m`,
    `vel (${state.ball.vel.x.toFixed(2)}, ${state.ball.vel.y.toFixed(2)}) m/s`,
    `time ${hud.timeScale}x`,
    hud.paused ? `paused${hud.pendingStage ? ` - next: ${hud.pendingStage}` : ''}` : 'running',
  ]
  let lineY = 12
  for (const text of lines) {
    backend.drawText({ x: 12, y: lineY, text, fill: COLOR_HUD, align: 'left', baseline: 'top' })
    lineY += 16
  }

  backend.endFrame()
}

/**
 * Draw an arrow in world space: a shaft from `fromWorld` along `delta`, plus a
 * two-stroke head at the tip.
 *
 * The head needs two short strokes angled off the shaft — and we build them
 * with NO trig at all. `dir` is the unit vector along the shaft and
 * `Vec2.perp(dir)` is dir rotated 90° counterclockwise; any direction "a bit
 * back and a bit to the side" is just a mix of the two:
 *
 *   headPoint = tip − dir·h ± perp(dir)·(h/2)
 *
 * Walking back h and sideways h/2 gives an arrowhead opening of
 * atan(1/2) ≈ 26.6° per side — chosen by picking lengths, not by measuring
 * angles. Rotations really are just recombinations of a vector and its
 * perpendicular; that idea comes back with force in the isometric projection.
 */
function drawArrow(
  backend: RendererBackend,
  worldToScreen: Mat3,
  fromWorld: Vec2,
  delta: Vec2,
  color: string,
): void {
  const len = Vec2.length(delta)
  if (len < 1e-6) return // no direction to point in — draw nothing

  const tip = Vec2.add(fromWorld, delta)
  const dir = Vec2.normalize(delta)
  const side = Vec2.perp(dir)
  const h = Math.min(0.35, 0.4 * len) // head shrinks with short arrows, caps at 0.35 m
  const back = Vec2.sub(tip, Vec2.scale(dir, h))
  const left = Vec2.add(back, Vec2.scale(side, h * 0.5))
  const right = Vec2.sub(back, Vec2.scale(side, h * 0.5))

  backend.drawPolyline({
    points: [Mat3.apply(worldToScreen, fromWorld), Mat3.apply(worldToScreen, tip)],
    stroke: color,
    lineWidth: 2,
  })
  backend.drawPolyline({
    points: [
      Mat3.apply(worldToScreen, left),
      Mat3.apply(worldToScreen, tip),
      Mat3.apply(worldToScreen, right),
    ],
    stroke: color,
    lineWidth: 2,
  })
}
