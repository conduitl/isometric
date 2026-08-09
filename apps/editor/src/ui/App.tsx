/**
 * The App frame — the fixed CSS grid that holds every panel (ARCHITECTURE
 * §6: fixed grid v1, docking deferred), and the two whole-app concerns that
 * belong to no single panel:
 *
 * 1. **The global keyboard.** Undo, redo, and save are editor-wide verbs, so
 *    they listen on `window`, not on any panel: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z
 *    (and Ctrl/Cmd+Y), Ctrl/Cmd+S. Save calls preventDefault FIRST — the
 *    browser's own save dialog must never appear over a kid's world. The
 *    handlers announce nothing themselves: every completed action's label
 *    flows through the session's `lastAction` into the status bar's live
 *    region, so there is exactly one voice.
 *
 * 2. **useSnapshot — React's one window into the editor.** A thin wrapper
 *    over zustand v5's `useStore(store, selector)` against the session's
 *    vanilla store. Panels select single FIELDS (stable references between
 *    snapshot writes), never derived objects — a selector that built a fresh
 *    object per call would defeat Object.is and re-render forever. The store
 *    is throttled by construction (only real changes write it), so React
 *    re-renders at edit rate, never pointer rate; anything pointer-rate
 *    rides the FastChannel straight past React (see StatusBar).
 *
 * The frame renders panels and hands each the session; panels call named
 * session methods and render snapshot fields. React never touches the
 * document — that is the whole boundary, and this file is its front door.
 */

import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { useStore } from 'zustand'
import type { EditorSession, EditorSnapshot } from '../editor/types'
import { EngineViewport } from './EngineViewport'
import { EntitiesPanel } from './panels/EntitiesPanel'
import { EntityPalette } from './panels/EntityPalette'
import { InspectorPanel } from './panels/InspectorPanel'
import { LayersPanel } from './panels/LayersPanel'
import { LessonRail } from './panels/LessonRail'
import { StatusBar } from './panels/StatusBar'
import { TilePalette } from './panels/TilePalette'
import { Toolbar } from './panels/Toolbar'

/**
 * Select one slice of the editor snapshot. Every panel reads the store
 * through this hook and nothing else — grep `useSnapshot` and you have found
 * every place React learns anything about the editor.
 */
export function useSnapshot<T>(session: EditorSession, selector: (snapshot: EditorSnapshot) => T): T {
  return useStore(session.store, selector)
}

/** Is this keydown aimed at a text field? Native editing (including the
 * field's own Ctrl+Z) must win there — a rename box owns its own undo. */
function targetIsEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

/** The editor shell: toolbar over left rail / viewport / right rail over
 * status bar, with the global keyboard attached for its lifetime. */
export function App({ session }: { session: EditorSession }): ReactElement {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
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
    <div className="editor-frame">
      <header className="frame-toolbar">
        {/* The page's h1: screen-reader only, inside the banner landmark so
            axe's page-has-heading-one and region checks both hold. Every
            visible panel heading is an h2 under it. */}
        <h1 className="visually-hidden">World Editor</h1>
        <Toolbar session={session} />
      </header>

      <div className="frame-left">
        <TilePalette session={session} />
        <EntityPalette session={session} />
        <LayersPanel session={session} />
      </div>

      <main className="frame-viewport">
        <EngineViewport session={session} />
      </main>

      <div className="frame-right">
        <InspectorPanel session={session} />
        <EntitiesPanel session={session} />
        <LessonRail session={session} />
      </div>

      <footer className="frame-status">
        <StatusBar session={session} />
      </footer>
    </div>
  )
}
