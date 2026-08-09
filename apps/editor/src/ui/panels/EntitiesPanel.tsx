/**
 * The entities panel — the world's population as a list.
 *
 * This panel is ARCHITECTURE §2.5 made real: "the canvas is never the sole
 * source of truth — every canvas-visible state is mirrored in DOM panels,
 * screen-reader reachable." Every marker drawn on the canvas appears here as
 * a real button, in snapshot.entities order — which is entityIds() order,
 * THE deterministic order every walk of the world shares (iteration,
 * serialization, picking ties). One order, and you are looking at it.
 *
 * Clicking a row selects that entity, exactly as clicking its marker on the
 * canvas would — both paths land in session.select(), so the inspector, the
 * canvas highlight, and this list can never disagree. Building the
 * selection needs the entity's world point (the Selection contract carries
 * one so tools and renderers share a shape); the row only mirrors id and
 * name, so the click handler makes one imperative, event-time read of the
 * document through the same picking helper the canvas uses — never during
 * render, which is where "React never touches the document" actually lives.
 */

import type { ReactElement } from 'react'
import { anchor } from '../../editor/anchors'
import { entityWorldPoint } from '../../editor/picking'
import type { EditorSession } from '../../editor/types'
import { useSnapshot } from '../App'

/** The world's entity list, deterministic order, selected row marked. */
export function EntitiesPanel({ session }: { session: EditorSession }): ReactElement {
  const entities = useSnapshot(session, (s) => s.entities)
  const selection = useSnapshot(session, (s) => s.selection)
  const selectedId = selection !== null && selection.kind === 'entity' ? selection.id : null

  const selectRow = (id: string): void => {
    // Event-time document read (see header): the Selection shape wants the
    // entity's world point, and the mirror row deliberately doesn't carry it.
    const entity = session.doc.entities[id]
    const point = entity === undefined ? null : entityWorldPoint(entity)
    if (point === null) return // a ghost row is already gone from the doc
    session.select({ kind: 'entity', id, point })
  }

  return (
    <section className="panel" aria-label="entities" data-anchor={anchor('panel.entities')}>
      <h2>Entities</h2>
      {entities.length === 0 ? (
        <p className="panel-empty">Nothing in the world yet — press E and place something.</p>
      ) : (
        <ul>
          {entities.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                aria-current={row.id === selectedId ? 'true' : undefined}
                onClick={() => selectRow(row.id)}
              >
                {row.name}
                {row.marker !== null && row.marker !== row.name ? (
                  <span className="toolbar-key">{row.marker}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
