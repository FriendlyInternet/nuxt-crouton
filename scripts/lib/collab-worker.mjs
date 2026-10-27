/**
 * Pure helpers for scripts/deploy-collab-worker.mjs (#2693) — kept side-effect free so they
 * are unit-testable without wrangler.
 */
import { createHash } from 'node:crypto'

/** Collab Worker name per target: prod `<app>-collab`, PR preview `<app>-pr<N>-collab`, else staging. */
export function collabWorkerName({ app, environment, pr }) {
  if (environment === 'production') return `${app}-collab`
  if (pr) return `${app}-pr${pr}-collab`
  return `${app}-collab-staging`
}

/**
 * The dedicated token secret, derived (not stored) so app and Worker get the SAME value on every
 * deploy — wrangler secrets can't be read back. Same pattern as the review-login password.
 * `scope` is the environment, or `pr<N>` for a preview.
 */
export function deriveCollabSecret({ seed, app, scope }) {
  if (!seed) throw new Error('deriveCollabSecret: seed secret is empty')
  return createHash('sha256').update(`${seed}:${app}:${scope}:collab`).digest('hex')
}

/** Id-less wrangler config for deploying the template in place (D1 auto-provisions). */
export function buildCollabConfig({ name, db, main }) {
  return {
    name,
    main,
    compatibility_date: '2024-09-02',
    compatibility_flags: ['nodejs_compat'],
    d1_databases: [{ binding: 'DB', database_name: db }],
    durable_objects: { bindings: [{ name: 'COLLAB_ROOMS', class_name: 'CollabRoom' }] },
    migrations: [{ tag: 'collab-v1', new_classes: ['CollabRoom'] }],
  }
}

/** The workers.dev URL from `wrangler deploy` output, or throws — never a silent no-op. */
export function extractWorkerUrl(output, name) {
  const url = String(output).match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0]
  if (!url) {
    throw new Error(`Collab Worker ${name} deployed but no workers.dev URL was printed — the app could not be pointed at it.`)
  }
  return url
}
