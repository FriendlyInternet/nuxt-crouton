/**
 * Distil a raw GitHub Actions job log into the tail worth quoting in the CI-failure comment (#2677).
 *
 * Strips the per-line timestamp and `##[group]`/`##[endgroup]` markers, then anchors on the LAST
 * `##[error]` line (the failing step's own output sits just above it) and takes up to `maxLines`
 * lines ending there. With no `##[error]` it falls back to the plain last lines. Both caps apply:
 * `maxBytes` trims from the top so the end of the log — the actual error — always survives.
 *
 * @param {string} text raw job log
 * @param {{ maxLines?: number, maxBytes?: number }} [opts]
 * @returns {string} the tail, or '' for empty input
 */
export function logTail(text, { maxLines = 80, maxBytes = 4096 } = {}) {
  if (!text) return ''
  const lines = String(text)
    .split(/\r?\n/)
    .map(l => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ''))
    .filter(l => !/^##\[(group|endgroup)\]/.test(l))
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (!lines.length) return ''

  let end = lines.length
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('##[error]')) { end = i + 1; break }
  }
  let out = lines.slice(Math.max(0, end - maxLines), end)

  while (out.length > 1 && Buffer.byteLength(out.join('\n')) > maxBytes) out.shift()
  let result = out.join('\n')
  if (Buffer.byteLength(result) > maxBytes) result = result.slice(-maxBytes)
  return result
}
