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

// UI frameworks never sink below the app layer — docs/ARCHITECTURE.md §6/§10. React (and its
// state companions) live only in @app/editor's ui/ modules; the engine packages and even the
// editor's own framework-free core must stay importable without any of them. Pattern groups
// ('react' AND 'react/*'), not exact names — an exact-name list misses subpath entry points
// like 'react-dom/client', and each package ships several.
const uiFrameworkBans = ['react', 'react-dom', 'zustand', 'immer'].map((name) => ({
  group: [name, `${name}/*`],
  message: `'${name}' never sinks below @app/editor — the engine stays framework-free (ARCHITECTURE §6).`,
}))

// The editor's framework-free core (src/editor/**) may use zustand's vanilla store and Immer —
// they are quarantined inside @app/editor — but React itself only above, in src/ui/** and main.tsx.
const reactOnlyBans = ['react', 'react-dom'].map((name) => ({
  group: [name, `${name}/*`],
  message: `'${name}' is only allowed in apps/editor/src/ui/** and main.tsx — the editor core stays React-free (ARCHITECTURE §6).`,
}))

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.astro/**', '**/.vitest-attachments/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}', 'content/*/src/**/*.ts'],
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
  {
    files: ['packages/*/src/**/*.ts', 'content/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: uiFrameworkBans }],
    },
  },
  {
    // *.{ts,tsx}: a stray .tsx below editor/ must not dodge the ban — the
    // extension IS the tell that React is leaking into the core.
    files: ['apps/editor/src/editor/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: reactOnlyBans }],
    },
  },
)
