import tseslint from 'typescript-eslint'

// Determinism bans — docs/DECISIONS.md D6.
// Engine code may never read the wall clock or unseeded randomness: replay, tutorial
// validation, and screenshot tests all depend on "same inputs → same world, forever".
const determinismBans = [
  {
    object: 'Date',
    property: 'now',
    message:
      'Wall-clock reads are banned in engine code — time is fed in explicitly (see Clock). docs/DECISIONS.md D6.',
  },
  {
    object: 'Math',
    property: 'random',
    message: 'Unseeded randomness is banned — use createRng from @engine/math. docs/DECISIONS.md D6.',
  },
]

// Trig is routed through @engine/math's Scalar wrappers so a deterministic-approximation
// upgrade path exists if cross-device replay is ever needed.
const trigBans = ['sin', 'cos', 'tan', 'atan2', 'atan', 'asin', 'acos'].map((fn) => ({
  object: 'Math',
  property: fn,
  message: `Math.${fn} is banned outside @engine/math — use the Scalar wrappers. docs/DECISIONS.md D6.`,
}))

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...determinismBans, ...trigBans],
    },
  },
  {
    // @engine/math implements the wrappers, so raw trig is allowed here — and only here.
    files: ['packages/math/src/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...determinismBans],
    },
  },
)
