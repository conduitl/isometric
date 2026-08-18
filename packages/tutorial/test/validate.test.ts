import { describe, expect, it } from 'vitest'
import { BUILDER_EVENT_ALIASES } from '../src/events'
import type { BuilderEventType } from '../src/events'
import { validateLessons } from '../src/validate'
import type { Lesson, LessonProblem, LessonStep, StepEffect, StepPredicate, StepTarget } from '../src/types'

// A deliberately feature-dense VALID lesson: both predicate families, a
// nested (world-only) composition, every overlay kind, both effect kinds,
// every target kind, a fixture. Each negative test below breaks exactly one
// rule of a copy — so a failure names the rule, not the fixture.
const validLesson: Lesson = {
  id: 'first-tiles',
  title: 'First tiles',
  arc: 'coordinates',
  fixture: 'meadow',
  steps: [
    {
      id: 'paint-water',
      title: 'Paint water',
      instruction: 'Click cell (2, 3).',
      hints: ['Find the brush in the palette.'],
      target: { kind: 'cell', tx: 2, ty: 3 },
      onEnter: [
        { kind: 'set-view-projection', projection: 'topdown' },
        {
          kind: 'show-overlays',
          overlays: [
            { kind: 'cell-highlight', tx: 2, ty: 3, label: 'here' },
            { kind: 'entity-highlight', marker: 'player' },
            { kind: 'arrow', from: { x: 0, y: 0, z: 0 }, to: { marker: 'player' } },
            { kind: 'right-triangle', a: { marker: 'player' }, b: { x: 3, y: 4 } },
          ],
        },
      ],
      figures: [
        { kind: 'image', src: 'figures/axes.svg', alt: 'The x and y axes over a grid.', caption: 'Math-class axes.' },
        {
          kind: 'scene',
          fixture: 'meadow',
          projection: 'iso',
          overlays: [{ kind: 'right-triangle', a: { marker: 'player' }, b: { x: 3, y: 4 } }],
          alt: 'The meadow drawn through the iso matrix.',
        },
      ],
      completion: { kind: 'event', type: 'builder.tile-painted', where: { tile: 2, layerId: 'ground' } },
    },
    {
      id: 'find-the-brush',
      title: 'Meet the palette',
      instruction: 'Look at the highlighted panel.',
      hints: ['It glows.'],
      target: { kind: 'anchor', anchor: 'palette.tile-brush' },
      completion: { kind: 'event', type: 'builder.selection-changed' },
    },
    {
      id: 'check-distance',
      title: 'Check the distance',
      instruction: 'Drag the chest until it is 5 away.',
      hints: ['3 east, 4 north.', 'Pythagoras knew.'],
      target: { kind: 'entity', marker: 'chest' },
      onEnter: [{ kind: 'set-view-projection', projection: null }],
      completion: {
        kind: 'all',
        of: [
          { kind: 'entity-distance', markerA: 'player', markerB: 'chest', distance: 5, tolerance: 0.1 },
          { kind: 'tile-at', tx: 2, ty: 3, tile: 2, layerId: 'ground' },
          {
            kind: 'any',
            of: [
              { kind: 'entity-exists', marker: 'chest', atLeast: 1 },
              { kind: 'entity-at', marker: 'player', tx: 0, ty: 0 },
            ],
          },
        ],
      },
    },
  ],
}

function withSteps(steps: ReadonlyArray<LessonStep>, extra: Partial<Lesson> = {}): Lesson {
  return { ...validLesson, steps, ...extra }
}

function oneStep(patch: Partial<LessonStep>): Lesson {
  const base = validLesson.steps[0]
  if (base === undefined) throw new Error('fixture lost its steps')
  return withSteps([{ ...base, ...patch }])
}

function completionOf(predicate: StepPredicate): Lesson {
  return oneStep({ completion: predicate })
}

function texts(problems: LessonProblem[]): string[] {
  return problems.map((problem) => problem.problem)
}

describe('validateLessons: the valid baseline', () => {
  it('returns no problems for a feature-dense valid lesson', () => {
    expect(validateLessons([validLesson])).toEqual([])
  })

  it('returns no problems for an empty catalogue', () => {
    expect(validateLessons([])).toEqual([])
  })
})

describe('validateLessons: lesson-level rules', () => {
  it('flags duplicate lesson ids across the array, attributed to the second occurrence', () => {
    const problems = validateLessons([validLesson, { ...validLesson }])
    expect(texts(problems)).toContainEqual(expect.stringContaining('duplicate lesson id "first-tiles"'))
    expect(problems[0]?.stepId).toBeNull()
  })

  it.each(['MyLesson', 'my_lesson', '-leading', 'trailing-', 'double--dash', ''])(
    'rejects the non-kebab-case lesson id %j',
    (id) => {
      const problems = validateLessons([{ ...validLesson, id }])
      expect(texts(problems)).toContainEqual(expect.stringContaining('not kebab-case'))
    },
  )

  it('flags an empty title and an empty arc', () => {
    expect(texts(validateLessons([{ ...validLesson, title: '  ' }]))).toContainEqual(
      expect.stringContaining('title is empty'),
    )
    expect(texts(validateLessons([{ ...validLesson, arc: '' }]))).toContainEqual(
      expect.stringContaining('arc is empty'),
    )
  })

  it('flags an empty fixture id but accepts an absent one', () => {
    expect(texts(validateLessons([{ ...validLesson, fixture: ' ' }]))).toContainEqual(
      expect.stringContaining('fixture id is empty'),
    )
    const noFixture: Lesson = { ...validLesson }
    delete (noFixture as { fixture?: string }).fixture
    expect(validateLessons([noFixture])).toEqual([])
  })

  it('flags a lesson with no steps', () => {
    expect(texts(validateLessons([withSteps([])]))).toContainEqual(expect.stringContaining('no steps'))
  })
})

describe('validateLessons: step-level rules', () => {
  it('flags duplicate step ids within a lesson, attributed to the step', () => {
    const base = validLesson.steps[0]
    if (base === undefined) throw new Error('fixture lost its steps')
    const problems = validateLessons([withSteps([base, { ...base }])])
    expect(problems).toContainEqual(
      expect.objectContaining({
        lessonId: 'first-tiles',
        stepId: 'paint-water',
        problem: expect.stringContaining('duplicate step id'),
      }),
    )
  })

  it('rejects non-kebab-case step ids', () => {
    expect(texts(validateLessons([oneStep({ id: 'Paint_Water' })]))).toContainEqual(
      expect.stringContaining('not kebab-case'),
    )
  })

  it('flags empty step title and instruction', () => {
    expect(texts(validateLessons([oneStep({ title: '' })]))).toContainEqual(
      expect.stringContaining('step title is empty'),
    )
    expect(texts(validateLessons([oneStep({ instruction: '   ' })]))).toContainEqual(
      expect.stringContaining('instruction is empty'),
    )
  })

  it('demands at least one hint on EVERY step — the escape hatch is an exit criterion', () => {
    const problems = validateLessons([oneStep({ hints: [] })])
    expect(texts(problems)).toContainEqual(expect.stringContaining('no hints'))
  })

  it('flags blank hints', () => {
    expect(texts(validateLessons([oneStep({ hints: ['fine', '  '] })]))).toContainEqual(
      expect.stringContaining('hints[1] is empty'),
    )
  })

  it('checks targets: empty anchor, fractional cell, empty marker', () => {
    const anchor: StepTarget = { kind: 'anchor', anchor: ' ' }
    expect(texts(validateLessons([oneStep({ target: anchor })]))).toContainEqual(
      expect.stringContaining('anchor id is empty'),
    )
    const cell: StepTarget = { kind: 'cell', tx: 0.5, ty: 1 }
    expect(texts(validateLessons([oneStep({ target: cell })]))).toContainEqual(
      expect.stringContaining('must be integers'),
    )
    const entity: StepTarget = { kind: 'entity', marker: '' }
    expect(texts(validateLessons([oneStep({ target: entity })]))).toContainEqual(
      expect.stringContaining('marker must be a non-empty string'),
    )
  })
})

describe('validateLessons: effects and overlays', () => {
  it('rejects an unknown view projection (lesson data is JSON — membership is checked)', () => {
    const bogus = { kind: 'set-view-projection', projection: 'sideways' } as unknown as StepEffect
    expect(texts(validateLessons([oneStep({ onEnter: [bogus] })]))).toContainEqual(
      expect.stringContaining('unknown projection'),
    )
  })

  it('checks overlay endpoints: marker endpoints non-empty, fixed points finite', () => {
    const emptyMarkerArrow: StepEffect = {
      kind: 'show-overlays',
      overlays: [{ kind: 'arrow', from: { marker: '' }, to: { x: 1, y: 1 } }],
    }
    expect(texts(validateLessons([oneStep({ onEnter: [emptyMarkerArrow] })]))).toContainEqual(
      expect.stringContaining('marker endpoint must be a non-empty string'),
    )
    const emptyMarkerTriangle: StepEffect = {
      kind: 'show-overlays',
      overlays: [{ kind: 'right-triangle', a: { x: 0, y: 0 }, b: { marker: '  ' } }],
    }
    expect(texts(validateLessons([oneStep({ onEnter: [emptyMarkerTriangle] })]))).toContainEqual(
      expect.stringContaining('marker endpoint must be a non-empty string'),
    )
    const nanPoint: StepEffect = {
      kind: 'show-overlays',
      overlays: [{ kind: 'arrow', from: { x: Number.NaN, y: 0 }, to: { x: 1, y: 1 } }],
    }
    expect(texts(validateLessons([oneStep({ onEnter: [nanPoint] })]))).toContainEqual(
      expect.stringContaining('finite'),
    )
  })

  it('checks cell-highlight coordinates and entity-highlight markers', () => {
    const badCell: StepEffect = { kind: 'show-overlays', overlays: [{ kind: 'cell-highlight', tx: 1.5, ty: 0 }] }
    expect(texts(validateLessons([oneStep({ onEnter: [badCell] })]))).toContainEqual(
      expect.stringContaining('must be integers'),
    )
    const badEntity: StepEffect = { kind: 'show-overlays', overlays: [{ kind: 'entity-highlight', marker: '' }] }
    expect(texts(validateLessons([oneStep({ onEnter: [badEntity] })]))).toContainEqual(
      expect.stringContaining('marker must be a non-empty string'),
    )
  })
})

describe('validateLessons: completion predicates', () => {
  it('every event type must resolve through the frozen vocabulary (aliases legal)', () => {
    const problems = validateLessons([completionOf({ kind: 'event', type: 'builder.tile-clicked' })])
    expect(texts(problems)).toContainEqual(expect.stringContaining('not in the frozen builder.* vocabulary'))
    // A live vocabulary name resolves fine (the baseline already proves it;
    // the alias table is empty at the freeze, so aliases are untestable
    // until one exists — resolveBuilderEventType covers the path).
  })

  it('where values must be matchable scalars — a NaN can never be strictly equal to anything', () => {
    const problems = validateLessons([
      completionOf({ kind: 'event', type: 'builder.tile-painted', where: { tile: Number.NaN } }),
    ])
    expect(texts(problems)).toContainEqual(expect.stringContaining('where.tile'))
  })

  it('rejects where fields the resolved event payload does not carry, naming the field, the event, and its real fields', () => {
    // The matcher would silently never hit a field the event does not have
    // — a typo'd where is a step that can never complete, caught here.
    const problems = validateLessons([
      completionOf({ kind: 'event', type: 'builder.tile-painted', where: { worldId: 'w1' } }),
    ])
    expect(problems).toContainEqual(
      expect.objectContaining({
        lessonId: 'first-tiles',
        stepId: 'paint-water',
        problem: expect.stringContaining('completion: where.worldId is not a payload field of "builder.tile-painted"'),
      }),
    )
    // The author sees the real field list, not just a rejection.
    expect(texts(problems)).toContainEqual(expect.stringContaining('cells, layerId, tile, toolId, type'))
    // Legal fields pass (the feature-dense baseline already proves tile +
    // layerId; this pins a third event's field for good measure).
    expect(validateLessons([completionOf({ kind: 'event', type: 'builder.world-saved', where: { worldId: 'w1' } })])).toEqual([])
  })

  it('checks where fields against the RESOLVED type when the lesson names an alias', () => {
    // The alias table is empty at the freeze — inject one to prove the
    // field check follows resolution (same injection pattern as the freeze
    // governance test; cleaned up in finally).
    const aliases = BUILDER_EVENT_ALIASES as Record<string, BuilderEventType>
    aliases['builder.tiles-painted'] = 'builder.tile-painted'
    try {
      expect(
        validateLessons([completionOf({ kind: 'event', type: 'builder.tiles-painted', where: { tile: 2 } })]),
      ).toEqual([])
      const problems = validateLessons([
        completionOf({ kind: 'event', type: 'builder.tiles-painted', where: { worldId: 'w1' } }),
      ])
      // The message names the LIVE type — the vocabulary the field list
      // belongs to — not the alias the author typed.
      expect(texts(problems)).toContainEqual(
        expect.stringContaining('where.worldId is not a payload field of "builder.tile-painted"'),
      )
    } finally {
      delete aliases['builder.tiles-painted']
    }
  })

  it('does not pile a field problem onto an unknown event type — one unknown, one problem', () => {
    const problems = validateLessons([
      completionOf({ kind: 'event', type: 'builder.imaginary', where: { anything: 1 } }),
    ])
    expect(texts(problems)).toContainEqual(expect.stringContaining('not in the frozen builder.* vocabulary'))
    expect(texts(problems)).not.toContainEqual(expect.stringContaining('where.anything is not a payload field'))
  })

  it('accepts toCell on builder.entity-moved with whole-numbered coordinates', () => {
    expect(
      validateLessons([completionOf({ kind: 'event', type: 'builder.entity-moved', toCell: { tx: 3, ty: -2 } })]),
    ).toEqual([])
  })

  it('rejects toCell on any event other than builder.entity-moved — only a move has a destination', () => {
    const problems = validateLessons([
      completionOf({ kind: 'event', type: 'builder.tile-painted', toCell: { tx: 1, ty: 1 } }),
    ])
    expect(texts(problems)).toContainEqual(
      expect.stringContaining('toCell is only legal on builder.entity-moved'),
    )
  })

  it('rejects fractional toCell coordinates (cells are whole-numbered)', () => {
    const problems = validateLessons([
      completionOf({ kind: 'event', type: 'builder.entity-moved', toCell: { tx: 1.5, ty: 0 } }),
    ])
    expect(texts(problems)).toContainEqual(expect.stringContaining('toCell.tx/ty must be integers'))
  })

  it('tile-at needs integer coordinates and a sane tile value', () => {
    expect(texts(validateLessons([completionOf({ kind: 'tile-at', tx: 1.5, ty: 0 })]))).toContainEqual(
      expect.stringContaining('must be integers'),
    )
    expect(texts(validateLessons([completionOf({ kind: 'tile-at', tx: 1, ty: 0, tile: -1 })]))).toContainEqual(
      expect.stringContaining('non-negative integer'),
    )
    expect(texts(validateLessons([completionOf({ kind: 'tile-at', tx: 1, ty: 0, layerId: ' ' })]))).toContainEqual(
      expect.stringContaining('layerId is empty'),
    )
  })

  it('entity-exists needs a marker and atLeast >= 1', () => {
    expect(texts(validateLessons([completionOf({ kind: 'entity-exists', marker: '' })]))).toContainEqual(
      expect.stringContaining('marker must be a non-empty string'),
    )
    expect(
      texts(validateLessons([completionOf({ kind: 'entity-exists', marker: 'crate', atLeast: 0 })])),
    ).toContainEqual(expect.stringContaining('atLeast must be an integer >= 1'))
  })

  it('entity-at needs a marker and integer coordinates', () => {
    expect(
      texts(validateLessons([completionOf({ kind: 'entity-at', marker: '', tx: 0, ty: 0 })])),
    ).toContainEqual(expect.stringContaining('marker must be a non-empty string'))
    expect(
      texts(validateLessons([completionOf({ kind: 'entity-at', marker: 'crate', tx: 0, ty: Number.NaN })])),
    ).toContainEqual(expect.stringContaining('must be integers'))
  })

  it('entity-distance needs non-empty markers, distance > 0, tolerance >= 0', () => {
    const base = { kind: 'entity-distance', markerA: 'a', markerB: 'b', distance: 5 } as const
    expect(texts(validateLessons([completionOf({ ...base, markerB: ' ' })]))).toContainEqual(
      expect.stringContaining('markerB must be a non-empty string'),
    )
    expect(texts(validateLessons([completionOf({ ...base, distance: 0 })]))).toContainEqual(
      expect.stringContaining('distance must be a finite number > 0'),
    )
    expect(texts(validateLessons([completionOf({ ...base, distance: Number.POSITIVE_INFINITY })]))).toContainEqual(
      expect.stringContaining('distance must be a finite number > 0'),
    )
    expect(texts(validateLessons([completionOf({ ...base, tolerance: -0.1 })]))).toContainEqual(
      expect.stringContaining('tolerance must be a finite number >= 0'),
    )
  })

  it('flags entity-distance measuring a marker against itself — always distance 0, never satisfiable', () => {
    const problems = validateLessons([
      completionOf({ kind: 'entity-distance', markerA: 'crate', markerB: 'crate', distance: 5 }),
    ])
    expect(texts(problems)).toContainEqual(
      expect.stringContaining('markerA and markerB are both "crate"'),
    )
    // Two blank markers already earn their two non-emptiness problems — the
    // same-marker rule stays quiet rather than piling on a third.
    const blankProblems = texts(
      validateLessons([completionOf({ kind: 'entity-distance', markerA: '', markerB: '', distance: 5 })]),
    )
    expect(blankProblems).not.toContainEqual(expect.stringContaining('markerA and markerB are both'))
  })

  it('compositions must be non-empty', () => {
    expect(texts(validateLessons([completionOf({ kind: 'all', of: [] })]))).toContainEqual(
      expect.stringContaining("'all' composition is empty"),
    )
    expect(texts(validateLessons([completionOf({ kind: 'any', of: [] })]))).toContainEqual(
      expect.stringContaining("'any' composition is empty"),
    )
  })

  it('forbids event leaves inside compositions — top-level events are fine, nested ones are not', () => {
    const nested: StepPredicate = {
      kind: 'any',
      of: [
        { kind: 'tile-at', tx: 0, ty: 0 },
        { kind: 'all', of: [{ kind: 'event', type: 'builder.world-saved' }] },
      ],
    }
    const problems = validateLessons([completionOf(nested)])
    expect(texts(problems)).toContainEqual(expect.stringContaining('may not appear inside all/any'))
    expect(problems[0]?.problem).toContain('completion.of[1].of[0]') // the path names the leaf
  })

  it('recurses into compositions and validates the leaves', () => {
    const bad: StepPredicate = { kind: 'all', of: [{ kind: 'tile-at', tx: 0.5, ty: 0 }] }
    expect(texts(validateLessons([completionOf(bad)]))).toContainEqual(expect.stringContaining('must be integers'))
  })
})

describe('validateLessons: reporting', () => {
  it('accumulates every problem across lessons and steps, each attributed correctly', () => {
    const brokenStep: LessonStep = {
      id: 'Broken Step',
      title: '',
      instruction: '',
      hints: [],
      completion: { kind: 'event', type: 'builder.imaginary' },
    }
    const brokenLesson: Lesson = { id: 'BAD', title: ' ', arc: '', steps: [brokenStep] }
    const problems = validateLessons([validLesson, brokenLesson])

    const lessonLevel = problems.filter((problem) => problem.lessonId === 'BAD' && problem.stepId === null)
    const stepLevel = problems.filter((problem) => problem.stepId === 'Broken Step')
    expect(lessonLevel.length).toBeGreaterThanOrEqual(3) // id, title, arc
    expect(stepLevel.length).toBeGreaterThanOrEqual(5) // id, title, instruction, hints, event type
    expect(problems.filter((problem) => problem.lessonId === 'first-tiles')).toEqual([])
  })
})

describe('validateLessons: figure rules', () => {
  const withFigures = (figures: LessonStep['figures']): Lesson => oneStep({ figures })

  it('flags an image figure with an empty src', () => {
    const problems = validateLessons([withFigures([{ kind: 'image', src: ' ', alt: 'A picture.' }])])
    expect(texts(problems)).toContainEqual(expect.stringContaining('figures[0]: src is empty'))
  })

  it('flags any figure with empty alt text — the screen-reader floor', () => {
    for (const figures of [
      [{ kind: 'image', src: 'figures/axes.svg', alt: '  ' }] as const,
      [{ kind: 'scene', fixture: 'meadow', projection: 'topdown', alt: '' }] as const,
    ]) {
      expect(texts(validateLessons([withFigures(figures)]))).toContainEqual(
        expect.stringContaining('alt text is empty'),
      )
    }
  })

  it('flags a scene figure with an empty fixture id', () => {
    const problems = validateLessons([
      withFigures([{ kind: 'scene', fixture: '', projection: 'iso', alt: 'A scene.' }]),
    ])
    expect(texts(problems)).toContainEqual(expect.stringContaining('figures[0]: fixture id is empty'))
  })

  it('rejects a scene projection outside profile | topdown | iso', () => {
    const figure = { kind: 'scene', fixture: 'meadow', projection: 'oblique', alt: 'A scene.' }
    const problems = validateLessons([withFigures([figure as unknown as NonNullable<LessonStep['figures']>[number]])])
    expect(texts(problems)).toContainEqual(expect.stringContaining('unknown projection "oblique"'))
  })

  it('recurses into scene overlays with an attributed path', () => {
    const problems = validateLessons([
      withFigures([
        {
          kind: 'scene',
          fixture: 'meadow',
          projection: 'topdown',
          overlays: [{ kind: 'cell-highlight', tx: 1.5, ty: 0 }],
          alt: 'A scene.',
        },
      ]),
    ])
    expect(texts(problems)).toContainEqual(expect.stringContaining('figures[0].overlays[0]'))
  })

  it('flags a blank caption but accepts an absent one', () => {
    expect(
      texts(validateLessons([withFigures([{ kind: 'image', src: 'a.svg', alt: 'A picture.', caption: ' ' }])])),
    ).toContainEqual(expect.stringContaining('caption is empty'))
    expect(validateLessons([withFigures([{ kind: 'image', src: 'a.svg', alt: 'A picture.' }])])).toEqual([])
  })

  it('rejects an unknown figure kind arriving as raw JSON', () => {
    const figure = { kind: 'video', src: 'a.mp4', alt: 'A clip.' }
    const problems = validateLessons([withFigures([figure as unknown as NonNullable<LessonStep['figures']>[number]])])
    expect(texts(problems)).toContainEqual(expect.stringContaining('unknown figure kind "video"'))
  })
})
