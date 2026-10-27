#!/usr/bin/env node
/**
 * Merge-conflict resolution for the revise worker (#2848, reverses the #2658 abort).
 *
 * work-issue-pidev.yml leaves a conflicted base merge IN PROGRESS and hands pi a resolution task.
 * This script owns the two ends of that: the task text (`prompt`) and the hard checks on the
 * result (`verify`) — the effect is asserted (no marker survives, generators are clean), not
 * trusted from an exit code.
 *
 *   node scripts/conflict-resolution.mjs prompt <base> <choice-file>   # task text for pi
 *   node scripts/conflict-resolution.mjs verify <choice-file>          # 0 resolved · 3 choice · 1 failed
 *
 * The generator list lives here, once; the workflow and the prompt both read it.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Files a generator produces are regenerated, never hand-merged. `inputs` + `outputs` are exact paths or prefixes. */
export const GENERATORS = [
  {
    name: 'gen-routing',
    touches: ['.claude/routing.json', 'writeups/architecture/routing-registry.md'],
    run: 'node scripts/gen-routing.mjs',
    check: 'node scripts/gen-routing.mjs --check',
  },
  {
    name: 'gen-skills-doc',
    touches: ['.claude/skills/', 'writeups/architecture/skills-and-triggers.html'],
    run: 'node scripts/gen-skills-doc.mjs',
    check: 'node scripts/gen-skills-doc.mjs --check',
  },
  {
    name: 'gen-package-catalog',
    touches: ['.claude/skills/task-decompose/package-catalog.md', 'packages/*/package.json'],
    run: 'node scripts/gen-package-catalog.mjs',
    check: 'node scripts/gen-package-catalog.mjs --check',
  },
  {
    name: 'lockfile',
    touches: ['pnpm-lock.yaml'],
    run: 'pnpm install --lockfile-only',
    check: null,
  },
]

const matches = (pattern, file) => {
  if (pattern.endsWith('/')) return file.startsWith(pattern)
  if (pattern.includes('*')) return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+')}$`).test(file)
  return file === pattern
}

/** Generators whose inputs or outputs appear among `files`. */
export function generatorsFor(files) {
  return GENERATORS.filter((g) => files.some((f) => g.touches.some((p) => matches(p, f))))
}

const MARKER = /^(<<<<<<<|=======|>>>>>>>)(\s|$)/m

/** Files (path → text) that still carry a conflict marker. */
export function withMarkers(contents) {
  return Object.keys(contents).filter((f) => MARKER.test(contents[f]))
}

/**
 * The verdict, from facts only: a choice file means pi found incompatible intents and stopped;
 * leftover markers mean the resolution is not one.
 */
export function verdict({ choiceText, markerFiles }) {
  if (choiceText && choiceText.trim()) return { status: 'choice' }
  if (markerFiles.length) return { status: 'failed', reason: `conflict markers remain in: ${markerFiles.join(', ')}` }
  return { status: 'resolved' }
}

export function buildPrompt({ base, files, choiceFile }) {
  const gens = GENERATORS.map((g) => `  - ${g.touches.join(', ')} → \`${g.run}\``).join('\n')
  return `RESOLVE THE MERGE CONFLICT. This PR's branch is behind \`${base}\`, and merging \`${base}\` in left conflicts in:
${files.map((f) => `- ${f}`).join('\n')}

The merge is IN PROGRESS in the working tree (do not run git merge --abort, git commit or git add — the workflow commits it). Edit the files so the result keeps BOTH sides' intent:
1. Never drop one side to make the conflict go away. Read \`git diff\` / \`git log ${base} -3 -- <file>\` for what each side meant, and the ticket for this PR.
2. A generated file is regenerated, not hand-merged: resolve its INPUT, then run the generator.
${gens}
3. If both sides change the SAME logic in incompatible ways (same lines, different intent), do NOT pick one. Write the choice to ${choiceFile} instead: name side A's intent and side B's intent in one line each, then your recommendation. Leave the files as they are. Making no file change and writing no choice is a FAILED run.
4. When every conflict is resolved, no \`<<<<<<<\`, \`=======\` or \`>>>>>>>\` line may remain in any file.
Run the touched tests (scripts/*.test.mjs via node --test, a touched package's tests) before you finish.`
}

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' })
const conflicted = () => sh('git', ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean)

function run(cmd) {
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit' })
  return r.status === 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, a, b] = process.argv.slice(2)
  if (mode === 'prompt') {
    process.stdout.write(buildPrompt({ base: a, files: conflicted(), choiceFile: b }) + '\n')
  } else if (mode === 'verify') {
    const choiceText = a && existsSync(a) ? readFileSync(a, 'utf8') : ''
    const changed = sh('git', ['diff', '--name-only', 'HEAD']).split('\n').filter(Boolean)
    const files = conflicted() // the files that clashed — generators/tests key off these, not the whole base diff
    const contents = Object.fromEntries([...new Set([...changed, ...files])].filter(existsSync).map((f) => [f, readFileSync(f, 'utf8')]))
    const v = verdict({ choiceText, markerFiles: withMarkers(contents) })
    if (v.status === 'choice') process.exit(3)
    if (v.status === 'failed') { console.error(`::error::${v.reason}`); process.exit(1) }
    sh('git', ['add', '-u']) // tracked only: never stage runner scratch files
    try { sh('git', ['diff', '--cached', '--check']) } catch (e) { console.error(`::error::git diff --check: ${e.stdout}`); process.exit(1) }
    for (const g of generatorsFor(files)) if (g.check && !run(g.check)) { console.error(`::error::${g.name} --check failed after resolution`); process.exit(1) }
    if (!run('node --test scripts/')) { console.error('::error::scripts tests fail after resolution'); process.exit(1) }
    const pkgs = [...new Set(files.map((f) => f.match(/^packages\/([^/]+)\//)?.[1]).filter(Boolean))]
    for (const p of pkgs) if (!run(`pnpm --filter "./packages/${p}" test --if-present`)) { console.error(`::error::${p} tests fail after resolution`); process.exit(1) }
    console.log(files.join('\n'))
  } else {
    console.error('usage: conflict-resolution.mjs prompt <base> <choice-file> | verify <choice-file>')
    process.exit(2)
  }
}
