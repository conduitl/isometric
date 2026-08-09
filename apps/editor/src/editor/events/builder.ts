/**
 * The builder.* vocabulary — a SHIM since the Phase 3 freeze.
 *
 * The vocabulary froze at Phase 3 and moved to @engine/tutorial
 * (docs/DECISIONS.md D4): from the freeze on, the tutorial engine and the
 * lesson content both key on these types, which makes them engine surface —
 * and apps depend on packages, never the reverse. This shim keeps the app's
 * import sites stable: everything in the editor keeps importing
 * './events/builder', and gets the one frozen copy.
 *
 * Deliberately narrow: exactly the names the editor uses, EVENTS ONLY — the
 * lesson schema (Lesson, StepPredicate, …) is @engine/tutorial surface that
 * app code imports from the package directly, never through this shim. The
 * governance tripwire over the frozen copy lives in
 * packages/tutorial/test/freeze.test.ts.
 */

export { BUILDER_EVENT_ALIASES, createBuilderEmitter } from '@engine/tutorial'
export type { BuilderEvent, BuilderEventType, TilePaintedEvent } from '@engine/tutorial'
