/**
 * The inspector — what the selection IS, in words and numbers.
 *
 * Everything shown here is mirrored data (SelectionInfo): the session
 * re-reads name/marker/position from the document whenever it refreshes the
 * snapshot, so the panel is never staler than the last real change and never
 * touches the document itself. Three honest states:
 *
 * - **An entity**: its name (editable — blur or Enter commits ONE
 *   rename-entity command, so one history entry and one announcement), its
 *   marker kind, its position spelled the way the curriculum spells it
 *   ("(3, 4) on the ground" — an address plus a storey), and a delete
 *   button, because the inspector is where you look a thing in the eye
 *   before removing it.
 * - **A tile**: the cell's address, what is painted there, and which layer
 *   claimed it — the same facts the status bar streams, held still.
 * - **Nothing**: an empty state that TEACHES the two ways to select,
 *   because a blank panel is a wasted panel.
 */

import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { anchor } from '../../editor/anchors'
import type { EditorSession, SelectionInfo } from '../../editor/types'
import { useSnapshot } from '../App'

/** The entity arm of SelectionInfo, named for the branch component below. */
type EntityInfo = Extract<NonNullable<SelectionInfo>, { kind: 'entity' }>
/** The tile arm, likewise. */
type TileInfo = Extract<NonNullable<SelectionInfo>, { kind: 'tile' }>

/** Numbers in student spelling: integers stay bare, halves keep one place. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** "on the ground" for storey zero, "up at height z" above it. */
function storeyPhrase(elevation: number): string {
  return elevation === 0 ? 'on the ground' : `up at height ${fmt(elevation)}`
}

/** The selection inspector: entity, tile, or a teaching empty state. */
export function InspectorPanel({ session }: { session: EditorSession }): ReactElement {
  const selection = useSnapshot(session, (s) => s.selection)

  return (
    <section className="panel" aria-label="inspector" data-anchor={anchor('panel.inspector')}>
      <h2>Inspector</h2>
      {selection === null ? (
        <p className="panel-empty">
          Nothing selected. Click a tile or a crate — or press V, walk the arrows, and press Enter.
        </p>
      ) : selection.kind === 'entity' ? (
        <EntityDetails session={session} info={selection} />
      ) : (
        <TileDetails info={selection} />
      )}
    </section>
  )
}

/** The entity branch, split out so the name-input's ref and sync stay tidy. */
function EntityDetails({ session, info }: { session: EditorSession; info: EntityInfo }): ReactElement {
  /** The uncontrolled name input, held for the imperative sync below. */
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Sync an OUTSIDE rename (undo, another panel) into the uncontrolled input
  // — but never while the input owns focus: a focused input is mid-edit (or
  // just Enter-committed the very name arriving here), and snapping its
  // value would fight the keyboard. (The earlier key-by-name trick got the
  // same sync by remounting, which dropped focus to the body on every Enter
  // commit — a rename box that eats your focus once per rename.)
  useEffect(() => {
    const input = nameInputRef.current
    if (input !== null && document.activeElement !== input) input.value = info.name
  }, [info.name])

  const commitName = (input: HTMLInputElement): void => {
    const name = input.value.trim()
    if (name !== '' && name !== info.name) {
      session.bus.dispatch({ kind: 'rename-entity', id: info.id, name })
    }
  }

  const onNameKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') commitName(e.currentTarget)
  }

  return (
    <div>
      <div className="inspector-row">
        <label>
          <span className="label">name</span>
          {/* Uncontrolled: typing stays local until commit; outside renames
              arrive via the effect above. Keyed by id ONLY — selecting a
              DIFFERENT entity remounts (that field is a different thing, and
              losing focus to it is right), but a rename of THIS entity must
              never remount, or Enter would drop focus to the body. */}
          <input
            type="text"
            key={info.id}
            ref={nameInputRef}
            defaultValue={info.name}
            onBlur={(e) => commitName(e.currentTarget)}
            onKeyDown={onNameKeyDown}
          />
        </label>
      </div>
      <p className="inspector-row">
        <span className="label">kind</span>
        {info.marker ?? 'no marker'}
      </p>
      <p className="inspector-row">
        <span className="label">position</span>({fmt(info.position.x)}, {fmt(info.position.y)}){' '}
        {storeyPhrase(info.elevation)}
      </p>
      <div className="inspector-actions">
        <button
          type="button"
          className="danger"
          onClick={() => {
            // A button click can race a held pointer mid-paint, and the bus
            // throws on dispatch while a stroke is open (gestures are
            // atomic) — ask the honest predicate and refuse quietly.
            if (session.bus.strokeOpen()) return
            // Deselect only when the delete really happened: a refused
            // dispatch (a stale id) must not silently drop the selection.
            if (session.bus.dispatch({ kind: 'delete-entity', id: info.id }).ok) {
              session.select(null)
            }
          }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

/** The tile branch: address, contents, storey — held still for reading. */
function TileDetails({ info }: { info: TileInfo }): ReactElement {
  return (
    <div>
      <p className="inspector-row">
        <span className="label">cell</span>({info.tile.tx}, {info.tile.ty})
      </p>
      <p className="inspector-row">
        <span className="label">tile</span>
        {info.tileName ?? 'empty'}
      </p>
      <p className="inspector-row">
        <span className="label">layer</span>
        {info.tile.layerId ?? 'open ground'}
      </p>
    </div>
  )
}
