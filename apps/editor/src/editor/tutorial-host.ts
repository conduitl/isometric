/**
 * The editor's TutorialHost — the one seam @engine/tutorial's machine
 * touches the editor through (ARCHITECTURE §9: the engine is app-blind;
 * everything app-shaped crosses this seam).
 *
 * Every capability the host grants is a thin arrow onto something the
 * session already exposes publicly:
 *
 * - events    → session.onEvent (the one builder.* spine)
 * - the world → session.doc (read-only; predicates never mutate)
 * - effects   → session.setViewProjection / session.setOverlays — the
 *               declarative step effects become the same named calls the
 *               toolbar's view buttons make; no private channel
 * - fixtures  → the FIXTURES catalogue, loaded through session.loadWorld
 *               with origin 'fixture' (a borrowed lesson backdrop: the
 *               session refuses save() while it is live — see the parked
 *               world below)
 * - progress  → a JSON-in-string-storage ProgressStore (below)
 * - publish   → the store's `tutorial` slice, which refreshSnapshot
 *               deliberately never writes (session.ts) so the two writers
 *               cannot fight — plus session.announce for what CHANGED
 *               (step, hint, done), so the rail's movement reaches the
 *               status bar's one live region and screen readers hear it
 *
 * ## The parked world (the fixture-save hazard, closed)
 *
 * loadFixture swaps the live document — which would silently discard the
 * student's own world (and every unsaved edit in it) if nothing kept a
 * copy. So the host PARKS first: it serializes the current document into
 * string storage under {@link PARKED_WORLD_KEY}, then loads the fixture
 * with origin 'fixture' (the session's save() refuses while that flag is
 * up, so Ctrl+S on the island can never overwrite the student's save
 * slot). Two rules keep the park honest:
 *
 * - **Fixture→fixture never re-parks.** If the live document is already a
 *   fixture, parking it would overwrite the student's world with lesson
 *   scenery — the exact loss the park exists to prevent.
 * - **restoreParkedIfAny spends the park.** On success it loads the parked
 *   world back (origin 'park-restore' — the badge honestly says 'unsaved',
 *   because the restored bytes may exist in no save slot until the student
 *   presses Ctrl+S) and removes the key. A MISSING park removes nothing
 *   and reports false; a CORRUPT park is removed and reports false
 *   — deliberately: keeping broken bytes would wedge "back to my world"
 *   forever on the same re-failing parse, while clearing costs only the
 *   parked copy (the student's last real save still sits in the world
 *   slots). Parsing failures never throw (parseWorld answers, always).
 * - **A NEW live world kills the stale park.** The host listens on the one
 *   event spine: when a world-loaded arrives while the live document is
 *   NOT a fixture and the host is not mid-restore itself, the park is
 *   removed — a student who imports (or loads, or news up) a world while a
 *   fixture holds the stage has walked away from that detour, and letting
 *   the old park later "restore" over their newer work would be the very
 *   clobbering the park exists to prevent. Walked by origin: 'fixture'
 *   arrivals keep the park (fixtureActive is up — the park is exactly what
 *   it protects); 'park-restore' keeps it (the mid-restore flag — the key
 *   is being spent by restoreParkedIfAny itself); 'boot' never reaches
 *   this listener at all (the session boots inside its factory, BEFORE
 *   this host exists to subscribe — main.tsx's order, which is what lets
 *   the boot restore find the park after a mid-fixture reload); every
 *   other origin — load, import, restore, new — kills it.
 *
 * The widened return type ({@link EditorTutorialHost}) carries the two
 * park verbs the editor UI needs; it is still a TutorialHost — the engine
 * sees nothing app-shaped.
 *
 * ## The progress store
 *
 * Progress survives reload (a Phase 3 exit criterion) in string storage
 * under ONE key: the whole TutorialProgress as JSON. The storage is
 * injectable for tests and resolved AT CALL TIME by default — localStorage
 * is looked up when read/write/clear actually run, never at import or
 * construction, so this module (and a host built in node) stays
 * import-safe headless. Corrupt or unreadable stored bytes read as null —
 * a damaged breadcrumb restarts the lesson, which is annoying; a thrown
 * parse error would take the whole editor down with it, which is worse.
 */

import type { StepEffect, TutorialHost, TutorialProgress, TutorialUiState } from '@engine/tutorial'
import { parseWorld, serializeWorld } from '@engine/world-format'
import { FIXTURES } from './fixtures'
import type { EditorSession } from './types'

/** Where progress lives in string storage. Same 'editor:' family as the
 * world slots (types.ts SAVE_PREFIX), its own key — progress is not a
 * world and must never collide with the save ceremony's suffixes. */
export const TUTORIAL_PROGRESS_KEY = 'editor:tutorial-progress'

/** Where the parked world lives while a fixture borrows the stage. Same
 * injectable string storage as progress, its own key — the park is a
 * whole serialized world, and it must never collide with the save
 * ceremony's slots (parking is not saving: the ceremony's backup rotation
 * must not learn about lesson detours). */
export const PARKED_WORLD_KEY = 'editor:parked-world'

/**
 * The host the editor actually builds: @engine/tutorial's TutorialHost,
 * verbatim, plus the two park verbs the editor UI needs (main.tsx's boot
 * restore and the lesson rail's "Back to my world"). Still assignable to
 * TutorialHost — the engine never sees the widening.
 */
export interface EditorTutorialHost extends TutorialHost {
  /** Bring the parked world back, if one is parked: load it (origin
   * 'park-restore' — the save badge lands on 'unsaved' with the keep-it
   * message, because the restored bytes may sit in no save slot), remove
   * the park, answer true. Missing park → false, nothing removed. Corrupt
   * park → false, park removed (see the file header for why removal is
   * the kind choice). Never throws. */
  restoreParkedIfAny(): boolean
  /** Is a parked world waiting? (The rail hides "Back to my world" when
   * the answer is no.) */
  hasParked(): boolean
}

/** The slice of the Storage interface the progress store actually uses —
 * localStorage satisfies it; tests satisfy it with a Map in three lines. */
export interface TutorialProgressStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** What createEditorTutorialHost accepts: a string storage for progress.
 * Default is the real localStorage, resolved at call time (node-safe). */
export interface CreateEditorTutorialHostOptions {
  readonly storage?: TutorialProgressStorage
}

/** Does this parsed value have TutorialProgress's shape? Field-by-field,
 * because stored bytes crossed a serialization boundary and answer to
 * nobody — anything short of the full shape reads as "no progress". (The
 * machine additionally clamps the numbers into range; this check only
 * guards the types.) */
function isProgressShaped(value: unknown): value is TutorialProgress {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record['lessonId'] === 'string' &&
    typeof record['stepIndex'] === 'number' &&
    typeof record['revealedHints'] === 'number'
  )
}

/**
 * Build the host over a session. See the file header for what each seam
 * maps onto; the shape is @engine/tutorial's TutorialHost, verbatim.
 * Arrow wrappers rather than method references throughout — the host
 * contract wants functions, and wrappers stay correct regardless of how
 * the session binds its methods.
 */
export function createEditorTutorialHost(
  session: EditorSession,
  opts: CreateEditorTutorialHostOptions = {},
): EditorTutorialHost {
  /** The storage, resolved when actually needed: the injected one, else
   * the browser's localStorage, else null (node — every operation then
   * no-ops/answers null, honestly: nothing was stored, nothing can be). */
  const storageNow = (): TutorialProgressStorage | null => {
    if (opts.storage !== undefined) return opts.storage
    const maybe = (globalThis as { localStorage?: TutorialProgressStorage }).localStorage
    return maybe ?? null
  }

  /** True while restoreParkedIfAny's own loadWorld is in flight — the one
   * world-loaded the stale-park listener below must NOT treat as "the
   * student chose a new world" (the park's key is being spent by the
   * restore itself, on purpose). */
  let restoringPark = false

  // The stale-park listener (file header: "A NEW live world kills the stale
  // park"). Subscribed at host creation — AFTER the session booted inside
  // its factory, so a boot world-loaded never reaches it and a parked world
  // survives to be boot-restored (main.tsx restores BEFORE any lesson
  // starts; the creation order is the guarantee, and tests pin it).
  session.onEvent((event) => {
    if (event.type !== 'builder.world-loaded') return
    if (restoringPark) return // the host's own restore: the key is being spent, not clobbered
    if (session.fixtureActive) return // a fixture arrival: the park is exactly what it protects
    // Any other live-world arrival (load / import / restore / new): the
    // student chose a NEW world, and the park — a copy of a world they
    // have moved past — is now stale. A stale park silently restored later
    // would clobber this newer work, so it dies here, the moment the
    // choice is made.
    try {
      storageNow()?.removeItem(PARKED_WORLD_KEY)
    } catch {
      // a storage refusal is not a crash; hasParked over-reports until
      // storage cooperates — the same posture as the spent-park removal
    }
  })

  /** What publish() last handed the rail — the diff base for the announced
   * step/hint/done changes (see publish below). Null until the first
   * publish, and again after a publish(null). */
  let lastPublished: TutorialUiState | null = null

  return {
    on: (listener) => session.onEvent(listener),

    doc: () => session.doc,

    applyEffect(effect: StepEffect): void {
      switch (effect.kind) {
        case 'set-view-projection':
          session.setViewProjection(effect.projection)
          return
        case 'show-overlays':
          session.setOverlays(effect.overlays)
          return
        default: {
          // Exhaustive today; a future effect kind arriving through old app
          // code lands here and is deliberately ignored — a lesson written
          // for a newer editor degrades to a missing decoration, never a
          // crash (the same posture parseWorld takes with unknown fields).
          const unhandled: never = effect
          void unhandled
        }
      }
    },

    loadFixture(fixtureId: string): boolean {
      const make = FIXTURES[fixtureId]
      if (make === undefined) return false // unknown id: the lesson runs on the current world
      // PARK before the swap — but only when the live document is the
      // student's own. A fixture→fixture switch (one fixture lesson to
      // another) must never overwrite the park: the park holds the
      // student's world, and the live fixture is just borrowed scenery.
      if (!session.fixtureActive) {
        try {
          storageNow()?.setItem(PARKED_WORLD_KEY, serializeWorld(session.doc))
        } catch {
          // Quota or privacy-mode refusal: the park could not be written.
          // The fixture still loads — the student's world is not LOST
          // (their last real save sits in the world slots, and save()
          // stays refused while the fixture is live), though unsaved edits
          // will not survive the swap. Blocking the flagship lesson on a
          // throwing storage would be worse than that narrow loss.
        }
      }
      session.loadWorld(make(), 'fixture')
      return true
    },

    restoreParkedIfAny(): boolean {
      const storage = storageNow()
      if (storage === null) return false
      let raw: string | null
      try {
        raw = storage.getItem(PARKED_WORLD_KEY)
      } catch {
        return false // a storage that throws on read has no park to offer
      }
      if (raw === null) return false // no park: nothing to restore, nothing to remove
      const parsed = parseWorld(raw) // answers, never throws — the format's whole posture
      if (!parsed.ok) {
        // Corrupt park: remove it and report false. Keeping it would wedge
        // the flow forever — every "back to my world" re-reading the same
        // broken bytes and re-failing — while removal costs only the
        // parked copy (the last real save still sits in the world slots).
        try {
          storage.removeItem(PARKED_WORLD_KEY)
        } catch {
          // a storage refusal is not a crash; the next attempt re-decides
        }
        return false
      }
      // Load FIRST, then spend the park: if loadWorld ever threw, the park
      // would survive for another attempt rather than vanish unused. The
      // flag brackets the load so the stale-park listener above knows this
      // world-loaded is the restore itself, not a new choice — and origin
      // 'park-restore' lands the badge on 'unsaved' with the keep-it
      // message (session.ts): the restored bytes may sit in no save slot.
      restoringPark = true
      try {
        session.loadWorld(parsed.world, 'park-restore')
      } finally {
        restoringPark = false
      }
      try {
        storage.removeItem(PARKED_WORLD_KEY)
      } catch {
        // the world is already back; a lingering key only means hasParked
        // over-reports until storage cooperates
      }
      return true
    },

    hasParked(): boolean {
      const storage = storageNow()
      if (storage === null) return false
      try {
        return storage.getItem(PARKED_WORLD_KEY) !== null
      } catch {
        return false // unreadable storage holds no park anyone can use
      }
    },

    progress: {
      read(): TutorialProgress | null {
        const storage = storageNow()
        if (storage === null) return null
        let raw: string | null
        try {
          raw = storage.getItem(TUTORIAL_PROGRESS_KEY)
        } catch {
          return null // a storage that throws on read has no progress to offer
        }
        if (raw === null) return null
        try {
          const parsed: unknown = JSON.parse(raw)
          return isProgressShaped(parsed) ? parsed : null
        } catch {
          return null // corrupt JSON reads as "no progress", never as a crash
        }
      },
      write(progress: TutorialProgress): void {
        try {
          storageNow()?.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify(progress))
        } catch {
          // Quota or privacy-mode refusal: progress simply does not survive
          // this reload. The lesson keeps running — losing a breadcrumb must
          // never lose the student's live place.
        }
      },
      clear(): void {
        try {
          storageNow()?.removeItem(TUTORIAL_PROGRESS_KEY)
        } catch {
          // Same posture as write: a storage refusal is not a lesson bug.
        }
      },
    },

    publish(state: TutorialUiState | null): void {
      // The one snapshot key refreshSnapshot never touches (session.ts):
      // zustand merges shallowly, so this write and the session's writes
      // interleave without either clobbering the other.
      const previous = lastPublished
      lastPublished = state
      session.store.setState({ tutorial: state })

      // The rail's changes, SPOKEN — through session.announce, the same
      // one voice every builder event uses, so a screen-reader student
      // hears the rail move without a second competing live region. The
      // diff against the previously published state decides what (at most
      // one thing) to say; the checks are ordered so a single publish
      // speaks its most important change: done beats the step walk that
      // reached it, a step change resets hints so the two never compete.
      if (state === null) return // the rail emptied (dispose): nothing to narrate
      if (previous === null || previous.lessonId !== state.lessonId) {
        // The very FIRST publish after a start — a fresh host, a lesson
        // switch, or a dispose→start cycle: the rail rendering is its own
        // announcement, and a resume must not speak (the student did not
        // just DO anything; they arrived).
        return
      }
      if (state.done) {
        if (!previous.done) session.announce(`lesson complete: ${state.title}`)
        return
      }
      if (state.stepIndex !== previous.stepIndex || state.stepId !== previous.stepId) {
        session.announce(`step ${state.stepIndex + 1} of ${state.stepCount}: ${state.stepTitle}`)
        return
      }
      // Hints only ever GROW within a step (reset zeroes them by changing
      // nothing else — collapsing is silent on purpose: nothing new to say).
      const newlyRevealed = state.hints.length > previous.hints.length ? state.hints[state.hints.length - 1] : undefined
      if (newlyRevealed !== undefined) session.announce(`hint: ${newlyRevealed}`)
    },
  }
}
