/**
 * #3996 — chats claim the tickets they drive; a guard stops other chats from starting or
 * reworking them.
 *
 * Every interactive chat posts as the same GitHub account, so nothing on a ticket said WHICH
 * chat drives it. On 2026-11-16 one chat's sweep started #3988 (a step another chat was running,
 * still waiting on #3980) and #3953 (waiting on #3952); both were undone by hand.
 *
 * This module is the pure half — no I/O, all unit-tested in scripts/claim.test.mjs:
 *   - a chat id is the first 6 hex chars of the Claude Code `session_id`;
 *   - a claim is a hidden marker comment on the issue; the newest claim/release wins;
 *   - a claim is void when the issue is closed or the chat said nothing there for 24 h;
 *   - the guard refuses `work-this`, removing `status:blocked`, and `**Worker:**` comments on a
 *     ticket another live chat claimed (directly or through its parent epic), and `work-this`
 *     on a ticket whose `Blocked-by:` issue is still open.
 * `scripts/claim.mjs` (CLI + GitHub lookups) and `.claude/hooks/require-unclaimed.mjs` gather the
 * facts and call these.
 *
 * `activeClaim` + STALE_MS are COPIED into pocs/status/server/utils/claim-core.ts (the Status
 * inbox's chat-claim badge, #4019 — its Worker cannot import scripts/). Keep in step;
 * pocs/status/tests/claim-core.test.ts checks the two agree.
 */

export const STALE_MS = 24 * 60 * 60 * 1000

/** `7c3f1a9e-…` → `7c3f1a`. Anything without 6 hex chars → ''. */
export function shortChatId(sessionId) {
  const hex = String(sessionId || '').toLowerCase().replace(/-/g, '')
  if (!/^[0-9a-f]{6}/.test(hex)) return ''
  return hex.slice(0, 6)
}

/** Minute-precision UTC stamp, e.g. 2026-11-16T22:35Z. */
export function sinceStamp(date = new Date()) {
  return new Date(date).toISOString().slice(0, 16) + 'Z'
}

/** `<!-- claim: chat=c7f3a1 name="products" since=2026-11-16T22:35Z -->` */
export function claimMarker({ chat, name, since }) {
  const parts = [`chat=${chat}`]
  if (name) parts.push(`name="${String(name).replace(/"/g, "'")}"`)
  parts.push(`since=${since || sinceStamp()}`)
  return `<!-- claim: ${parts.join(' ')} -->`
}

/** `<!-- claim-release: chat=c7f3a1 -->` */
export function releaseMarker(chat) {
  return `<!-- claim-release: chat=${chat} -->`
}

const CLAIM_RE = /<!--\s*claim:\s*chat=([0-9a-f]+)(?:\s+name="([^"]*)")?(?:\s+since=(\S+))?\s*-->/i
const RELEASE_RE = /<!--\s*claim-release:\s*chat=([0-9a-f]+)\s*-->/i

const timeOf = (c) => Date.parse(c.createdAt || c.created_at || '') || 0

/**
 * The live claim on ONE issue, or null.
 *   state    — 'open' | 'closed' (any case)
 *   comments — [{ body, createdAt }]
 *   now      — Date | ms (default: now)
 */
export function activeClaim({ state, comments = [], now = Date.now() } = {}) {
  if (String(state || '').toLowerCase() === 'closed') return null
  const sorted = [...comments].sort((a, b) => timeOf(a) - timeOf(b))
  let claim = null
  for (const c of sorted) {
    const body = String(c.body || '')
    const rel = body.match(RELEASE_RE)
    if (rel && claim && rel[1].toLowerCase() === claim.chat) { claim = null; continue }
    const m = body.match(CLAIM_RE)
    if (m) claim = { chat: m[1].toLowerCase(), name: m[2] || '', since: m[3] || '' }
  }
  if (!claim) return null
  // Stale: the claiming chat said nothing on this issue (marker or 🤖 header) for 24 h.
  const mention = new RegExp(`chat[= ]${claim.chat}\\b`, 'i')
  const last = sorted.filter(c => mention.test(String(c.body || ''))).map(timeOf).pop() || 0
  if (+new Date(now) - last > STALE_MS) return null
  return claim
}

// ── Detecting a guarded action in a tool call ────────────────────────────────────────────

// Each reader takes (s, i) and returns [text, nextIndex].

/** '…' — taken literally, no escapes. */
function readSingle(s, i) {
  const j = s.indexOf("'", i + 1)
  const end = j === -1 ? s.length : j
  return [s.slice(i + 1, end), end + 1]
}

/** "…" — a backslash escapes the next character. */
function readDouble(s, i) {
  let j = i + 1
  let buf = ''
  while (j < s.length && s[j] !== '"') {
    const esc = s[j] === '\\' && j + 1 < s.length
    buf += esc ? s[j + 1] : s[j]
    j += esc ? 2 : 1
  }
  return [buf, j + 1]
}

/** A bare character; `\x` is x, a backslash-newline is a line continuation (nothing). */
function readBare(s, i) {
  if (s[i] !== '\\' || i + 1 >= s.length) return [s[i], i + 1]
  return [s[i + 1] === '\n' ? '' : s[i + 1], i + 2]
}

const SEPARATORS = new Set(['\n', ';', '|', '&', '(', ')', '`'])
const QUOTE_READERS = { "'": readSingle, '"': readDouble }

/** Minimal shell tokenizer: words (quotes honoured) and separator tokens (; && || | newline ( ) `). */
export function shellTokens(cmd) {
  const s = String(cmd || '')
  const out = []
  let cur = null
  const flush = () => { if (cur !== null) out.push(cur); cur = null }
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (SEPARATORS.has(ch)) {
      flush()
      out.push({ sep: true })
      i += (ch === '|' || ch === '&') && s[i + 1] === ch ? 2 : 1
    } else if (/\s/.test(ch)) {
      flush()
      i++
    } else {
      const [text, next] = (QUOTE_READERS[ch] || readBare)(s, i)
      cur = (cur ?? '') + text
      i = next
    }
  }
  flush()
  return out
}

function segments(cmd) {
  const segs = [[]]
  for (const t of shellTokens(cmd)) {
    if (typeof t === 'object') segs.push([])
    else segs[segs.length - 1].push(t)
  }
  return segs.filter(s => s.length)
}

// Values of a flag: `--add-label a,b`, `--add-label=a`, repeated.
function flagValues(words, names) {
  const vals = []
  words.forEach((_, i) => names.forEach((n) => {
    const v = flagValueAt(words, i, n)
    if (v !== undefined) vals.push(v)
  }))
  return vals
}

/** The value one word gives a flag: `--x v` (next word), `--x=v`, or undefined. */
function flagValueAt(words, i, name) {
  const w = words[i]
  if (w === name) return i + 1 < words.length ? words[i + 1] : undefined
  return w.startsWith(name + '=') ? w.slice(name.length + 1) : undefined
}

const labelList = (vals) => vals.flatMap(v => v.split(',')).map(v => v.trim()).filter(Boolean)
const flagHasLabel = (words, flag, label) => labelList(flagValues(words, [flag])).includes(label)

/** `3988` / `#3988` / `https://github.com/o/r/issues/3988` → 3988. */
function numberOf(word) {
  const m = String(word || '').match(/^#?(\d+)$/) || String(word || '').match(/\/(?:issues|pull)\/(\d+)/)
  return m ? Number(m[1]) : null
}

function firstNumber(words) {
  return words.filter(w => !w.startsWith('-')).map(numberOf).find(Boolean) || null
}

/**
 * A guarded command whose ticket is not a literal number — `$n` in a loop, `{}` under xargs, or
 * no number at all (xargs appends it). The hook can't check claims or Blocked-by for a ticket it
 * can't see, so it refuses: a sweep must name each ticket (review of #4021).
 */
function unresolved(kind, words) {
  const target = words.find(w => /\$|\{\}/.test(w)) || '(no number)'
  return { kind, number: null, unresolved: target }
}

/** True when the body has a line starting `**Worker:**` (the 🤖 header comes first). */
export function hasWorkerLine(body) {
  return /^\s*\*\*Worker:\*\*/m.test(String(body || ''))
}

const decodeLabel = (s) => { try { return decodeURIComponent(s) } catch { return s } }

// `gh issue edit N --add-label …work-this…` / `--remove-label …status:blocked…`
function detectIssueEdit(rest) {
  const kind = flagHasLabel(rest, '--add-label', 'work-this') ? 'add-work-this'
    : flagHasLabel(rest, '--remove-label', 'status:blocked') ? 'unblock' : null
  if (!kind) return null
  const number = firstNumber(rest)
  return number ? { kind, number } : unresolved(kind, rest)
}

/** `gh pr|issue comment N --body "**Worker:** …"` or `--body-file f` (the hook reads f). */
function detectComment(rest) {
  const number = firstNumber(rest)
  const bodyFile = flagValues(rest, ['--body-file', '-F'])[0]
  const body = flagValues(rest, ['--body', '-b']).join('\n')
  if (!bodyFile && !hasWorkerLine(body)) return null
  if (!number) return { ...unresolved('worker-comment', rest), ...(bodyFile ? { bodyFile } : {}) }
  return { kind: 'worker-comment', number, needsPrMap: true, ...(bodyFile ? { bodyFile } : {}) }
}

/** `gh api …/issues/N/labels … work-this` and `gh api -X DELETE …/issues/N/labels/status:blocked`. */
function detectApi(all) {
  const path = all.find(w => /(?:^|\/)issues\/[^/\s]+\/labels/.test(w))
  if (!path) return null
  const num = path.match(/issues\/([^/\s]+)\/labels/)[1]
  const method = (flagValues(all, ['-X', '--method'])[0] || '').toUpperCase()
  let kind = null
  if (method === 'DELETE') {
    const tail = decodeLabel(path.split(/issues\/[^/\s]+\/labels\/?/)[1] || '')
    if (tail === 'status:blocked') kind = 'unblock'
  } else if (all.some(w => /(^|[=,\s"[])work-this($|[,\s"\]])/.test(w))) {
    kind = 'add-work-this'
  }
  if (!kind) return null
  return /^\d+$/.test(num) ? { kind, number: Number(num) } : unresolved(kind, [num])
}

const GH_DETECTORS = {
  'issue edit': (words) => detectIssueEdit(words.slice(3)),
  'issue comment': (words) => detectComment(words.slice(3)),
  'pr comment': (words) => detectComment(words.slice(3)),
}

// Words that can stand in front of the real command in a segment: loop/if keywords, grouping,
// `time`/`!`, wrappers (`env`, `command`, `exec`, `nohup`, `sudo`), and `VAR=value` prefixes.
const PREFIX_WORDS = new Set(['do', 'then', 'else', 'elif', 'while', 'until', 'if', 'time', '!', '{', '(', 'env', 'command', 'exec', 'nohup', 'sudo'])
const isAssignment = (w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)

/** `xargs [-I{} -n1 -P4 …] gh …` → the words from `gh` on; else null. */
function afterXargs(words) {
  if (words[0] !== 'xargs') return null
  const at = words.findIndex(w => w.split('/').pop() === 'gh')
  return at === -1 ? null : words.slice(at)
}

/** Strip prefixes so a segment like `do GH_REPO=o/r gh issue edit …` reads as `gh issue edit …`. */
function commandWords(words) {
  let w = words
  while (w.length && (PREFIX_WORDS.has(w[0]) || isAssignment(w[0]))) w = w.slice(1)
  const viaXargs = afterXargs(w)
  // Under xargs the ticket number is filled in at run time — refuse rather than guess.
  return viaXargs ? { words: viaXargs, xargs: true } : { words: w, xargs: false }
}

function detectGh(segment) {
  const { words, xargs } = commandWords(segment)
  // `bash -c "gh issue edit …"` / `sh -c '…'` — judge the inner command.
  if (['bash', 'sh', 'zsh'].includes(words[0]) && words[1] === '-c') return detectBashCommand(words[2])
  if (words[0]?.split('/').pop() !== 'gh') return null
  const detector = words[1] === 'api' ? (w) => detectApi(w.slice(2)) : GH_DETECTORS[`${words[1]} ${words[2]}`]
  const action = detector ? detector(words) : null
  return action && xargs && !action.unresolved ? { ...action, number: null, unresolved: 'xargs' } : action
}

const BASH_HINT = /work-this|status:blocked|status%3Ablocked|Worker:|--body-file|-F\b/i

function detectBashCommand(cmd) {
  if (!BASH_HINT.test(String(cmd || ''))) return null
  return segments(cmd).map(detectGh).find(Boolean) || null
}

function detectBash(input) {
  return detectBashCommand(input.command)
}

function detectIssueWrite(input) {
  if (input.method !== 'update' || !Array.isArray(input.labels)) return null
  const number = Number(input.issue_number)
  if (!number) return null
  const labels = input.labels.map(String)
  const kind = labels.includes('work-this') ? 'add-work-this' : 'unblock'
  return { kind, number, labelsAfter: labels }
}

function detectAddComment(input) {
  const number = Number(input.issue_number)
  if (!number || !hasWorkerLine(input.body)) return null
  return { kind: 'worker-comment', number, needsPrMap: true }
}

const TOOL_DETECTORS = {
  Bash: detectBash,
  mcp__github__issue_write: detectIssueWrite,
  mcp__github__add_issue_comment: detectAddComment,
}

/**
 * Which guarded action (if any) a tool call performs.
 * → { kind: 'add-work-this'|'unblock'|'worker-comment', number, needsPrMap?, bodyFile?, labelsAfter?, unresolved? } | null
 *
 * `unresolved` (number null) means the ticket isn't a literal number — `$n`, `{}`, xargs — and
 * `decideClaimGuard` refuses it without a lookup.
 *
 * `labelsAfter` (MCP issue_write) means "confirm against the issue's current labels" — see
 * `confirmLabelChange`. `bodyFile` means "confirm the file has a **Worker:** line".
 */
export function detectGuardedAction(toolName, toolInput = {}) {
  const detector = TOOL_DETECTORS[toolName]
  return detector ? detector(toolInput || {}) : null
}

/** For a label REPLACE (MCP update): did it really add work-this / drop status:blocked? */
export function confirmLabelChange(action, currentLabels = []) {
  if (!action.labelsAfter) return true
  const cur = currentLabels.map(l => (typeof l === 'string' ? l : l.name))
  if (action.kind === 'add-work-this') return !cur.includes('work-this')
  if (action.kind === 'unblock') return cur.includes('status:blocked') && !action.labelsAfter.includes('status:blocked')
  return true
}

/** The ticket a PR implements: its `Closes #N` line, else a `work-<n>` head branch. */
export function ticketFromPr({ body, headRefName } = {}) {
  const m = String(body || '').match(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i)
  if (m) return Number(m[1])
  const b = String(headRefName || '').match(/work-(\d+)/)
  return b ? Number(b[1]) : null
}

// ── The decision ─────────────────────────────────────────────────────────────────────────

const who = (c) => `${c.chat}${c.name ? ` (${c.name})` : ''}`

/**
 * action        — from detectGuardedAction (with `ticket` set when a PR was mapped)
 * myChat        — this chat's short id ('' when unknown)
 * claims        — [{ issue, claim }] from the ticket up its parent chain (nearest first)
 * openBlockers  — numbers from the ticket's `Blocked-by:` that are still open
 * → { allow, reason }
 */
export function decideClaimGuard({ action, myChat = '', claims = [], openBlockers = [] } = {}) {
  if (!action) return { allow: true, reason: '' }
  if (action.unresolved) {
    return { allow: false, reason: `Blocked: can't tell which ticket this targets (${action.unresolved}) — run one command per ticket with its number written out, so each is checked against claims and Blocked-by` }
  }
  const ticket = action.ticket ?? action.number
  if (action.kind === 'add-work-this' && openBlockers.length) {
    const list = openBlockers.map(n => `#${n}`).join(', ')
    return { allow: false, reason: `Blocked: #${ticket} waits on ${list} (open) — start it once that lands` }
  }
  const nearest = claims.find(c => c && c.claim)
  if (!nearest || (myChat && nearest.claim.chat === String(myChat).toLowerCase())) return { allow: true, reason: '' }
  const via = nearest.issue !== ticket ? ` via epic #${nearest.issue}` : ''
  return { allow: false, reason: `Blocked: #${ticket} is claimed by ${who(nearest.claim)}${via} — ask the owner` }
}

/** `claimed by c7f3a1 (products) via #3897 since …` | `unclaimed` */
export function describeClaim(ticket, claims = []) {
  const nearest = claims.find(c => c && c.claim)
  if (!nearest) return 'unclaimed'
  const via = nearest.issue !== ticket ? ` via #${nearest.issue}` : ''
  const since = nearest.claim.since ? ` since ${nearest.claim.since}` : ''
  return `claimed by ${who(nearest.claim)}${via}${since}`
}
