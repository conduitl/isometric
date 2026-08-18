export const meta = {
  name: 'ux-design',
  description: 'UX design pass: independent concepts from distinct stances, adversarial critique, one synthesized spec',
  whenToUse: 'Designing the UX for one part of the product. args: { problem (required), context (current-state brief; omit to auto-scout), files (paths agents may read), stances (optional override) }',
  phases: [
    { title: 'Scout', detail: 'map the current UX — skipped when a context brief is passed in', model: 'haiku' },
    { title: 'Diverge', detail: 'one independent design concept per stance' },
    { title: 'Critique', detail: 'adversarial feasibility check per concept', model: 'sonnet' },
    { title: 'Synthesize', detail: 'pick the winner, graft the rest, write the implementation-ready spec' },
  ],
}

if (!args || !args.problem) throw new Error('ux-design requires args.problem — a plain-language statement of the UX problem')
const problem = args.problem
const files = args.files || []
const fileList = files.length > 0 ? files.map((f) => '- ' + f).join('\n') : '(none listed)'

// Three stances chosen to force real divergence AND a cost spread (L/M/S),
// so synthesis can prefer the cheapest concept that fully solves the problem.
const STANCES = args.stances || [
  {
    key: 'structural',
    brief:
      'Restructure the layout itself so the subject of the problem becomes a primary surface: reshape the frame (grid areas, columns, panel order and grouping, dedicated regions). Accept a larger implementation cost when the payoff is decisive. Do NOT propose floating/draggable panels or new dependencies.',
  },
  {
    key: 'modal',
    brief:
      'Keep the frame structure as-is; design a MODE: progressive disclosure, focus/expanded states, collapsing neighbors, temporary takeover surfaces. Optimize for maximal effect while the mode is active, minimal structural change, and a crisp enter/exit (including the keyboard path).',
  },
  {
    key: 'wayfinding',
    brief:
      'Keep the subject roughly where it is; solve the problem with signposting, entry points, visual hierarchy, typography, and spacing. Optimize for the cheapest set of changes that still FULLY solves the stated problem.',
  },
]

const BRIEF_SCHEMA = {
  type: 'object',
  required: ['brief'],
  properties: {
    brief: {
      type: 'string',
      description:
        'Under 700 words. Facts only, no solutions: product purpose and audience; the exact current UI structure around the problem (containers, dimensions, type sizes, ordering); how a user reaches the thing today; hard constraints found in code/docs (layout decisions, a11y contracts, keyboard requirements, tests that pin behavior).',
    },
  },
}

const CONCEPT_SCHEMA = {
  type: 'object',
  required: ['name', 'summary', 'layout_change', 'discoverability', 'reading_comfort', 'interaction', 'cost', 'risks'],
  properties: {
    name: { type: 'string', description: 'Short memorable concept name' },
    summary: { type: 'string', description: 'The concept in under 60 words' },
    layout_change: {
      type: 'string',
      description: 'Under 150 words. The concrete structural/DOM/CSS change: real panel names, grid areas, dimensions (px/ch/fr).',
    },
    discoverability: { type: 'string', description: 'Under 100 words. How a first-time user now finds the subject.' },
    reading_comfort: {
      type: 'string',
      description: 'Under 100 words. How reading becomes comfortable — concrete type sizes, measure (ch), spacing.',
    },
    interaction: {
      type: 'string',
      description: 'Under 100 words. Keyboard path and screen-reader experience for everything added, moved, or hidden.',
    },
    cost: { type: 'string', enum: ['S', 'M', 'L'], description: 'Implementation cost' },
    risks: { type: 'array', items: { type: 'string' }, description: 'Each under 25 words' },
  },
}

const CRITIQUE_SCHEMA = {
  type: 'object',
  required: ['verdict', 'solves_problem', 'gaps', 'constraint_violations', 'feasibility_notes', 'strengths', 'fixes'],
  properties: {
    verdict: { type: 'string', enum: ['strong', 'workable', 'flawed'] },
    solves_problem: { type: 'string', enum: ['fully', 'partly', 'no'], description: 'Against EVERY part of the stated problem' },
    gaps: { type: 'array', items: { type: 'string' }, description: 'Parts of the problem left unsolved; empty if none' },
    constraint_violations: { type: 'array', items: { type: 'string' }, description: 'Brief constraints the concept breaks; empty if none' },
    feasibility_notes: { type: 'string', description: 'Under 120 words. The concept\'s claims checked against the REAL code/CSS you read.' },
    strengths: { type: 'array', items: { type: 'string' }, description: 'Ideas worth keeping even if the concept loses' },
    fixes: { type: 'array', items: { type: 'string' }, description: 'Cheapest repairs for the weaknesses found' },
  },
}

const SPEC_SCHEMA = {
  type: 'object',
  required: ['winner', 'rationale', 'grafts', 'spec_markdown', 'implementation_steps', 'open_questions'],
  properties: {
    winner: { type: 'string', description: 'Name of the winning concept' },
    rationale: { type: 'string', description: 'Under 120 words: why this one, why not the others' },
    grafts: { type: 'array', items: { type: 'string' }, description: 'Ideas adopted from the losing concepts' },
    spec_markdown: {
      type: 'string',
      description:
        'The implementation-ready design spec in markdown: overview; exact layout/DOM/CSS changes (real grid areas, dimensions, type sizes); entry points and signposting; enter/exit of any modes; keyboard + a11y treatment honoring every contract in the brief; rejected directions (one line each, why); test and contract impact.',
    },
    implementation_steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ordered; each independently shippable where possible; name the files and tests each touches',
    },
    open_questions: { type: 'array', items: { type: 'string' }, description: 'Decisions genuinely left to the product owner' },
  },
}

// ---------------------------------------------------------------- Scout
// Cheap and skippable: when the orchestrator already scouted inline, the
// brief arrives via args.context and no agent runs.
let brief = args.context || null
if (brief === null) {
  log('No context brief supplied — scouting the current UX first')
  const scouted = await agent(
    [
      'You are a UX scout. Map the CURRENT user experience relevant to the problem below by reading code and docs. Facts only — no solutions, no opinions. Your final text is parsed data, not prose for a human.',
      '',
      '## The problem under investigation',
      problem,
      '',
      '## Start from these files (follow only what they directly reference)',
      fileList,
      '',
      'Report: product purpose and audience; the exact current UI structure around the problem (layout containers, dimensions, type sizes, panel/element ordering); how a user currently reaches the thing in question; hard constraints (layout decisions, a11y contracts, keyboard requirements, tests that pin behavior).',
    ].join('\n'),
    { label: 'scout', phase: 'Scout', model: 'haiku', effort: 'low', schema: BRIEF_SCHEMA },
  )
  if (!scouted) throw new Error('scout failed — re-run with args.context supplied by the orchestrator')
  brief = scouted.brief
} else {
  log('Context brief supplied by the orchestrator — Scout phase skipped')
}

// ------------------------------------------------- Diverge → Critique
// pipeline: each concept goes to its critic the moment it lands; lanes
// never wait on each other. Designers run on the session model (quality-
// critical divergence); critics run on sonnet (bounded checklist work
// grounded in the real files).
function designerPrompt(stance) {
  return [
    'You are a senior product designer producing ONE UX concept. Your final text is parsed data, not prose for a human.',
    '',
    '## Current-state brief (authoritative)',
    brief,
    '',
    '## The problem to solve',
    problem,
    '',
    '## Your assigned design stance — yours alone, commit to it',
    stance.brief,
    '',
    '## Rules',
    '- For grounding you may read ONLY these files:',
    fileList,
    '- Be concrete: name real panels/areas/files; give real values (px, ch, fr, font sizes); describe the keyboard path and screen-reader experience of anything you add, move, or hide.',
    '- Respect every constraint in the brief. No new dependencies.',
    '- Design for the stated audience without degrading efficiency for returning users.',
  ].join('\n')
}

function criticPrompt(concept, stance) {
  return [
    'You are an adversarial UX and feasibility critic. Try to BREAK the concept below before it ships. Your final text is parsed data, not prose for a human.',
    '',
    '## Current-state brief',
    brief,
    '',
    '## The problem it claims to solve',
    problem,
    '',
    '## The concept (stance: ' + stance.key + ')',
    JSON.stringify(concept, null, 2),
    '',
    '## Verify against reality',
    'Read these files and check the concept\'s layout and feasibility claims against the actual markup, CSS, and contracts:',
    fileList,
    '',
    '## Judge',
    '1. Does it FULLY solve the stated problem — every part of it?',
    '2. Does it violate any constraint in the brief (contracts, keyboard, a11y, no new deps, layout decisions)?',
    '3. Are its layout claims implementable as described in the real code?',
    '4. Does it fit the audience without degrading the tool for returning users?',
    '5. Hidden costs: tests, contracts, complexity.',
    "Default to skepticism; verdict 'strong' only if you genuinely failed to break it.",
  ].join('\n')
}

const reviewed = (
  await pipeline(
    STANCES,
    (stance) =>
      agent(designerPrompt(stance), {
        label: 'design:' + stance.key,
        phase: 'Diverge',
        effort: 'high',
        schema: CONCEPT_SCHEMA,
      }),
    (concept, stance) => {
      if (!concept) return null
      return agent(criticPrompt(concept, stance), {
        label: 'critique:' + stance.key,
        phase: 'Critique',
        model: 'sonnet',
        effort: 'medium',
        schema: CRITIQUE_SCHEMA,
      }).then((critique) => ({ stance: stance.key, concept, critique }))
    },
  )
).filter(Boolean)

if (reviewed.length === 0) throw new Error('every design lane failed — nothing to synthesize')
if (reviewed.length < STANCES.length) log(STANCES.length - reviewed.length + ' design lane(s) failed and were dropped')

// ------------------------------------------------------------ Synthesize
const spec = await agent(
  [
    'You are the design lead making the final call. Below are independent UX concepts, each with an adversarial critique verified against the real code. Your final text is parsed data, not prose for a human.',
    '',
    '## Current-state brief',
    brief,
    '',
    '## The problem',
    problem,
    '',
    '## Concepts and critiques',
    JSON.stringify(reviewed, null, 2),
    '',
    '## Your job',
    '- Pick ONE winner. The cheapest concept that FULLY solves the problem beats a grander one that solves it equally well. A critique-confirmed constraint violation disqualifies unless you specify the exact repair.',
    '- Graft compatible strong ideas from the losing concepts (list them in grafts).',
    '- Write spec_markdown as an implementation-ready design spec per the schema. Where a critique corrected a concept, the spec carries the corrected version.',
    '- You may spot-check these files:',
    fileList,
  ].join('\n'),
  { label: 'synthesize', phase: 'Synthesize', effort: 'high', schema: SPEC_SCHEMA },
)

return { brief: args.context ? '(supplied via args.context)' : brief, lanes: reviewed, spec }
