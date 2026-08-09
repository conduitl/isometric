/**
 * The layers panel — which storey of the world the tools are editing.
 *
 * The active layer decides what the brush paints on, which tileset the
 * palette shows, and which elevation the pointer's inverse walk pins
 * (picking.ts: a brush on the ground floor must not slide onto a plateau
 * just because the cursor crossed its picture). The starter world has one
 * layer, so this panel looks almost decorative today — but multi-storey
 * worlds are already legal in the format, and the panel renders whatever
 * the snapshot mirrors.
 */

import type { ReactElement } from 'react'
import { anchor } from '../../editor/anchors'
import type { EditorSession } from '../../editor/types'
import { useSnapshot } from '../App'

/** The layer list, active one pressed; click to move the tools there. */
export function LayersPanel({ session }: { session: EditorSession }): ReactElement {
  const layers = useSnapshot(session, (s) => s.layers)
  const activeLayerId = useSnapshot(session, (s) => s.activeLayerId)

  return (
    <section className="panel" aria-label="layers" data-anchor={anchor('panel.layers')}>
      <h2>Layers</h2>
      {layers.length === 0 ? (
        <p className="panel-empty">no layers yet</p>
      ) : (
        <ul>
          {layers.map((layer) => (
            <li key={layer.id}>
              <button
                type="button"
                aria-pressed={layer.id === activeLayerId}
                onClick={() => session.setActiveLayer(layer.id)}
              >
                {layer.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
