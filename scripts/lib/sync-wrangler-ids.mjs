/**
 * sync-wrangler-ids.mjs — shared implementation behind each app's
 * `scripts/sync-wrangler-ids.mjs` shim (#1238). Apps scaffolded OUTSIDE this
 * monorepo get the full self-contained copy from
 * packages/crouton-cli/lib/templates/wrangler/sync-wrangler-ids.mjs — keep the
 * two in sync when the logic changes.
 *
 * Wrangler 4.45+ AUTO-PROVISIONS id-less D1/KV bindings on the first deploy, but
 * remote `d1 migrations apply` reads the SOURCE `wrangler.jsonc` and needs the real
 * `database_id` committed there (workers-sdk#13632). The manual dance was:
 *   deploy → `wrangler d1 list` → copy uuid → hand-edit wrangler.jsonc → migrate.
 *
 * This script does that copy step automatically. It:
 *   1. queries `wrangler d1 list --json` + `wrangler kv namespace list`,
 *   2. matches each binding in wrangler.jsonc to a provisioned resource BY NAME
 *      (D1 by `database_name`; KV by a derived title convention),
 *   3. writes the resolved ids back into the SOURCE wrangler.jsonc — top-level AND
 *      every `env.*` scope — preserving the file's comments and formatting.
 *
 * Idempotent: re-running with the same provisioned resources is a no-op. Safe to
 * chain into `cf:deploy` / `cf:staging` (run AFTER the first provisioning deploy).
 *
 * Matching conventions
 *   D1 : `database_name` is explicit in config → exact match against `d1 list`.
 *   KV : a `kv_namespaces` entry has NO name/title field — only binding/id/preview_id
 *        (workers-sdk#4248), so the title can't be set declaratively. Wrangler
 *        auto-provisions it with a DETERMINISTIC title: `<worker-name>-<binding>`.
 *        Worker name = `<name>` for the top-level scope and `<name>-<env>` for an
 *        `env.<env>` scope (wrangler's `--env` suffixing). So we reconstruct that
 *        exact title and match it (case-insensitively) against `kv namespace list`.
 *        Candidates tried, in order:
 *          `<workerName>-<binding>`            e.g. myapp-staging-KV  (the rule)
 *          `<workerName>-<binding lowercased>` e.g. myapp-staging-kv  (safety net)
 *        If none match, the available titles are logged and the binding is left
 *        untouched (never guesses, never breaks the file).
 *
 * Local testing without Cloudflare egress (used to verify the rewrite logic):
 *   SYNC_D1_LIST_JSON / SYNC_KV_LIST_JSON env vars inject list output, bypassing
 *   the `wrangler` shell-outs. Each is the raw JSON `wrangler …` would print.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

/** Minimal JSONC → JSON (strips // and block comments + trailing commas, keeps strings). */
function parseJsonc(text) {
  const noComments = text.replace(
    /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (_m, str) => str ?? ''
  )
  return JSON.parse(noComments.replace(/,(\s*[}\]])/g, '$1'))
}

/**
 * Run a wrangler subcommand and parse its JSON output. Pass the FULL arg list —
 * note the two list commands differ: `d1 list` needs an explicit `--json` flag,
 * but `kv namespace list` already emits a JSON array and REJECTS `--json`.
 */
function wranglerJson(appDir, args, injectEnvVar) {
  const injected = process.env[injectEnvVar]
  const raw = injected !== undefined
    ? injected
    : execFileSync('npx', ['wrangler', ...args], {
        cwd: appDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      })
  // Be defensive: slice from the first JSON bracket in case anything leaks to stdout.
  const start = raw.search(/[[{]/)
  if (start === -1) throw new Error(`no JSON in \`wrangler ${args.join(' ')}\` output`)
  return JSON.parse(raw.slice(start))
}

/**
 * Find the span [start, end) of the value (an array `[...]` or object `{...}`)
 * that follows `"key":` at or after `from`, within `[from, until)`. Skips matches
 * that aren't a real key (must be followed by `:` then a bracket). Bracket-aware
 * and string-aware so nested brackets / brackets-in-strings don't confuse it.
 * Returns null if not found.
 */
// fallow-ignore-next-line complexity — moved verbatim from the per-app copies (#1238); inherent scanner complexity, flagged only because the path is new
function findValueSpan(text, key, from, until) {
  const needle = `"${key}"`
  let i = text.indexOf(needle, from)
  while (i !== -1 && i < until) {
    let j = i + needle.length
    while (j < until && /\s/.test(text[j])) j++
    if (text[j] === ':') {
      j++
      while (j < until && /\s/.test(text[j])) j++
      const open = text[j]
      if (open === '[' || open === '{') {
        const close = open === '[' ? ']' : '}'
        let depth = 0
        let inStr = false
        for (let k = j; k < until; k++) {
          const c = text[k]
          if (inStr) {
            if (c === '\\') k++
            else if (c === '"') inStr = false
          } else if (c === '"') inStr = true
          else if (c === open) depth++
          else if (c === close) {
            depth--
            if (depth === 0) return { start: j, end: k + 1, valueStart: j }
          }
        }
      }
    }
    i = text.indexOf(needle, i + needle.length)
  }
  return null
}

/** Column (indentation) of the line containing index `pos`. */
function indentOf(text, pos) {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  const m = text.slice(lineStart).match(/^[ \t]*/)
  return m ? m[0] : ''
}

/** Serialize an array/object indented to sit at `indent`, JSON (no comments). */
function serializeIndented(value, indent) {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, idx) => (idx === 0 ? line : indent + line))
    .join('\n')
}

// fallow-ignore-next-line complexity — moved verbatim from the per-app copies (#1238); flagged only because the path is new
export function syncWranglerIds(appDir, { dryRun = process.argv.includes('--dry-run') } = {}) {
  const sourcePath = join(appDir, 'wrangler.jsonc')

  if (!existsSync(sourcePath)) {
    console.error(`[sync-wrangler-ids] ${sourcePath} not found.`)
    process.exit(1)
  }

  const rawText = readFileSync(sourcePath, 'utf8')
  const config = parseJsonc(rawText)
  const appName = config.name
  if (!appName) {
    console.error('[sync-wrangler-ids] wrangler.jsonc has no top-level "name".')
    process.exit(1)
  }

  const d1List = wranglerJson(appDir, ['d1', 'list', '--json'], 'SYNC_D1_LIST_JSON')
  const kvList = wranglerJson(appDir, ['kv', 'namespace', 'list'], 'SYNC_KV_LIST_JSON')

  // Scopes in document order: top-level first, then each env.* in declared order.
  // (JS preserves object key insertion order, which mirrors source order, so the
  //  arrays we find by scanning the raw text line up with these scopes 1:1.)
  const scopes = [{ workerName: appName, cfg: config }]
  for (const envName of Object.keys(config.env || {})) {
    scopes.push({ workerName: `${appName}-${envName}`, cfg: config.env[envName], envName })
  }

  // --- Resolve ids per scope -------------------------------------------------
  const changes = []

  // Each resolver returns { array, changed }. `changed` stays false when every id
  // already matches, so the surgical pass leaves that array's text (and its exact
  // formatting/comments) untouched — true idempotency.
  function resolveD1(scope) {
    const arr = scope.cfg.d1_databases
    if (!Array.isArray(arr) || arr.length === 0) return null
    let changed = false
    // fallow-ignore-next-line complexity — moved verbatim from the per-app copies (#1238)
    const array = arr.map((block) => {
      const name = block.database_name
      const match = name && d1List.find((d) => d.name === name)
      const id = match ? (match.uuid || match.id) : undefined
      if (!name) {
        console.warn(`[sync-wrangler-ids] (${scope.workerName}) D1 binding "${block.binding}" has no database_name — skipped.`)
        return block
      }
      if (!id) {
        console.warn(`[sync-wrangler-ids] (${scope.workerName}) no provisioned D1 named "${name}". Available: ${d1List.map((d) => d.name).join(', ') || '(none)'}`)
        return block
      }
      if (block.database_id !== id) {
        changes.push(`${scope.workerName}: D1 ${name} → ${id}`)
        changed = true
      }
      return { ...block, database_id: id }
    })
    return { array, changed }
  }

  function resolveKV(scope) {
    const arr = scope.cfg.kv_namespaces
    if (!Array.isArray(arr) || arr.length === 0) return null
    let changed = false
    const array = arr.map((block) => {
      const binding = block.binding
      const candidates = [`${scope.workerName}-${binding}`, `${scope.workerName}-${binding.toLowerCase()}`]
      const match = kvList.find((ns) => candidates.some((c) => c.toLowerCase() === String(ns.title).toLowerCase()))
      if (!match) {
        console.warn(`[sync-wrangler-ids] (${scope.workerName}) no KV namespace matching ${candidates.map((c) => `"${c}"`).join(' / ')}. Available titles: ${kvList.map((n) => n.title).join(', ') || '(none)'}`)
        return block
      }
      if (block.id !== match.id) {
        changes.push(`${scope.workerName}: KV ${match.title} → ${match.id}`)
        changed = true
      }
      return { ...block, id: match.id }
    })
    return { array, changed }
  }

  // --- Apply surgically into the raw text, scope by scope, in source order ----
  // For each array key we walk left-to-right: the Nth `"d1_databases": [...]` in
  // the text belongs to the Nth scope that declares one. Same for kv_namespaces.
  let out = rawText
  // fallow-ignore-next-line complexity — moved verbatim from the per-app copies (#1238)
  function applyArrays(key, resolver) {
    const cursors = { pos: 0 }
    for (const scope of scopes) {
      const resolved = resolver(scope)
      if (!resolved) continue
      const span = findValueSpan(out, key, cursors.pos, out.length)
      if (!span) {
        console.warn(`[sync-wrangler-ids] could not locate "${key}" array for scope ${scope.workerName} in source text — skipped.`)
        continue
      }
      if (!resolved.changed) {
        // ids already correct — leave the original text (and its formatting) alone.
        cursors.pos = span.end
        continue
      }
      const indent = indentOf(out, span.valueStart)
      const replacement = serializeIndented(resolved.array, indent)
      out = out.slice(0, span.start) + replacement + out.slice(span.end)
      // advance past the (possibly length-changed) replacement
      cursors.pos = span.start + replacement.length
    }
  }

  applyArrays('d1_databases', resolveD1)
  applyArrays('kv_namespaces', resolveKV)

  if (out === rawText) {
    console.log('[sync-wrangler-ids] all ids already in sync — no changes.')
    return
  }

  if (dryRun) {
    console.log('[sync-wrangler-ids] --dry-run, intended changes:')
    for (const c of changes) console.log(`  • ${c}`)
    return
  }

  writeFileSync(sourcePath, out)
  console.log('[sync-wrangler-ids] updated wrangler.jsonc:')
  for (const c of changes) console.log(`  • ${c}`)
}
