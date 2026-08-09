/**
 * The events/builder SHIM, pinned. Since the Phase 3 freeze the vocabulary
 * lives in @engine/tutorial; the app keeps a thin re-export at
 * src/editor/events/builder so its import sites stay stable. This test is
 * the only app-specific fact left to assert: the shim hands out THE SAME
 * objects as the package — one emitter factory, one alias table, one
 * vocabulary. (Emitter behavior and freeze governance are package coverage
 * now: packages/tutorial/test/freeze.test.ts.)
 */

import { describe, expect, it } from 'vitest'
import { BUILDER_EVENT_ALIASES as tutorialAliases, createBuilderEmitter as tutorialCreate } from '@engine/tutorial'
import type { BuilderEvent as TutorialBuilderEvent } from '@engine/tutorial'
import { BUILDER_EVENT_ALIASES, createBuilderEmitter } from '../src/editor/events/builder'
import type { BuilderEvent } from '../src/editor/events/builder'

describe('the events/builder shim', () => {
  it('re-exports the frozen package values by identity — no app-side copy', () => {
    expect(createBuilderEmitter).toBe(tutorialCreate)
    expect(BUILDER_EVENT_ALIASES).toBe(tutorialAliases)
  })

  it('re-exports the frozen types, not lookalikes (compile-time check made visible)', () => {
    // Mutual assignability: each union accepts the other's values. If the
    // shim ever grew a local BuilderEvent again, one of these lines would
    // stop compiling.
    const fromShim: BuilderEvent = { type: 'builder.world-saved', worldId: 'w7' }
    const toTutorial: TutorialBuilderEvent = fromShim
    const backToShim: BuilderEvent = toTutorial
    expect(backToShim).toBe(fromShim)
  })
})
