#!/usr/bin/env node
/**
 * tilemap-budget.mjs — the CPU-throttled frame-budget harness.
 *
 * This is the roadmap's Phase 1 exit measurement ("60 fps at 256×256 fully
 * zoomed out on the 4×-throttled reference profile", docs/ROADMAP.md) and
 * the standing trip-wire of docs/ARCHITECTURE.md §11 gate 4: when this gate
 * fails, renderer-backend work (the pre-priced Pixi backend) is pulled
 * forward automatically — no meeting required, the number decides.
 *
 * What it does, start to finish:
 *
 *   1. Spawns the three-windows Vite dev server on a fixed port and waits
 *      for /perf.html to answer 200.
 *   2. Launches Playwright's pinned headless Chromium and, over a raw CDP
 *      session, sets Emulation.setCPUThrottlingRate to 4× — the "school
 *      Chromebook" stand-in. Throttling is set BEFORE navigation so every
 *      measured frame runs slowed down.
 *   3. Loads the perf page. The page renders the killer scene (a full
 *      256×256 layer, fully zoomed out, plus 200 entity markers), measures
 *      its own rAF-timestamp deltas — the only sanctioned in-page clock —
 *      and publishes { mean, p95, samples, cached, uncachedMean } on
 *      globalThis.__perfResult. This script just polls for that object.
 *   4. Prints the report and applies the budget: cached mean ≤ 16.7 ms AND
 *      cached p95 ≤ 25 ms → exit 0; anything else → exit 1. The uncachedMean
 *      (the same scene forced down the per-tile fallback) is printed beside
 *      it as the honesty number: the gap between the two is the measured
 *      reason the cache exists.
 *
 * Housekeeping contract: re-runnable, and never leaves a Vite orphan. The
 * server is spawned DETACHED so it leads its own process group, and every
 * exit path — success, failure, Ctrl-C — kills that whole group (pnpm AND
 * the vite it spawned), escalating SIGTERM → SIGKILL if needed.
 *
 * Node built-ins + the root 'playwright' package only.
 */

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const PORT = 5219
const PAGE_URL = `http://localhost:${PORT}/perf.html`
const SERVER_TIMEOUT_MS = 30_000
const RESULT_TIMEOUT_MS = 90_000
const CPU_THROTTLE_RATE = 4

// The budget: a 60 Hz frame is 16.7 ms, so the mean must fit inside one; the
// p95 gets a little slack (a single missed vsync every twenty frames) but a
// stuttering renderer cannot hide behind a good average.
const BUDGET_MEAN_MS = 16.7
const BUDGET_P95_MS = 25

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// ---- The dev server, in its own process group. ---------------------------

// detached:true is the whole orphan-prevention story: pnpm becomes a process
// GROUP leader, vite lands in that group, and killing -pid takes out both.
// Killing only pnpm would leave vite squatting on the port for the next run.
const server = spawn(
  'pnpm',
  ['--filter', 'three-windows', 'exec', 'vite', '--port', String(PORT), '--strictPort'],
  { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
)

let serverLog = ''
server.stdout.on('data', (chunk) => {
  serverLog += String(chunk)
})
server.stderr.on('data', (chunk) => {
  serverLog += String(chunk)
})

function killServerGroup(signal) {
  if (server.pid === undefined) return
  try {
    process.kill(-server.pid, signal)
  } catch {
    // Already gone — which is exactly what we wanted.
  }
}

async function shutdownServer() {
  if (server.exitCode !== null || server.signalCode !== null) return
  killServerGroup('SIGTERM')
  const exited = await Promise.race([
    once(server, 'exit').then(() => true),
    sleep(2000).then(() => false),
  ])
  if (!exited) killServerGroup('SIGKILL')
}

// Belt and braces: whatever path the process takes out of here (including an
// uncaught throw), the exit handler fires synchronously and the group dies.
process.on('exit', () => {
  if (server.exitCode === null && server.signalCode === null) killServerGroup('SIGKILL')
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    killServerGroup('SIGKILL')
    process.exit(1)
  })
}

async function waitForServer() {
  const deadline = Date.now() + SERVER_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`vite exited before serving anything (code ${server.exitCode}):\n${serverLog}`)
    }
    try {
      const res = await fetch(PAGE_URL)
      if (res.status === 200) {
        await res.arrayBuffer() // drain the body; we only wanted the status
        return
      }
    } catch {
      // Not listening yet — keep polling.
    }
    await sleep(250)
  }
  throw new Error(`dev server gave no 200 for ${PAGE_URL} within ${SERVER_TIMEOUT_MS / 1000}s:\n${serverLog}`)
}

// ---- The measurement: throttled Chromium reads the page's own verdict. ----

async function measure() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()

    // A page that crashes renders no frames and publishes no result; surface
    // its errors instead of timing out in silence 90 seconds later.
    const pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    // The 4× slowdown, over raw CDP — set before goto so the throttle covers
    // every frame the page ever renders, warmup included.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE })

    await page.goto(PAGE_URL, { waitUntil: 'load' })

    const deadline = Date.now() + RESULT_TIMEOUT_MS
    while (Date.now() < deadline) {
      const result = await page.evaluate(() => globalThis.__perfResult ?? null)
      if (result !== null) return result
      if (pageErrors.length > 0) {
        throw new Error(`perf page threw before publishing a result:\n${pageErrors.join('\n')}`)
      }
      await sleep(500)
    }
    throw new Error(
      `perf page published no __perfResult within ${RESULT_TIMEOUT_MS / 1000}s` +
        (pageErrors.length > 0 ? `\npage errors:\n${pageErrors.join('\n')}` : ''),
    )
  } finally {
    await browser.close()
  }
}

// ---- The report and the verdict. ------------------------------------------

function report(result) {
  const ms = (value) => `${value.toFixed(2)} ms`
  const meanOk = result.mean <= BUDGET_MEAN_MS
  const p95Ok = result.p95 <= BUDGET_P95_MS
  const pass = meanOk && p95Ok

  console.log('')
  console.log('tilemap frame budget — 256×256 top-down, fully zoomed out, 200 markers')
  console.log(`measured on Playwright's pinned headless Chromium at ${CPU_THROTTLE_RATE}× CPU throttle`)
  console.log('(the "school Chromebook" reference profile — docs/ARCHITECTURE.md §11 gate 4)')
  console.log('')
  console.log(`  cached blit path:    mean ${ms(result.mean)}   p95 ${ms(result.p95)}   (${result.samples} samples)`)
  console.log(`  per-tile fallback:   mean ${ms(result.uncachedMean)}   (~${(result.uncachedMean / Math.max(result.mean, 0.001)).toFixed(1)}× the cached mean — the cache is why the budget is even possible)`)
  console.log('')
  console.log(`  budget: mean <= ${BUDGET_MEAN_MS} ms  →  ${meanOk ? 'ok' : 'OVER'}`)
  console.log(`          p95  <= ${BUDGET_P95_MS} ms    →  ${p95Ok ? 'ok' : 'OVER'}`)
  console.log('')
  console.log(pass ? '  PASS — the cached path holds 60 fps on the reference profile.' : '  FAIL — frame budget exceeded: this is the trigger that pulls renderer-backend work forward (docs/RISKS.md).')
  console.log('')
  return pass
}

// ---- Main. -----------------------------------------------------------------

let exitCode = 1
try {
  await waitForServer()
  const result = await measure()
  exitCode = report(result) ? 0 : 1
} catch (error) {
  console.error(`tilemap-budget: ${error instanceof Error ? error.message : String(error)}`)
  exitCode = 1
} finally {
  await shutdownServer()
}
process.exit(exitCode)
