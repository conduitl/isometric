/**
 * main.tsx — where the framework-free editor meets React, exactly once.
 *
 * The order below IS the architecture (ARCHITECTURE §6): build the session
 * (it boots its own document — storage's rescue ladder, else the starter
 * world), install the built-in tools through the same plugin door a third
 * party would use, wire the tutorial engine to the session through the
 * host seam, and only THEN hand the finished machine to React. React mounts
 * it once and from then on the conversation is one-way each direction:
 * named commands in, throttled store subscriptions out.
 *
 * Module scope runs once even under StrictMode — React double-invokes
 * component renders and effects, never this file — so the session, tools,
 * host, and engine are singletons by construction. The components they are
 * handed to must (and do) survive the double mount: every effect pairs its
 * attach with a detach. Nothing is exposed globally — the only doors into
 * the machine are the props React was handed.
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
 * ## The tutorial engine (Phase 3 — the real machine, not the Phase 2 draft)
 *
 * createEditorTutorialHost wraps the session in the TutorialHost seam
 * (events, document reads, effect application, fixture loads, progress
 * storage, UI publication); createTutorialEngine runs lessons over it. The
 * start is RESUME-AWARE at the lesson level: if stored progress names a
 * lesson that still ships, that lesson starts (and the engine's own resume
 * then lands on the stored step); otherwise the catalogue's first lesson
 * greets a fresh student. Resume surviving reload is a Phase 3 exit
 * criterion — this is its front door.
 *
 * ## Lesson hot reload (the authoring loop)
 *
 * Vite's import.meta.hot.accept('@content/lessons', …) makes THIS module
 * the HMR boundary for lesson content: edit a lesson file and the fresh
 * module arrives in the callback, tutorial.reload() re-derives the current
 * step against the live document, and the rail follows — no engine build,
 * no page reload, no lost world. The accept specifier must match this
 * file's import specifier exactly (vite resolves both through the same
 * alias).
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { lessons } from '@content/lessons'
import { createTutorialEngine } from '@engine/tutorial'
import { createEditorSession } from './editor/session'
import { createPerfWorld } from './editor/starter'
import { builtinToolPlugins } from './editor/tools/index'
import { createEditorTutorialHost } from './editor/tutorial-host'
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

// The tutorial engine over the host seam (see the header). Which lesson
// starts is resume-aware: stored progress naming a SHIPPED lesson wins;
// anything else — no progress, or progress for a lesson that no longer
// ships — falls back to the catalogue's first.
const host = createEditorTutorialHost(session)

// Before ANY lesson starts: if a parked world is waiting (the tab closed —
// or reloaded — while a fixture lesson had the stage), the student meets
// their OWN world first. If their stored progress then names a mid-fixture
// lesson, the resume-aware start below re-parks this world and re-loads the
// fixture — a clean cycle, not a waste: the park always holds the student's
// latest own-world bytes, never fixture scenery, and a student who was NOT
// mid-fixture-lesson simply gets their world back.
host.restoreParkedIfAny()

const tutorial = createTutorialEngine(host, lessons)
const storedProgress = host.progress.read()
const storedLesson =
  storedProgress !== null
    ? lessons.find((lesson) => lesson.id === storedProgress.lessonId)
    : undefined
// Resume the stored lesson — unless it is FINISHED, in which case boot into
// the NEXT lesson of the catalogue instead. Restarting a done lesson was
// harmless while lessons ran on the student's own world, but a done FIXTURE
// lesson re-staged at every boot would park the student's world and refuse
// saves forever after — the curriculum marching forward is both the fix and
// the better welcome. A finished FINAL lesson starts nothing at all: the
// student boots into the library on their OWN world, which is the only
// ending that never re-parks it (the same hazard, one lesson later).
//
// "Finished" is read the way the machine WRITES it — stepId omitted AND the
// index past the end (machine.ts's commit) — never from the index alone: a
// catalogue edit that shortens a lesson can leave a mid-lesson index at the
// new length, and that student must resume by stepId, not march onward with
// their place erased.
const finished =
  storedLesson !== undefined &&
  storedProgress !== null &&
  storedProgress.stepId === undefined &&
  storedProgress.stepIndex >= storedLesson.steps.length
const resumeLesson = finished
  ? lessons[lessons.indexOf(storedLesson) + 1]?.id
  : (storedLesson?.id ?? lessons[0]?.id)
if (resumeLesson !== undefined) {
  tutorial.start(resumeLesson)
}

if (import.meta.hot) {
  // Accept lesson-content updates HERE (see header). The callback gets the
  // fresh module namespace; a syntax-error edit arrives as undefined and is
  // ignored — the rail keeps the last good lesson until the file parses.
  import.meta.hot.accept('@content/lessons', (mod) => {
    if (mod !== undefined) {
      tutorial.reload((mod as unknown as typeof import('@content/lessons')).lessons)
    }
  })
}

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('index.html must carry <div id="root"> — the editor has nowhere to mount')
}

createRoot(rootElement).render(
  <StrictMode>
    <App session={session} engine={tutorial} host={host} />
  </StrictMode>,
)
