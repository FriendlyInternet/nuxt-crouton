/**
 * #1957 — the generator must REFUSE an unknown relation target, not guess an import path.
 *
 * The case that minted it (#1825 chores POC): a field carried `refTarget: "users"`, no `users`
 * collection existed, and `database-queries.ts` fell through to
 *   `// Same-layer sibling (or unknown — fall back to existing behavior)`
 * emitting `import * as usersSchema from '../../../users/server/database/schema'`. Nothing
 * checked it. The build died minutes later on an unresolvable module, after ~400 lines of
 * paths naming neither the schema, the field, nor `refTarget`.
 *
 * The generator holds the full collection map at that moment — it is one check away from
 * saying so. This is that check.
 */
import { describe, it, expect } from 'vitest'
import pluralize from 'pluralize'
import { validateRefTargets, RefTargetError } from '../../../lib/utils/validate-ref-targets'

// Mirrors buildKnownRefTargets: BOTH the config name and its plural directory form.
const known = (...names: string[]) =>
  new Set(names.flatMap((n) => [n.toLowerCase(), pluralize(n).toLowerCase()]))

describe('validateRefTargets', () => {
  it('accepts fields whose targets all exist (case-insensitively)', () => {
    const fields = [
      { name: 'title', type: 'string' },
      { name: 'authorId', type: 'string', refTarget: 'authors' },
      { name: 'tagId', type: 'string', refTarget: 'Tags' },
    ]
    expect(() => validateRefTargets(fields, known('authors', 'tags'), 'posts')).not.toThrow()
  })

  it('accepts a schema with no relations at all', () => {
    expect(() => validateRefTargets([{ name: 'title', type: 'string' }], known(), 'posts')).not.toThrow()
  })

  // ── the #1825 case ────────────────────────────────────────────────────────────
  it('THROWS on a target that does not exist, naming collection, field and target', () => {
    const fields = [
      { name: 'name', type: 'string' },
      { name: 'assigneeId', type: 'string', refTarget: 'users' },
    ]
    let err: RefTargetError | undefined
    try {
      validateRefTargets(fields, known('chores'), 'chores')
    } catch (e) {
      err = e as RefTargetError
    }
    expect(err).toBeInstanceOf(RefTargetError)
    // the message has to carry everything the build error did not
    expect(err!.message).toContain('chores.assigneeId')
    expect(err!.message).toContain('users')
    expect(err!.message).toContain('chores')          // the collections that DO exist
    expect(err!.unresolved).toEqual([{ field: 'assigneeId', target: 'users' }])
  })

  it('reports EVERY bad target at once, not just the first', () => {
    const fields = [
      { name: 'assigneeId', type: 'string', refTarget: 'users' },
      { name: 'lastDoneById', type: 'string', refTarget: 'people' },
      { name: 'roomId', type: 'string', refTarget: 'rooms' },
    ]
    let err: RefTargetError | undefined
    try {
      validateRefTargets(fields, known('rooms'), 'chores')
    } catch (e) {
      err = e as RefTargetError
    }
    // fixing them one build at a time is the slow path this exists to avoid
    expect(err!.unresolved).toEqual([
      { field: 'assigneeId', target: 'users' },
      { field: 'lastDoneById', target: 'people' },
    ])
  })

  it('points a person-shaped target at the external-ref escape hatch, not a dead end', () => {
    // `user`/`users`/`people`/`members` are a real want that DOES have a mechanism — the message
    // must hand over `refScope: "external"`, not imply the author typo'd a collection name.
    for (const target of ['user', 'users', 'People', 'members']) {
      let err: RefTargetError | undefined
      try {
        validateRefTargets([{ name: 'ownerId', type: 'string', refTarget: target }], known('chores'), 'chores')
      } catch (e) {
        err = e as RefTargetError
      }
      expect(err!.message, `for target "${target}"`).toContain('"refScope": "external"')
    }
  })

  it('does not mistake a non-person unknown target for the person case', () => {
    let err: RefTargetError | undefined
    try {
      validateRefTargets([{ name: 'roomId', type: 'string', refTarget: 'rooms' }], known('chores'), 'chores')
    } catch (e) {
      err = e as RefTargetError
    }
    expect(err!.message).not.toContain('#1958')
  })

  it('tolerates an empty collection map without inventing a failure', () => {
    // no config/targets → nothing is known, so nothing can be verified. Refusing every relation
    // here would break generation paths that never had a map to begin with.
    expect(() => validateRefTargets([{ name: 'a', type: 'string', refTarget: 'x' }], new Set(), 'c')).not.toThrow()
  })

// ── the false positive this check nearly shipped with ────────────────────────────────
it('accepts the PLURAL directory form of a singular config name (the apps/velo case)', () => {
  // velo configures `location`; its schema correctly says `refTarget: "locations"`, because
  // refTarget names the generated DIRECTORY. Matching only the config key would have refused
  // a valid, shipping schema — and that is exactly why the generator's "unknown" fallback
  // appeared to work: every plural target missed the map and landed in the branch that
  // happens to emit the right path.
  const fields = [{ name: 'locationId', type: 'string', refTarget: 'locations' }]
  expect(() => validateRefTargets(fields, known('location', 'booking'), 'booking')).not.toThrow()
})

// ── the second false positive: refusing the one mechanism that works ─────────────────
it('accepts an EXTERNAL ref, which never resolves against the collection map', () => {
  // `refScope: "external"` routes the field away from the collection-directory import entirely —
  // database-queries.ts emits `import { user } from '~~/server/db/schema'` and an aliased join,
  // the same path the built-in owner/createdBy refs take. Checking it against the collection map
  // refused the ONLY working way to reference a person (the #1825 chores case).
  const fields = [
    { name: 'assigneeId', type: 'string', refTarget: 'users', refScope: 'external' },
    { name: 'lastDoneById', type: 'string', refTarget: 'users', refScope: 'external' },
  ]
  expect(() => validateRefTargets(fields, known('chores'), 'chores')).not.toThrow()
})

it('still refuses a person target when refScope is absent', () => {
  // The escape hatch is opt-in: without refScope the generator DOES try the collection path and
  // emits an unresolvable import, so this must stay a refusal.
  const fields = [{ name: 'assigneeId', type: 'string', refTarget: 'users' }]
  expect(() => validateRefTargets(fields, known('chores'), 'chores')).toThrow(RefTargetError)
})

it('does not let an external scope wave through a genuinely wrong collection target', () => {
  // `adapter`/`external` are about WHERE the table lives, so an external ref is exempt by design.
  // A LOCAL ref to a nonexistent collection must still be caught.
  const fields = [
    { name: 'roomId', type: 'string', refTarget: 'rooms', refScope: 'local' },
  ]
  expect(() => validateRefTargets(fields, known('chores'), 'chores')).toThrow(RefTargetError)
})
})
