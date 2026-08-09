/**
 * main.tsx — where the framework-free editor meets React, exactly once.
 *
 * The order below IS the architecture (ARCHITECTURE §6): build the session
 * (it boots its own document — storage's rescue ladder, else the starter
 * world), install the built-in tools through the same plugin door a third
 * party would use, wire the lesson harness to the session's event stream,
 * and only THEN hand the finished machine to React. React mounts it once and
 * from then on the conversation is one-way each direction: named commands
 * in, throttled store subscriptions out.
 *
 * Module scope runs once even under StrictMode — React double-invokes
 * component renders and effects, never this file — so the session, tools,
 * and harness are singletons by construction. The components they are handed
 * to must (and do) survive the double mount: every effect pairs its attach
 * with a detach.
 *
 * ## The ?fixture=perf256 hook
 *
 * A manual dev convenience, nothing more: open the editor with
 * ?fixture=perf256 and the 256×256 drag-paint arena replaces the starter
 * world — through the same loadWorld door any load uses — so paint feel can
 * be poked at interactively in the full React shell. The perf GATE does not
 * come through here: scripts/perf/editor-paint-budget.mjs measures
 * perf.html + src/perf.ts, which assembles its own React-free session over
 * the same arena. Reading location.search is not a determinism leak — it is
 * configuration fed in from outside, like the rAF timestamps the clock is
 * handed.
 *
 * ## Lesson hot reload (the authoring-harness deliverable)
 *
 * Vite's import.meta.hot.accept('@content/lessons', …) makes THIS module the
 * HMR boundary for lesson content: edit a lesson file and the fresh module
 * arrives in the callback, harness.reload() re-derives the current step
 * against the live document, and the rail follows — no engine build, no
 * page reload, no lost world. The accept specifier must match this file's
 * import specifier exactly (vite resolves both through the same alias).
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { lessons } from '@content/lessons'
import { createLessonHarness } from './editor/lesson/harness'
import { createEditorSession } from './editor/session'
import { createPerfWorld } from './editor/starter'
import { builtinToolPlugins } from './editor/tools/index'
import { App } from './ui/App'
import './ui/styles.css'

// The session boots its own document (storage, else the starter world) —
// nobody here calls loadWorld to get started.
const session = createEditorSession()

// Built-in tools go through the public plugin door (select / brush / placer),
// so the door stays honest: a third-party tool could do exactly this.
for (const plugin of builtinToolPlugins) {
  session.use(plugin)
}

// Perf fixture, for HANDS: the 256×256 drag-paint arena, interactively (see
// the header — the perf gate itself measures perf.html, not this page).
if (new URLSearchParams(location.search).get('fixture') === 'perf256') {
  session.loadWorld(createPerfWorld(), 'new')
}

// The lesson harness watches builder.* events and the live document, and
// mirrors "which step are we on" into the store's lesson slot. Arrow
// wrappers, not method references — the host contract wants functions, and
// wrappers stay correct regardless of how the session binds its methods.
const harness = createLessonHarness(
  {
    on: (listener) => session.onEvent(listener),
    doc: () => session.doc,
    publish: (state) => session.store.setState({ lesson: state }),
  },
  lessons,
)

if (import.meta.hot) {
  // Accept lesson-content updates HERE (see header). The callback gets the
  // fresh module namespace; a syntax-error edit arrives as undefined and is
  // ignored — the rail keeps the last good lesson until the file parses.
  import.meta.hot.accept('@content/lessons', (mod) => {
    if (mod !== undefined) {
      harness.reload((mod as unknown as typeof import('@content/lessons')).lessons)
    }
  })
}

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('index.html must carry <div id="root"> — the editor has nowhere to mount')
}

createRoot(rootElement).render(
  <StrictMode>
    <App session={session} />
  </StrictMode>,
)
