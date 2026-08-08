/*
 * The Component Registry — the world's column dictionary.
 *
 * world.ts lets any entity carry any component under any name; nothing there
 * knows what a "position" is supposed to look like. The registry is where
 * that knowledge lives: each component KIND registers a definition saying
 * what a fresh one contains, how to tell a broken one from a healthy one,
 * and what the numbers mean to a human.
 *
 * Three consumers read these definitions, and none of them is hypothetical:
 *
 * - The EDITOR's "add component" button calls `defaults()` to stamp out a
 *   fresh value, and builds its inspector panel (labels, units, tooltips)
 *   from `meta`.
 * - The LOADER calls `validate` on data arriving from files that students
 *   are actively encouraged to hand-edit — so the message a validator
 *   returns must be something a 10-year-old can act on ("speed can't be
 *   negative — use direction to go the other way"), never validator jargon.
 * - SCREEN READERS get their labels from the same `meta.unit` and
 *   `meta.description`, which is why the metadata exists from day one
 *   instead of being retrofitted.
 *
 * Deliberately validator-agnostic: `validate` is just a function from value
 * to `null | problem-string`. The Zod library exists in this codebase, but it
 * is quarantined inside @engine/world-format (docs/DECISIONS.md R5) — no
 * schema-library type may leak into this seam, so the library stays
 * swappable and its error strings stay out of children's faces.
 */

/**
 * The definition of one component kind (one column of the spreadsheet).
 *
 * `defaults` is a FUNCTION returning a fresh value, not a value: if it were
 * a shared object, every entity given a default position would share one
 * position, and moving one would move them all — a classic aliasing bug,
 * dodged by construction.
 *
 * `validate` returns null when the value is fine, or a student-legible
 * sentence describing the problem. `meta.unit` and `meta.description` feed
 * inspector labels and screen-reader text.
 */
export interface ComponentDef {
  name: string
  defaults: () => unknown
  validate?: (value: unknown) => string | null
  meta?: { unit?: string; description?: string }
}

/**
 * The dictionary itself. `names()` lists registered kinds in registration
 * order — deterministic because plugin registration order is itself part of
 * an app's fixed startup sequence.
 */
export interface ComponentRegistry {
  register(def: ComponentDef): void
  get(name: string): ComponentDef | undefined
  has(name: string): boolean
  names(): string[]
}

/**
 * Build an empty registry. Registering the same name twice throws — two
 * plugins fighting over what "position" means is a real conflict, and a
 * silent last-writer-wins would corrupt every world using the earlier shape.
 * Failing loudly at startup is the kind version of that error.
 */
export function createRegistry(): ComponentRegistry {
  const defs = new Map<string, ComponentDef>()

  return {
    register(def: ComponentDef): void {
      if (defs.has(def.name)) {
        throw new Error(
          `A component named '${def.name}' is already registered — two definitions ` +
            `for one name would fight over what that component means. Pick a different name.`,
        )
      }
      defs.set(def.name, def)
    },

    get(name: string): ComponentDef | undefined {
      return defs.get(name)
    },

    has(name: string): boolean {
      return defs.has(name)
    },

    names(): string[] {
      return [...defs.keys()]
    },
  }
}
