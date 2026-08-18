/**
 * The App frame — the lesson-first split (the 2026-08 reframe: the lesson
 * is the product, the editor its companion), and the whole-app concerns
 * that belong to no single pane:
 *
 * 1. **The layout.** Two panes with a draggable, keyboard-operable divider:
 *    the lesson DOCUMENT on the left, the whole editor (a full-bleed canvas
 *    with floating chrome — EditorPane) on the right. The split ratio and
 *    the parked state are UI preferences, persisted under
 *    'editor:lesson-split' and restored on boot; the arithmetic lives in
 *    split-math.ts, pure and unit-tested. (This replaced ARCHITECTURE §6's
 *    v1 fixed grid; docking libraries stay deferred — the divider is ~80
 *    hand-rolled lines.)
 *
 * 2. **The global keyboard.** Undo, redo, and save are editor-wide verbs, so
 *    they listen on `window`, not on any panel: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z
 *    (and Ctrl/Cmd+Y), Ctrl/Cmd+S. Save calls preventDefault FIRST — the
 *    browser's own save dialog must never appear over a kid's world. Plain
 *    L parks/restores the lesson pane (the free-building toggle) — skipped,
 *    like the chords, while a text field or the lesson picker owns focus.
 *    The handlers announce nothing themselves: every completed action's
 *    label flows through the session's `lastAction` into the status bar's
 *    live region, so there is exactly one voice.
 *
 * 3. **Chrome reveal.** The editor's palettes and inspector float in
 *    collapsible cards; the lesson's "show me" must be able to spotlight
 *    anchors inside them. ANCHOR_CHROME_OWNER maps each card-dwelling
 *    anchor to its card, and revealAnchorChrome opens the right one before
 *    the spotlight looks — the anchor promise ("every registered anchor
 *    exists in the mounted UI") plus one frame of patience makes the
 *    promise VISIBLE too.
 *
 * 4. **useSnapshot — React's one window into the editor.** A thin wrapper
 *    over zustand v5's `useStore(store, selector)` against the session's
 *    vanilla store. Panels select single FIELDS (stable references between
 *    snapshot writes), never derived objects — a selector that built a fresh
 *    object per call would defeat Object.is and re-render forever. The store
 *    is throttled by construction (only real changes write it), so React
 *    re-renders at edit rate, never pointer rate; anything pointer-rate
 *    rides the FastChannel straight past React (see StatusBar).
 *
 * The frame renders panes and hands each the session; panels call named
 * session methods and render snapshot fields. React never touches the
 * document — that is the whole boundary, and this file is its front door.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { TutorialEngine } from '@engine/tutorial'
import { useStore } from 'zustand'
import type { AnchorId } from '../editor/anchors'
import type { EditorTutorialHost } from '../editor/tutorial-host'
import type { EditorSession, EditorSnapshot } from '../editor/types'
import { EditorPane } from './EditorPane'
import { LessonPane } from './LessonPane'
import { parkSplit, readSplitPref, unparkSplit, writeSplitPref } from './split-math'
import type { PrefStorage, SplitState } from './split-math'
import { SplitDivider } from './SplitDivider'

/**
 * Select one slice of the editor snapshot. Every panel reads the store
 * through this hook and nothing else — grep `useSnapshot` and you have found
 * every place React learns anything about the editor.
 */
export function useSnapshot<T>(session: EditorSession, selector: (snapshot: EditorSnapshot) => T): T {
  return useStore(session.store, selector)
}

/** Is this keydown aimed at a text field (or the lesson picker)? Native
 * editing must win there — a rename box owns its own undo, and a select's
 * type-ahead ('l' hunts for a lesson title) must never park the pane. */
function targetIsEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

/** Which overlay card owns each card-dwelling anchor — the reveal map
 * "show me" consults before spotlighting. Anchors absent here live in
 * always-visible chrome (the pill, the status bar, the canvas, the lesson
 * pane itself) and need no reveal. */
const ANCHOR_CHROME_OWNER: Partial<Record<AnchorId, 'world' | 'inspector'>> = {
  'palette.tiles': 'world',
  'palette.entities': 'world',
  'panel.layers': 'world',
  'panel.entities': 'world',
  'panel.inspector': 'inspector',
}

/** localStorage, if this browser grants it — UI prefs degrade to defaults
 * in private modes rather than crashing the shell. */
function prefStorage(): PrefStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/** The app shell: lesson document | divider | editor surface, with the
 * global keyboard attached for its lifetime. The tutorial engine and its
 * editor host ride down alongside the session for the one pane that drives
 * them — panes talk to both the same way they talk to the session: named
 * methods in, snapshot slices out. */
export function App({
  session,
  engine,
  host,
}: {
  session: EditorSession
  engine: TutorialEngine
  host: EditorTutorialHost
}): ReactElement {
  const frameRef = useRef<HTMLDivElement>(null)

  const [split, setSplit] = useState<SplitState>(() => readSplitPref(prefStorage()))
  const [worldOpen, setWorldOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(false)

  // Write-through persistence: the pref is tiny and every change is a
  // deliberate gesture, so each one lands in storage as it happens.
  useEffect(() => {
    writeSplitPref(prefStorage(), split)
  }, [split])

  const revealAnchorChrome = useCallback((id: AnchorId): void => {
    const owner = ANCHOR_CHROME_OWNER[id]
    if (owner === 'world') setWorldOpen(true)
    else if (owner === 'inspector') setInspectorOpen(true)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Plain L: park / restore the lesson pane. Before the chord check —
      // it carries no modifier — but never against a focused field.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'l' || e.key === 'L')) {
        if (targetIsEditable(e.target)) return
        setSplit((state) => (state.parked ? unparkSplit(state) : parkSplit(state)))
        return
      }

      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()

      if (key === 's') {
        // Before anything else: the browser's save dialog must never appear.
        e.preventDefault()
        session.save()
        return
      }

      if (targetIsEditable(e.target)) return

      if (key === 'z' || key === 'y') {
        e.preventDefault()
        try {
          if (key === 'y' || e.shiftKey) session.bus.redo()
          else session.bus.undo()
        } catch {
          // The bus refuses undo/redo while a paint stroke is open (a gesture
          // is atomic by contract). The keyboard can race a held pointer into
          // that window; refusing quietly beats crashing the shell.
        }
      }
    }

    // Paired add/remove: StrictMode mounts effects twice in dev, and the
    // second mount must find the world exactly as the first cleanup left it.
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [session])

  return (
    <div className="app-frame" ref={frameRef}>
      {/* The page's h1: screen-reader only, inside the banner landmark so
          axe's page-has-heading-one and region checks both hold — and FIRST
          in the DOM, so the heading outline opens before the lesson's h2. */}
      <header className="app-banner">
        <h1 className="visually-hidden">World Editor</h1>
      </header>

      <LessonPane
        session={session}
        engine={engine}
        host={host}
        split={split}
        setSplit={setSplit}
        revealAnchorChrome={revealAnchorChrome}
      />

      <SplitDivider state={split} onChange={setSplit} frameRef={frameRef} />

      <EditorPane
        session={session}
        worldOpen={worldOpen}
        inspectorOpen={inspectorOpen}
        setWorldOpen={setWorldOpen}
        setInspectorOpen={setInspectorOpen}
      />
    </div>
  )
}
