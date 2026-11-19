#!/usr/bin/env node
/**
 * CLI: apply migrations to a per-PR preview database, emptying it first when its recorded
 * migrations no longer match the PR's migration files (#4004). See
 * scripts/lib/pr-preview-migrate.mjs for the rule.
 *
 *   node scripts/pr-preview-migrate.mjs <app> <pr> <built-wrangler.json>
 *
 * cwd must be the app dir, so `wrangler` resolves the same account the deploy used.
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { queryD1Json, runWrangler } from './lib/wrangler-d1.mjs'
import { migrate } from './lib/pr-preview-migrate.mjs'

const [app, pr, configPath] = process.argv.slice(2)
if (!app || !pr || !configPath) {
  console.error('usage: pr-preview-migrate.mjs <app> <pr> <built-wrangler.json>')
  process.exit(1)
}
if (!existsSync(configPath)) {
  console.error(`pr-preview-migrate: ${configPath} not found — run the build + deploy first.`)
  process.exit(1)
}

const config = JSON.parse(readFileSync(configPath, 'utf8'))

process.exit(await migrate({
  app,
  pr,
  config,
  listFiles: dir => existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.sql')).map(e => e.name)
    : [],
  query: (name, sql) => queryD1Json(name, sql, { config: configPath }),
  exec: (name, sql) => {
    const tmp = join(tmpdir(), `pr-preview-drop-${name}-${Date.now()}.sql`)
    writeFileSync(tmp, sql)
    try {
      runWrangler(['d1', 'execute', name, '--remote', '--config', configPath, '--file', tmp])
    } finally {
      rmSync(tmp, { force: true })
    }
  },
  apply: name => spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', name, '--config', configPath, '--remote'], { stdio: 'inherit' }).status ?? 1
}))
