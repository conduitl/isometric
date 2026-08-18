/**
 * @engine/tutorial — the lesson-as-data engine.
 *
 * Reading order: events.ts (the FROZEN builder.* vocabulary — D4), types.ts
 * (the lesson schema and the no-UI-predicates rule), machine.ts (the
 * resumable step machine), validate.ts (author-facing lesson validation),
 * replay.ts (the harness that keeps shipped lessons working forever).
 */

export type {
  BuilderEvent,
  BuilderEventType,
  BuilderEmitter,
  ViewProjectionName,
  TilePaintedEvent,
  EntityPlacedEvent,
  EntityMovedEvent,
  EntityRenamedEvent,
  EntityDeletedEvent,
  SelectionChangedEvent,
  CommandUndoneEvent,
  CommandRedoneEvent,
  WorldSavedEvent,
  WorldLoadedEvent,
  WorldRenamedEvent,
  ViewProjectionChangedEvent,
} from './events'
export {
  BUILDER_EVENT_TYPES,
  BUILDER_EVENT_ALIASES,
  BUILDER_EVENT_PAYLOAD_FIELDS,
  BUILDER_EVENT_HISTORY,
  isBuilderEventType,
  resolveBuilderEventType,
  createBuilderEmitter,
} from './events'

export type {
  EventFieldMatch,
  StepPredicate,
  OverlayPoint,
  LensOverlaySpec,
  StepEffect,
  StepTarget,
  StepFigure,
  LessonStep,
  Lesson,
  TutorialProgress,
  ProgressStore,
  TutorialUiState,
  TutorialHost,
  TutorialEngine,
  LessonProblem,
} from './types'

export type { EventPredicate, WorldPredicate } from './predicates'
export {
  evaluateWorldPredicate,
  isEventPredicate,
  isWorldPredicate,
  matchEventPredicate,
} from './predicates'

export { createTutorialEngine } from './machine'

export { validateLessons } from './validate'

export type { ReplayAction, ReplayHost, ReplayResult } from './replay'
export { replayLesson } from './replay'
