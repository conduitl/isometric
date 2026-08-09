/**
 * The entity palette — what the placer can put into the world.
 *
 * One button per marker kind from the snapshot (a short, fixed trio this
 * phase — player, crate, tree; custom markers arrive with later tiers).
 * Same convention as the tile palette, for the same reason: choosing WHAT
 * to place is declaring an intent to place, so the click also switches to
 * the placer tool. The two palettes teaching one gesture ("pick a thing,
 * then touch the world") is deliberate — the editor's grammar should be
 * learnable once.
 */

import type { ReactElement } from 'react'
import { anchor } from '../../editor/anchors'
import type { EditorSession } from '../../editor/types'
import { useSnapshot } from '../App'

/** The marker rail: every placeable kind, the active one pressed. */
export function EntityPalette({ session }: { session: EditorSession }): ReactElement {
  const markers = useSnapshot(session, (s) => s.markers)
  const activeMarker = useSnapshot(session, (s) => s.activeMarker)

  return (
    <section className="panel" aria-label="entity palette">
      <h2>Things</h2>
      <div className="swatch-list" role="group" aria-label="things to place" data-anchor={anchor('palette.entities')}>
        {markers.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={kind === activeMarker}
            onClick={() => {
              // Choosing a thing means you want to place it — the placer
              // comes with the choice.
              session.setActiveMarker(kind)
              session.setActiveTool('placer')
            }}
          >
            {kind}
          </button>
        ))}
      </div>
    </section>
  )
}
