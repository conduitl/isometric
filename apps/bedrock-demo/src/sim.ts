/**
 * The bedrock simulation: one bouncing ball, one swaying platform, zero surprises.
 *
 * This file is the Phase 0 proof that our engine's promise holds: same seed +
 * same inputs → the exact same world, tick after tick, run after run
 * (docs/ROADMAP.md). Everything here is deterministic on purpose — time arrives
 * as an explicit `dt`, randomness comes from a seeded generator used exactly
 * once, and trig goes through the Scalar wrappers so there is a single place to
 * swap in a bit-identical approximation if we ever need one.
 *
 * The world is PROFILE VIEW, like a graph in math class: x runs right, y runs
 * UP, units are meters, and the ground is the line y = 0. The flip to
 * screen-space (where y grows downward) happens in exactly one matrix in
 * render.ts — the simulation never thinks about pixels.
 *
 * The tick is split into three named stages that always run in the same order:
 *   'platform'  → the platform sways (it is driven by time, nothing pushes it)
 *   'integrate' → gravity changes velocity, velocity changes position
 *   'collide'   → we fix up anything that ended the step inside a wall
 * Named stages are why the demo's "step substage" button can freeze the world
 * BETWEEN physics phases and let you watch causality one arrow at a time.
 */

import { Vec2, Scalar, createRng } from '@engine/math'
import type { Stage } from '@engine/core'

/**
 * The full state of the world — plain data, nothing hidden. Hash this object
 * and you have fingerprinted the entire simulation; that is exactly what the
 * determinism test does.
 *
 * `prevPos` looks redundant but earns its place at render time: the renderer
 * draws the ball at lerp(prevPos, pos, alpha), sliding it smoothly between the
 * last two physics positions even when the display refreshes faster than the
 * simulation ticks.
 */
export interface SimState {
  readonly seed: number
  ball: { pos: Vec2; vel: Vec2; prevPos: Vec2; radius: number }
  platform: { center: Vec2; halfWidth: number; phase: number }
}

/**
 * Gravity as a vector: 9.8 m/s² of acceleration, pointing straight down.
 * The minus sign is the whole story — our world is y-up, so "down" is
 * negative y. Every second, this vector is added to the ball's velocity;
 * that is all gravity IS in this simulation.
 */
export const GRAVITY: Vec2 = Vec2.make(0, -9.8)

/**
 * The stage we play on: 16 meters wide, 10 meters tall, ground at y = 0.
 * The renderer uses these numbers to fit the whole world on screen; the
 * collide stage uses `width` for the side walls.
 */
export const WORLD: { readonly width: number; readonly ceiling: number } = {
  width: 16,
  ceiling: 10,
}

/** How bouncy the world is: each bounce keeps 85% of the impact speed.
 * 1 would bounce forever; 0 would land like wet clay. */
const RESTITUTION = 0.85

/** Where the platform's top surface lives, and how far it sways. */
const PLATFORM_BASE_X = 10
const PLATFORM_Y = 2.5
const PLATFORM_HALF_WIDTH = 1.6
const SWAY_AMPLITUDE = 2.5

/** Where the ball starts. Only its VELOCITY is randomized (from the seed). */
const BALL_START = Vec2.make(4, 6)
const BALL_RADIUS = 0.4

/**
 * Build a fresh world plus the three stages that advance it.
 *
 * The seed is the only source of variety: it feeds a mulberry32 generator that
 * picks the ball's launch velocity, and then the generator is never touched
 * again. Same seed → same launch → same world forever. That single number is
 * what makes replays, fair comparisons, and the run-twice CI test possible.
 *
 * The returned stages close over the returned state: hand them to a Clock and
 * every fixed tick will run platform → integrate → collide, each mutating
 * `state` by swapping in freshly-built plain objects (the vectors themselves
 * are immutable — we replace them, never edit them).
 */
export function createSim(seed = 12345): { state: SimState; stages: readonly Stage[] } {
  const rng = createRng(seed)

  const state: SimState = {
    seed,
    ball: {
      pos: BALL_START,
      vel: Vec2.make(rng.range(1.5, 5.5), rng.range(-1, 3)),
      prevPos: BALL_START,
      radius: BALL_RADIUS,
    },
    platform: {
      center: Vec2.make(PLATFORM_BASE_X, PLATFORM_Y),
      halfWidth: PLATFORM_HALF_WIDTH,
      phase: 0,
    },
  }

  const stages: readonly Stage[] = [
    {
      name: 'platform',
      /**
       * The platform is kinematic: nothing in the world pushes it, it simply
       * follows a sine wave through time. `phase` is its private clock in
       * radians; advancing it by dt and taking sin(phase) traces the smooth
       * back-and-forth of a point going around a circle, viewed edge-on —
       * that is all a sine wave is. Scalar.sin (never Math.sin) keeps the
       * deterministic-approximation escape hatch open (docs/DECISIONS.md D6).
       */
      run: (dt) => {
        const phase = state.platform.phase + dt
        state.platform = {
          ...state.platform,
          phase,
          center: Vec2.make(PLATFORM_BASE_X + SWAY_AMPLITUDE * Scalar.sin(phase), PLATFORM_Y),
        }
      },
    },
    {
      name: 'integrate',
      /**
       * Semi-implicit (symplectic) Euler — the order of these two lines is
       * the entire trick:
       *
       *   vel += GRAVITY · dt      (update velocity FIRST)
       *   pos += vel · dt          (then move using the NEW velocity)
       *
       * Plain Euler moves with the OLD velocity, which systematically lags
       * behind the true curve and injects a little energy every step — a
       * plain-Euler ball bounces slightly HIGHER each time, a perpetual
       * motion bug. Updating velocity first makes the errors alternate sign
       * instead of piling up, so the total energy stays bounded. Same cost,
       * one line swapped, dramatically more stable — which is why nearly
       * every game engine integrates in this order.
       *
       * We stash prevPos before moving: the renderer interpolates between
       * the last two positions to draw smoothly between fixed ticks.
       */
      run: (dt) => {
        const b = state.ball
        const vel = Vec2.add(b.vel, Vec2.scale(GRAVITY, dt))
        const pos = Vec2.add(b.pos, Vec2.scale(vel, dt))
        state.ball = { ...b, prevPos: b.pos, vel, pos }
      },
    },
    {
      name: 'collide',
      /**
       * Fix-up pass: integrate moves the ball blindly, then this stage
       * resolves anything it clipped. A bounce is two operations — push the
       * ball back to the surface, then reflect the velocity component that
       * points INTO the surface, scaled by restitution (0.85 → each bounce
       * keeps 85% of the impact speed, so bounces decay realistically).
       * The `vel < 0` / `vel > 0` guards mean we only bounce when actually
       * moving toward the surface: without them, a ball resting on the
       * ground would flip its tiny velocity sign every tick and buzz.
       *
       * The platform check is stricter: we bounce only if THIS step carried
       * the ball's bottom down through the platform's top surface (it was
       * above before, it is below now, and it is falling). A ball drifting
       * past the side or rising from below sails through — the platform is
       * a one-way floor, which is exactly how game platforms usually work.
       * We compare the ball's CENTER x against the pad's half-width — the
       * rounded-corner cases are deliberately ignored; proper corner
       * contact is a later lesson, not a Phase 0 requirement.
       */
      run: () => {
        const b = state.ball
        let px = b.pos.x
        let py = b.pos.y
        let vx = b.vel.x
        let vy = b.vel.y

        // Ground: the floor at y = 0. The ball's lowest point is center - radius.
        if (py - b.radius < 0 && vy < 0) {
          py = b.radius
          vy = -vy * RESTITUTION
        }

        // Side walls at x = 0 and x = WORLD.width.
        if (px - b.radius < 0 && vx < 0) {
          px = b.radius
          vx = -vx * RESTITUTION
        } else if (px + b.radius > WORLD.width && vx > 0) {
          px = WORLD.width - b.radius
          vx = -vx * RESTITUTION
        }

        // Platform top: one-way floor, only while falling onto it.
        const top = state.platform.center.y
        const bottomNow = py - b.radius
        const bottomBefore = b.prevPos.y - b.radius
        const overPad = Math.abs(px - state.platform.center.x) <= state.platform.halfWidth
        if (vy < 0 && overPad && bottomNow <= top && bottomBefore >= top) {
          py = top + b.radius
          vy = -vy * RESTITUTION
        }

        state.ball = { ...b, pos: Vec2.make(px, py), vel: Vec2.make(vx, vy) }
      },
    },
  ]

  return { state, stages }
}
