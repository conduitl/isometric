/**
 * The editor pane — the world as a SURFACE, FigJam-style.
 *
 * Docked rails charge rent whether or not you're using them; in the split
 * layout that rent is paid out of the editor's share of the divider. So the
 * canvas owns the whole pane and the chrome FLOATS above it:
 *
 * - a **tools pill** across the top (the Toolbar, unchanged inside — every
 *   toolbar.* anchor, the view radiogroup, the file verbs);
 * - a **World card** docked bottom-left: the tile palette, the entity
 *   palette, and the layers + entities lists — the standalone Entities
 *   panel folded in, NOT deleted: it is ARCHITECTURE §2.5's canvas mirror
 *   and the only keyboard path to select an entity, and `panel.entities`
 *   is anchor-registry frozen;
 * - a contextual **Inspector card** top-right that follows the selection:
 *   it opens when something is selected and folds away when nothing is.
 *
 * Cards collapse to chips (bottom-left, FigJam's own pattern) — manually
 * via each card's collapse button, automatically when the divider squeezes
 * the pane below a workable width. Collapsing HIDES, never unmounts: every
 * data-anchor inside a card stays in the DOM (the registry's promise), and
 * a lesson's "show me" re-opens the owning card through App before it
 * spotlights (LessonPane.revealAnchorChrome).
 *
 * The chrome layer is pointer-events: none with interactive children opted
 * back in, so every un-chromed pixel drags, paints, and picks as the canvas
 * it is. DOM order (pill → cards → canvas → status) keeps the tab ring the
 * e2e gates walk: palettes before the canvas, exactly as the old rails
 * stood.
 */

import { useEffect, useRef } from 'react'
import type { Dispatch, ReactElement, SetStateAction } from 'react'
import type { EditorSession } from '../editor/types'
import { useSnapshot } from './App'
import { EngineViewport } from './EngineViewport'
import { EntitiesPanel } from './panels/EntitiesPanel'
import { EntityPalette } from './panels/EntityPalette'
import { InspectorPanel } from './panels/InspectorPanel'
import { LayersPanel } from './panels/LayersPanel'
import { OverlayCard } from './panels/OverlayCard'
import { StatusBar } from './panels/StatusBar'
import { TilePalette } from './panels/TilePalette'
import { Toolbar } from './panels/Toolbar'

/** Below this pane width (CSS px) the cards auto-fold to chips — floating
 * chrome must never bury a narrow world. Crossing back re-opens the World
 * card (the Inspector re-opens itself with the next selection). */
const NARROW_PANE = 560

export function EditorPane({
  session,
  worldOpen,
  inspectorOpen,
  setWorldOpen,
  setInspectorOpen,
}: {
  session: EditorSession
  worldOpen: boolean
  inspectorOpen: boolean
  setWorldOpen: Dispatch<SetStateAction<boolean>>
  setInspectorOpen: Dispatch<SetStateAction<boolean>>
}): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null)
  const selection = useSnapshot(session, (s) => s.selection)

  // The Inspector is CONTEXTUAL: a selection opens it, a deselection folds
  // it. (The chip can still open it empty — it shows the teaching empty
  // state — until the next selection change reasserts the rule.)
  useEffect(() => {
    setInspectorOpen(selection !== null)
  }, [selection, setInspectorOpen])

  // Auto-fold on the narrow-width CROSSING, not on every resize tick — a
  // student's manual open/close survives ordinary dragging and only the
  // squeeze (or the un-squeeze) overrides it.
  useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    let previousNarrow: boolean | null = null
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      const narrow = width < NARROW_PANE
      if (narrow === previousNarrow) return
      const crossed = previousNarrow !== null
      previousNarrow = narrow
      if (!crossed) return // first measurement is a reading, not a squeeze
      setWorldOpen(!narrow)
      if (narrow) setInspectorOpen(false)
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [setWorldOpen, setInspectorOpen])

  return (
    <main className="editor-pane">
      <div className="editor-stage" ref={stageRef}>
        {/* The chrome layer: transparent to pointers except its widgets. */}
        <div className="stage-chrome">
          <div className="tools-pill">
            <Toolbar session={session} />
          </div>
          <div className="stage-field">
            <OverlayCard
              title="Inspector"
              className="inspector-card"
              open={inspectorOpen}
              onCollapse={() => setInspectorOpen(false)}
            >
              <InspectorPanel session={session} />
            </OverlayCard>
            <div className="stage-dock">
              <OverlayCard
                title="World"
                className="world-card"
                open={worldOpen}
                onCollapse={() => setWorldOpen(false)}
              >
                <TilePalette session={session} />
                <EntityPalette session={session} />
                <LayersPanel session={session} />
                <EntitiesPanel session={session} />
              </OverlayCard>
              <div className="chip-row">
                {worldOpen ? null : (
                  <button type="button" className="chip" onClick={() => setWorldOpen(true)}>
                    World
                  </button>
                )}
                {inspectorOpen ? null : (
                  <button type="button" className="chip" onClick={() => setInspectorOpen(true)}>
                    Inspector
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        <EngineViewport session={session} />
      </div>

      <footer className="editor-status">
        <StatusBar session={session} />
      </footer>
    </main>
  )
}
