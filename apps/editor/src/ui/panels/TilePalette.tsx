/**
 * The tile palette — the brush's paint pots.
 *
 * One button per palette entry, straight from the snapshot: the session
 * derives the list from the active layer's tileset (eraser first, then tiles
 * as cell values 1..n — the same off-by-one convention the cell data itself
 * uses, shown instead of hidden). Each button is a swatch of the tile's real
 * top color plus its name, because the palette should look like the world it
 * paints.
 *
 * Clicking a tile also switches to the brush: picking a color IS declaring
 * an intent to paint, and making the kid find the brush button afterwards
 * would be pure friction. The keyboard user gets the same deal — the button
 * activates with Enter/Space, and focus can then Tab (or click) to the
 * canvas to paint with the cell cursor.
 */

import type { ReactElement } from 'react'
import { anchor } from '../../editor/anchors'
import type { EditorSession } from '../../editor/types'
import { useSnapshot } from '../App'

/** The palette rail: every paintable tile of the active layer, eraser first. */
export function TilePalette({ session }: { session: EditorSession }): ReactElement {
  const palette = useSnapshot(session, (s) => s.palette)
  const activeTile = useSnapshot(session, (s) => s.activeTile)

  return (
    <section className="panel" aria-label="tile palette">
      <h2>Tiles</h2>
      <div className="swatch-list" role="group" aria-label="tiles" data-anchor={anchor('palette.tiles')}>
        {palette.map((tile) => (
          <button
            key={tile.value}
            type="button"
            aria-pressed={tile.value === activeTile}
            onClick={() => {
              // Picking a tile means you want to paint — so the brush comes
              // with it, no second click required.
              session.setActiveTile(tile.value)
              session.setActiveTool('brush')
            }}
          >
            <span className="swatch" style={{ backgroundColor: tile.color }} aria-hidden="true" />
            {tile.name}
          </button>
        ))}
      </div>
    </section>
  )
}
