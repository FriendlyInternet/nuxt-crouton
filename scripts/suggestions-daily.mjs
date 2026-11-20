#!/usr/bin/env node
// suggestions-daily.mjs — the daily suggestions list (#4308, epic #4223 step 1). Run by
// .github/workflows/suggestions-daily.yml, which the pipeline review's daily run calls.
//
//   node scripts/suggestions-daily.mjs gather <dir>
//     Reads the log (`suggestions/` on pipeline-data, anonymous fetch) into <dir>/lines.json and,
//     when there are lines, writes <dir>/prompt.txt for the grouping model (which writes
//     <dir>/groups.json). An empty or missing log → lines.json = [], "log is empty", exit 0.
//     Appends `lines=<n>` to $GITHUB_OUTPUT when set.
//
//   node scripts/suggestions-daily.mjs post <dir> [--dry-run]
//     Ranks the ideas, decides post / clear / skip, and acts on the one standing issue
//     (label `suggestions:daily`). --dry-run prints the decision + comment and writes nothing.
//
// Decisions live in scripts/lib/suggestions-daily.mjs (pure, tested).
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateSuggestion } from './lib/suggestions.mjs'
import { buildGroupPrompt, parseGroups, rankIdeas, renderComment, decidePost } from './lib/suggestions-daily.mjs'

export const LABEL = 'suggestions:daily'
export const TITLE = "💡 Suggestions — today's three"
const ISSUE_BODY = [
  '> 🤖 **pi.dev harness** · agent pipeline (CI) · _daily suggestions_',
  '',
  'The standing issue for the daily suggestions list (epic #4223). Once a day, the pipeline review\'s daily run',
  'reads the suggestions log, groups the same idea, and posts the top three here as one comment, then marks this',
  'issue `status:blocked` so it shows as a card in the inbox. No comment on a day when the list is empty or unchanged.',
  '',
  'Replies here start nothing until promotion lands (the next step of #4223).',
].join('\n')

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts })

/** Every *.json file under `root`, as paths relative to `base`. */
function jsonFiles(root, base) {
  if (!existsSync(root)) return []
  const out = []
  for (const name of readdirSync(root)) {
    const p = join(root, name)
    if (statSync(p).isDirectory()) out.push(...jsonFiles(p, base))
    else if (name.endsWith('.json')) out.push(relative(base, p))
  }
  return out.sort()
}

/** Read + validate the extracted log under `dataDir`. Invalid files are skipped and named. */
export function readLines(dataDir, log = console.log) {
  const lines = []
  for (const id of jsonFiles(join(dataDir, 'suggestions'), dataDir)) {
    let parsed
    try { parsed = JSON.parse(readFileSync(join(dataDir, id), 'utf8')) } catch (e) { log(`skipped ${id}: not JSON (${e.message})`); continue }
    const res = validateSuggestion(parsed)
    if (!res.ok) { log(`skipped ${id}: ${res.errors.join('; ')}`); continue }
    lines.push({ ...res.line, id })
  }
  return lines
}

/** `cwd` = the repo to fetch in; `git` is injectable for tests. */
export function gather(dir, { cwd = process.cwd(), git = (args, opts = {}) => run('git', args, { cwd, ...opts }), env = process.env, log = console.log } = {}) {
  const out = resolve(dir)
  const data = join(out, 'data')
  mkdirSync(data, { recursive: true })
  git(['fetch', '--depth=1', 'origin', 'pipeline-data'])
  // `ls-tree` exits 0 with NO output when the folder is missing — read the output, not the exit code.
  const hasFolder = String(git(['ls-tree', '-d', '--name-only', 'FETCH_HEAD', 'suggestions']) || '').trim() !== ''
  let lines = []
  if (hasFolder) {
    const tar = git(['archive', '--format=tar', 'FETCH_HEAD', 'suggestions'], { encoding: 'buffer' })
    run('tar', ['-x', '-C', data], { input: tar, stdio: ['pipe', 'pipe', 'pipe'] })
    lines = readLines(data, log)
  }
  writeFileSync(join(out, 'lines.json'), JSON.stringify(lines, null, 2) + '\n')
  if (lines.length) {
    writeFileSync(join(out, 'prompt.txt'), buildGroupPrompt(lines, join(out, 'groups.json')))
    log(`read ${lines.length} line(s): ${lines.map((l) => l.id).join(', ')}`)
  } else {
    log('log is empty')
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `lines=${lines.length}\n`)
  return lines
}

const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return fallback } }
const readText = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }

/** Build today's ideas + the comment from <dir>. Pure apart from reading the two files. */
export function plan(dir, now = new Date()) {
  // No lines.json = gather never finished: fail loudly rather than clear the card as "nothing to show".
  if (!existsSync(join(dir, 'lines.json'))) throw new Error(`no ${join(dir, 'lines.json')} — the gather step did not finish`)
  const lines = readJson(join(dir, 'lines.json'), [])
  const text = readText(join(dir, 'groups.json'))
  const { groups, error } = parseGroups(text ?? '', lines)
  const top = rankIdeas(lines, groups, now)
  const date = now.toISOString().slice(0, 10)
  return { lines, top, date, grouped: !error || !lines.length, error }
}

const ghJson = (gh, args) => JSON.parse(gh(args) || 'null')

const tryGh = (gh, args) => { try { gh(args) } catch { /* already in that state */ } }

/** The open standing issue's number, or null. */
function findStanding(gh, repo) {
  const found = ghJson(gh, ['issue', 'list', '--repo', repo, '--label', LABEL, '--state', 'open', '--json', 'number', '--limit', '5'])
  return found?.[0]?.number ?? null
}

const readComments = (gh, repo, number) =>
  number ? ghJson(gh, ['api', '--paginate', '--slurp', `repos/${repo}/issues/${number}/comments`]).flat() : []

/** Create the standing issue once (and its label, if the repo lacks it). */
function createStanding(gh, repo, log) {
  tryGh(gh, ['label', 'create', LABEL, '--repo', repo, '--color', 'fbca04', '--description', 'The standing issue that shows the daily suggestions'])
  const url = gh(['issue', 'create', '--repo', repo, '--title', TITLE, '--label', LABEL, '--label', 'meta:agents', '--body', ISSUE_BODY]).trim()
  const number = Number(url.match(/(\d+)\s*$/)?.[1])
  if (!number) throw new Error(`could not read the new issue number from: ${url}`)
  log(`created the standing issue #${number}`)
  return number
}

/** Post the comment, then remove + add status:blocked (adding a label already there fires no event) and check it. */
function postList(gh, repo, number, body, log) {
  const n = String(number)
  gh(['issue', 'comment', n, '--repo', repo, '--body', body])
  tryGh(gh, ['issue', 'edit', n, '--repo', repo, '--remove-label', 'status:blocked'])
  gh(['issue', 'edit', n, '--repo', repo, '--add-label', 'status:blocked'])
  const labels = (ghJson(gh, ['issue', 'view', n, '--repo', repo, '--json', 'labels'])?.labels || []).map((l) => l.name)
  if (!labels.includes('status:blocked')) throw new Error(`status:blocked is not on #${number} after adding it`)
  log(`posted today's list on #${number} and marked it status:blocked`)
}

function dryRunNote(decision, body) {
  if (decision === 'clear') return 'nothing to show'
  return `--dry-run: would ${decision === 'post' ? 'post' : 'skip'}:\n${body}`
}

/** Carry out a non-dry-run decision. Returns the standing issue number afterwards. */
function act({ decision, gh, repo, number, body, date, log }) {
  if (decision === 'clear') {
    if (number) gh(['issue', 'edit', String(number), '--repo', repo, '--remove-label', 'status:blocked'])
    log('nothing to show')
    return number
  }
  if (decision === 'skip-duplicate') { log(`already posted today (${date})`); return number }
  if (decision === 'skip-unchanged') { log('unchanged since the last list'); return number }
  const n = number || createStanding(gh, repo, log)
  postList(gh, repo, n, body, log)
  return n
}

export function post(dir, { dryRun = false, gh = (args) => run('gh', args), now = new Date(), log = console.log, repo = process.env.GITHUB_REPOSITORY || 'FriendlyInternet/nuxt-crouton' } = {}) {
  const { top, date, grouped, error } = plan(resolve(dir), now)
  if (error) log(`grouping failed: ${error}`)
  const body = renderComment(top, { date, grouped, repo })
  const number = findStanding(gh, repo)
  const decision = decidePost({ top, comments: readComments(gh, repo, number), date })
  log(`decision: ${decision}${number ? ` (standing issue #${number})` : ' (no standing issue yet)'}`)
  if (dryRun) {
    log(dryRunNote(decision, body))
    return { decision, number, body }
  }
  return { decision, number: act({ decision, gh, repo, number, body, date, log }), body }
}

function main(argv = process.argv.slice(2)) {
  const [cmd, dir, ...rest] = argv
  if (!dir || !['gather', 'post'].includes(cmd)) {
    console.error('usage: suggestions-daily.mjs gather <dir> | post <dir> [--dry-run]')
    process.exit(1)
  }
  if (cmd === 'gather') gather(dir)
  else post(dir, { dryRun: rest.includes('--dry-run') })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main() } catch (e) { console.error(e.message); process.exit(1) }
}
