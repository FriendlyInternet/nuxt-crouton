/**
 * Distil a raw GitHub Actions job log into the tail worth quoting in the CI-failure comment (#2677).
 *
 * Strips the per-line timestamp and `##[group]`/`##[endgroup]` markers, then anchors on the LAST
 * `##[error]` line (the failing step's own output sits just above it) and takes up to `maxLines`
 * lines ending there. With no `##[error]` it falls back to the plain last lines. Both caps apply:
 * `maxBytes` trims from the top so the end of the log — the actual error — always survives.
 * In a long test log the last ##[error] is just the exit-code line; `failingLines` (below) finds the
 * real failing lines, which callers quote first as `Stopped at:` (#3666).
 */

/** ANSI escapes (real ESC or already rendered as `^[[` / bare residue, #2710) and the timestamp. */
export function cleanLine(l) {
  return String(l)
    .replace(/(?:\x1b|\^\[)\[[0-9;]*[A-Za-z]/g, '')
    .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, '')
}

/**
 * @param {string} text raw job log
 * @param {{ maxLines?: number, maxBytes?: number }} [opts]
 * @returns {{ text: string, truncated: boolean }} the tail (text '' for empty input); `truncated` is true
 *   when the caps dropped lines from the top of the anchored window
 */
export function logTail(text, { maxLines = 80, maxBytes = 4096 } = {}) {
  if (!text) return { text: '', truncated: false }
  const lines = String(text)
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(l => !/^##\[(group|endgroup)\]/.test(l))
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (!lines.length) return { text: '', truncated: false }

  let end = lines.length
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('##[error]')) { end = i + 1; break }
  }
  const start = Math.max(0, end - maxLines)
  const out = lines.slice(start, end)
  let truncated = start > 0

  while (out.length > 1 && Buffer.byteLength(out.join('\n')) > maxBytes) { out.shift(); truncated = true }
  let result = out.join('\n')
  if (Buffer.byteLength(result) > maxBytes) { result = result.slice(-maxBytes); truncated = true }
  return { text: result, truncated }
}

/**
 * Lines that look like a cause but are not one — skipped before the cause check (#3666).
 * Each entry has a test proving it matches its own evidence line, so a dead pattern fails CI.
 */
export const NOISE_LINES = [
  // #3632 deploy job 129411200782, raw lines 470/592: a crouton-core build warning, not the failure
  /error TS2742/,
  // #3632 typecheck job 129372284702, raw line 303: Volar plugin-path warning, not the failure
  /vue-router\/volar\/sfc-route-blocks.*ERR_PACKAGE_PATH_NOT_EXPORTED/,
]

/** The runner's own closing line — present in every failed job, never the cause. */
export const EXIT_LINE = /^##\[error\]Process completed with exit code \d+\.?\s*$/

const CAUSE_LINES = [
  /^\s*not ok \d+ - /,
  /^##\[error\]/,
  /error TS\d+/,
  /\bRollupError\b/,
  /✘ \[ERROR\]/,
  /ERR_PNPM_/,
]

/**
 * The first lines of a raw job log that name the actual failure, in log order (#3666).
 * Line numbers are raw 1-based log lines (group markers counted), matching the Actions log viewer.
 *
 * @param {string} raw raw job log
 * @param {{ max?: number }} [opts]
 * @returns {Array<{ line: number, text: string }>}
 */
export function failingLines(raw, { max = 3 } = {}) {
  if (!raw) return []
  const out = []
  const seen = new Set()
  const lines = String(raw).split(/\r?\n/)
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const text = cleanLine(lines[i])
    if (/^##\[(group|endgroup)\]/.test(text)) continue
    if (EXIT_LINE.test(text)) continue
    if (NOISE_LINES.some(re => re.test(text))) continue
    if (seen.has(text)) continue
    if (!CAUSE_LINES.some(re => re.test(text))) continue
    seen.add(text)
    out.push({ line: i + 1, text })
  }
  return out
}

/** The fenced `Stopped at:` block both comment renderers put first, or '' with no cause. */
export function stoppedAtBlock(lines) {
  if (!lines || !lines.length) return ''
  return 'Stopped at:\n```\n' + lines.map(l => `${l.line}: ${l.text}`).join('\n').replaceAll('```', "'''") + '\n```\n'
}
