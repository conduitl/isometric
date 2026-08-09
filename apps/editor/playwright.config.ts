/**
 * Playwright config for the Phase 2 exit gates that live in ./e2e — the
 * keyboard-only build-save-reload flow and the axe-core accessibility scan
 * (docs/ROADMAP.md, Phase 2 exit criteria).
 *
 * Two deliberate strictures:
 *
 * - **One browser project: the pinned Chromium.** Determinism claims are
 *   scoped to "same build + same pinned browser" (docs/DECISIONS.md R10 —
 *   browser upgrades are conscious, re-blessed PRs, never drive-bys). The
 *   e2e gates run on exactly the browser that policy pins; adding
 *   firefox/webkit rows here would quietly widen a claim the project never
 *   made.
 * - **retries: 0.** A flaky gate is a broken gate: a retry that greens a
 *   red run would hide exactly the nondeterminism these gates exist to
 *   catch. If a spec here ever flakes, the spec (or the editor) is wrong —
 *   fix it, don't re-roll it.
 */

import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

/** This app's directory — the webServer must run vite HERE, not at whatever
 * cwd `pnpm e2e` was invoked from. */
const appDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  testDir: './e2e',
  retries: 0,
  reporter: 'list',
  // The flow test is one long journey with three full page loads against a
  // cold vite transform cache. 60 s is headroom for a slow first compile on
  // a loaded machine — NOT a flake blanket (retries stay 0, above).
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5199',
  },
  projects: [
    // The pinned browser, and only the pinned browser — see the header.
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    // Port 5199 is this gate's exclusive port; --strictPort makes a squatter
    // a loud failure instead of a silent test against the wrong server.
    command: 'pnpm exec vite --port 5199 --strictPort',
    port: 5199,
    reuseExistingServer: !process.env.CI,
    cwd: appDir,
  },
})
