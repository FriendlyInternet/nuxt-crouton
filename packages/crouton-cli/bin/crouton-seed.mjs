#!/usr/bin/env node
/**
 * `crouton-seed` — fill an app's D1 with the demo data its packages ship.
 *
 * Mirrors the `db:migrate` local/remote split:
 *   crouton-seed --db fanfare-db            # local
 *   crouton-seed --db fanfare-db --remote   # remote (Cloudflare D1)
 *
 * Run from the app directory (or pass --dir). Idempotent — re-running upserts
 * in place and never inserts duplicates.
 */
import { createJiti } from 'jiti'
import { defineCommand, runMain } from 'citty'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const jiti = createJiti(import.meta.url, { interopDefault: true })

const main = defineCommand({
  meta: {
    name: 'crouton-seed',
    description: 'Seed an app database from its packages\' seed providers'
  },
  args: {
    db: {
      type: 'string',
      description: 'D1 database name/binding (e.g. fanfare-db)',
      required: true
    },
    remote: {
      type: 'boolean',
      description: 'Target the remote D1 (default: local)',
      default: false
    },
    dir: {
      type: 'string',
      description: 'App directory (default: current directory)'
    },
    team: {
      type: 'string',
      description: 'Team slug to seed',
      default: 'test1'
    },
    locale: {
      type: 'string',
      description: 'Locale for demo content (default: the app\'s crouton.config defaultLocale, else en)'
    },
    'dry-run': {
      type: 'boolean',
      description: 'Print the SQL instead of executing it',
      default: false
    }
  },
  async run({ args }) {
    const { seedApp } = await jiti.import(join(__dirname, '..', 'lib', 'seed-app.ts'))
    await seedApp({
      db: args.db,
      remote: args.remote,
      dir: args.dir,
      team: args.team,
      locale: args.locale,
      dryRun: args['dry-run']
    })
  }
})

runMain(main)
