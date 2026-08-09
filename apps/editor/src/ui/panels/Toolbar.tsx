/**
 * The toolbar — tools, history, and the file verbs, in one header row.
 *
 * Everything here is a named session call and a snapshot read; the only
 * React state is UI-local by nature (an import/restore refusal message, and
 * the restore button's two-press arming). Notes on the deliberate bits:
 *
 * - **Tool buttons are toggles, not commands**: aria-pressed mirrors
 *   activeToolId, and aria-keyshortcuts names the single-key shortcut the
 *   viewport honors — the same story the canvas's aria-label tells.
 * - **Export is a download, not a dialog**: serialize through the session,
 *   wrap in a Blob, click a synthetic link. The file is named after the
 *   world because the file IS the world — a kid dragging it back in later
 *   should recognize it.
 * - **Import failures stay on screen**: parseWorld's student-language
 *   diagnosis lands in a role="alert" line under the toolbar, never a
 *   thrown error, never a native dialog.
 * - **Restore backup arms, then fires**: the first press turns the button
 *   into a question ("Restore backup?"), the second answers it; focus
 *   leaving disarms. A two-state toggle rather than a timeout on purpose —
 *   no wall-clock in the editor, and a question that waits patiently is
 *   kinder than one that expires.
 * - **The world-name input is uncontrolled**, synced by hand: typing stays
 *   local until blur/Enter commits ONE rename-world command (one history
 *   entry, one announcement). An OUTSIDE rename (undo, load) is written into
 *   the input imperatively — but only while the input is not focused, so a
 *   self-commit with Enter keeps the caret where the kid left it. (The
 *   earlier key-by-name trick got the same sync by remounting, which dropped
 *   focus to the body on every Enter commit.)
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { anchor } from '../../editor/anchors'
import type { EditorSession } from '../../editor/types'
import { useSnapshot } from '../App'

/** What hovering a non-primary view button promises — the whole lesson in
 * one sentence. */
const XRAY_TITLE = 'X-ray view — same world, different matrix'

/** The header toolbar: tool toggles, undo/redo, and the file ceremony. */
export function Toolbar({ session }: { session: EditorSession }): ReactElement {
  const activeToolId = useSnapshot(session, (s) => s.activeToolId)
  const canUndo = useSnapshot(session, (s) => s.canUndo)
  const canRedo = useSnapshot(session, (s) => s.canRedo)
  const worldName = useSnapshot(session, (s) => s.worldName)
  const viewProjection = useSnapshot(session, (s) => s.viewProjection)
  const primaryProjection = useSnapshot(session, (s) => s.primaryProjection)

  /** The projection the picture is currently in: null means "the primary",
   * and the snapshot's primaryProjection names which button that is — so
   * exactly one view button always reads pressed. */
  const effectiveView = viewProjection ?? primaryProjection

  /** Student-language refusal from the last import/restore, or null. */
  const [loadError, setLoadError] = useState<string | null>(null)
  /** Restore backup's two-press confirm: armed = "Restore backup?" showing. */
  const [restoreArmed, setRestoreArmed] = useState(false)

  /** The uncontrolled world-name input, held for the imperative sync below. */
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Sync an OUTSIDE rename (undo, load, import) into the uncontrolled input
  // — but never while the input owns focus: a focused input is mid-edit (or
  // just Enter-committed the very name arriving here), and snapping its
  // value would fight the keyboard. Any focus loss commits via onBlur, so
  // an unfocused input is always safe to overwrite with the snapshot truth.
  useEffect(() => {
    const input = nameInputRef.current
    if (input !== null && document.activeElement !== input) input.value = worldName
  }, [worldName])

  const commitName = (input: HTMLInputElement): void => {
    const name = input.value.trim()
    if (name !== '' && name !== worldName) {
      session.bus.dispatch({ kind: 'rename-world', name })
    }
  }

  const onNameKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') commitName(e.currentTarget)
  }

  const handleExport = (): void => {
    // Serialize through the session (canonical bytes — same world, same
    // file, forever), then hand the browser a Blob to download.
    const blob = new Blob([session.exportText()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${worldName === '' ? 'world' : worldName}.world.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleImportPicked = (input: HTMLInputElement): void => {
    const file = input.files?.[0]
    // Reset so picking the SAME file again still fires change — a kid
    // retrying after fixing their file deserves a second attempt.
    input.value = ''
    if (file === undefined) return
    void file.text().then((text) => {
      const outcome = session.importText(text)
      setLoadError(outcome.ok ? null : outcome.message)
    })
  }

  const handleRestore = (): void => {
    if (!restoreArmed) {
      setRestoreArmed(true)
      return
    }
    setRestoreArmed(false)
    const outcome = session.restoreBackup()
    setLoadError(outcome.ok ? null : outcome.message)
  }

  return (
    <div className="toolbar" aria-label="editor toolbar">
      <div className="toolbar-group" role="group" aria-label="tools">
        <button
          type="button"
          data-anchor={anchor('toolbar.select')}
          aria-pressed={activeToolId === 'select'}
          aria-keyshortcuts="v"
          onClick={() => session.setActiveTool('select')}
        >
          Select<span className="toolbar-key">V</span>
        </button>
        <button
          type="button"
          data-anchor={anchor('toolbar.brush')}
          aria-pressed={activeToolId === 'brush'}
          aria-keyshortcuts="b"
          onClick={() => session.setActiveTool('brush')}
        >
          Brush<span className="toolbar-key">B</span>
        </button>
        <button
          type="button"
          data-anchor={anchor('toolbar.placer')}
          aria-pressed={activeToolId === 'placer'}
          aria-keyshortcuts="e"
          onClick={() => session.setActiveTool('placer')}
        >
          Placer<span className="toolbar-key">E</span>
        </button>
      </div>

      <div className="toolbar-group" role="radiogroup" aria-label="view">
        {/* The curated view lens (ARCHITECTURE §4): re-project the SAME world
            through another matrix. Clicking the primary's own button returns
            to the null lens (the document's projection, undecorated); any
            other button sets the X-ray lens — and says so in its title. The
            document is untouched either way. Spelled out longhand — three
            near-identical buttons — because the anchor tripwire scans for
            LITERAL ids at attachment sites (anchors.test.ts).

            A radiogroup, not three toggles: exactly one view is ever the
            picture on screen, and three independent aria-pressed buttons
            announced as three switches that could each be on — a lie about
            the model. role=radio + aria-checked says "one of three",
            which is the truth. The canonical radiogroup pattern would add
            roving tabindex + arrow-key movement; deliberately SKIPPED:
            these are toolbar buttons the keyboard flow already reaches by
            Tab (the e2e tutorial flow pins Tab-reachability of all three),
            and taking two of them out of the tab order without also
            shipping the arrow-key handling would strand keyboard users.
            All three stay plain Tab stops.

            The X-ray explanation lives in ONE visually-hidden span that the
            non-primary buttons aria-describedby: title= alone is mouse-only
            (assistive tech and keyboard users never see a tooltip), so the
            title stays for hover and the span speaks for everyone else. */}
        <span id="toolbar-xray-note" className="visually-hidden">
          {XRAY_TITLE}
        </span>
        <button
          type="button"
          role="radio"
          data-anchor={anchor('toolbar.viewTopdown')}
          aria-checked={effectiveView === 'topdown'}
          title={primaryProjection === 'topdown' ? undefined : XRAY_TITLE}
          aria-describedby={primaryProjection === 'topdown' ? undefined : 'toolbar-xray-note'}
          onClick={() => session.setViewProjection(primaryProjection === 'topdown' ? null : 'topdown')}
        >
          Top-down
        </button>
        <button
          type="button"
          role="radio"
          data-anchor={anchor('toolbar.viewIso')}
          aria-checked={effectiveView === 'iso'}
          title={primaryProjection === 'iso' ? undefined : XRAY_TITLE}
          aria-describedby={primaryProjection === 'iso' ? undefined : 'toolbar-xray-note'}
          onClick={() => session.setViewProjection(primaryProjection === 'iso' ? null : 'iso')}
        >
          Iso
        </button>
        <button
          type="button"
          role="radio"
          data-anchor={anchor('toolbar.viewProfile')}
          aria-checked={effectiveView === 'profile'}
          title={primaryProjection === 'profile' ? undefined : XRAY_TITLE}
          aria-describedby={primaryProjection === 'profile' ? undefined : 'toolbar-xray-note'}
          onClick={() => session.setViewProjection(primaryProjection === 'profile' ? null : 'profile')}
        >
          Profile
        </button>
      </div>

      <div className="toolbar-group" role="group" aria-label="history">
        {/* Both handlers ask bus.strokeOpen() first: a button click can race
            a held pointer mid-paint, and the bus throws on undo/redo while a
            stroke is open (gestures are atomic) — refuse quietly instead.
            The GUARD lives in the handler, not in disabled=: disabled means
            "the stack is empty" (canUndo/canRedo), and a mid-stroke moment
            is a race to survive, not a state to display. */}
        <button
          type="button"
          data-anchor={anchor('toolbar.undo')}
          disabled={!canUndo}
          aria-keyshortcuts="Control+Z Meta+Z"
          onClick={() => {
            if (!session.bus.strokeOpen()) session.bus.undo()
          }}
        >
          Undo
        </button>
        <button
          type="button"
          data-anchor={anchor('toolbar.redo')}
          disabled={!canRedo}
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
          onClick={() => {
            if (!session.bus.strokeOpen()) session.bus.redo()
          }}
        >
          Redo
        </button>
      </div>

      <div className="toolbar-group" role="group" aria-label="file">
        <button
          type="button"
          data-anchor={anchor('toolbar.save')}
          aria-keyshortcuts="Control+S Meta+S"
          onClick={() => session.save()}
        >
          Save
        </button>
        <button type="button" data-anchor={anchor('toolbar.export')} onClick={handleExport}>
          Export
        </button>
        {/* The real file input stays off-screen; the visible button clicks it.
            A label-wrapped input would also work, but a button keeps the
            toolbar's focus order and styling uniform. */}
        <input
          type="file"
          accept=".json,.world.json"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          id="import-world-file"
          onChange={(e) => handleImportPicked(e.currentTarget)}
        />
        <button
          type="button"
          data-anchor={anchor('toolbar.import')}
          onClick={() => document.getElementById('import-world-file')?.click()}
        >
          Import
        </button>
        <button
          type="button"
          data-anchor={anchor('toolbar.restoreBackup')}
          onClick={handleRestore}
          onBlur={() => setRestoreArmed(false)}
        >
          {restoreArmed ? 'Restore backup?' : 'Restore backup'}
        </button>
      </div>

      <div className="toolbar-group" role="group" aria-label="world">
        <label>
          <span className="visually-hidden">world name</span>
          {/* Uncontrolled + ref: the effect above writes outside renames in;
              no key= — a remount here would steal focus on every commit. */}
          <input
            type="text"
            ref={nameInputRef}
            data-anchor={anchor('toolbar.worldName')}
            defaultValue={worldName}
            onBlur={(e) => commitName(e.currentTarget)}
            onKeyDown={onNameKeyDown}
          />
        </label>
      </div>

      {/* Import/restore refusals land here, in the student's own language —
          rendered only when there is something to say. */}
      <div className="toolbar-alert" role="alert">
        {loadError}
      </div>
    </div>
  )
}
