/**
 * #1957 — refuse an unknown relation target instead of guessing an import path.
 *
 * WHY. `database-queries.ts` resolves a field's `refTarget` against the app's collections and,
 * when the lookup misses, falls through to
 *   `// Same-layer sibling (or unknown — fall back to existing behavior)`
 * emitting `import * as XSchema from '../../../x/server/database/schema'` regardless. No
 * warning, exit 0. On the #1825 chores POC that produced an import to a `users` collection
 * nobody created, and the failure surfaced minutes later as
 *   `Cannot resolve "../../../users/server/database/schema" … and externals are not allowed!`
 * after ~400 lines of module paths naming neither the schema, the field, nor `refTarget`.
 *
 * The generator holds the full collection map at that moment. This turns a silent guess into a
 * local, readable refusal — one `if` earlier and minutes sooner.
 *
 * Deliberately runs BEFORE any file is written, so a rejected generate leaves nothing behind.
 *
 * ⚠️ NAMING: `refTarget` names the generated DIRECTORY, which is the PLURAL of the configured
 * collection name — `apps/velo` configures `location` and its schema correctly says
 * `refTarget: "locations"`. `collectionLayerMap` is keyed by the CONFIG name, so a naive
 * `map.has(refTarget)` rejects that valid schema. The caller therefore passes an EXPANDED set
 * holding both forms. (This is also why the generator's "unknown" fallback silently worked for
 * years: every plural target missed the map and landed in the branch that happens to emit the
 * right path.) Caught by scanning every schema in the repo before shipping this check.
 */

/** A field as `load-fields` yields it — only the parts this check needs. */
export interface RefTargetField {
  name: string
  type?: string
  refTarget?: string
  refScope?: string
}

/**
 * `refScope` values that mean "this target is NOT a generated collection". `database-queries.ts`
 * routes these away from the collection-directory import entirely — external refs import from the
 * app barrel (`~~/server/db/schema`), which is where package-owned tables like the auth `user`
 * live. `collectionLayerMap` therefore has nothing to say about them, and checking one against it
 * only ever produces a false refusal.
 */
const EXTERNAL_SCOPES = new Set(['external', 'adapter'])

export interface UnresolvedRef {
  field: string
  target: string
}

export class RefTargetError extends Error {
  readonly unresolved: UnresolvedRef[]
  constructor(message: string, unresolved: UnresolvedRef[]) {
    super(message)
    this.name = 'RefTargetError'
    this.unresolved = unresolved
  }
}

/**
 * Targets that mean "a person". These are NOT typos — the author wants to point at a team member,
 * and no *collection* will ever be called this. There IS a route: the auth `user` table is
 * re-exported into every app's `server/db/schema.ts`, and `refScope: "external"` +
 * `refTarget: "users"` makes the generator emit `import { user } from '~~/server/db/schema'` with
 * an aliased join — exactly what the built-in `owner`/`createdBy`/`updatedBy` refs already do.
 * The message must name that escape hatch, or the author is left renaming a collection that was
 * never going to exist. (Only `users` is wired; the other spellings need renaming first.)
 */
const PERSON_TARGETS = new Set(['user', 'users', 'person', 'people', 'member', 'members', 'account', 'accounts'])

/**
 * Throw if any field references a collection the generator does not know about.
 *
 * @param fields          the collection's fields
 * @param knownTargets    every acceptable target name, lowercased — BOTH the configured
 *                        collection name and its plural directory form (see the NAMING note)
 * @param collectionName  the collection being generated, for the message
 *
 * No-ops when the set is EMPTY: that means no config/targets were supplied, so nothing is known
 * and nothing can be verified. Refusing every relation there would break generation paths that
 * never had a map to begin with — absence of the map is not evidence of a bad target.
 */
export function validateRefTargets(
  fields: RefTargetField[],
  knownTargets: Set<string>,
  collectionName: string,
): void {
  if (!knownTargets || knownTargets.size === 0) return

  const unresolved: UnresolvedRef[] = []
  for (const f of fields || []) {
    const target = f?.refTarget
    if (!target) continue
    // An external ref never resolves against the collection map — it imports from the app barrel.
    // Refusing it here would block the one working way to reference a package-owned table.
    if (f.refScope && EXTERNAL_SCOPES.has(String(f.refScope).toLowerCase())) continue
    if (knownTargets.has(String(target).toLowerCase())) continue
    unresolved.push({ field: f.name, target: String(target) })
  }
  if (unresolved.length === 0) return

  const known = [...knownTargets].sort()
  const lines = [
    `Cannot generate "${collectionName}": ${unresolved.length} field${unresolved.length === 1 ? '' : 's'} reference${unresolved.length === 1 ? 's' : ''} a collection that does not exist.`,
    '',
    ...unresolved.map((u) => `  • ${collectionName}.${u.field} → "${u.target}"  (no such collection)`),
    '',
    `  Collections available here: ${known.join(', ')}`,
  ]

  // A person-shaped target is not a misspelling — it's the wrong mechanism. Name the right one,
  // or the author burns time renaming something that was never going to be a collection.
  if (unresolved.some((u) => PERSON_TARGETS.has(u.target.toLowerCase()))) {
    lines.push(
      '',
      '  One of these looks like it means "a person". Users are not a generated collection — the',
      '  auth `user` table is re-exported into server/db/schema.ts, so reference it as an EXTERNAL',
      '  target instead:',
      '',
      '      "assigneeId": { "type": "string", "refTarget": "users", "refScope": "external" }',
      '',
      '  That emits an aliased join on the auth user table, the same way owner/createdBy already',
      '  work. Use exactly "users" — the other spellings have no table behind them. (A first-class',
      '  member picker in the generated Form/List is still open: #1958.)',
    )
  }

  lines.push(
    '',
    '  Nothing was written. Fix the target (or remove the field) and generate again.',
  )

  throw new RefTargetError(lines.join('\n'), unresolved)
}
