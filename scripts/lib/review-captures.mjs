// Review screenshots live on a NON-BRANCH ref (refs/review-captures/<key>) and are embedded in a
// tagged PR comment by commit-ID raw URL (#3351). They are never committed to the PR branch.
//
// One evidence rule for every check: visual evidence exists <=> the PR has a bot comment tagged
// `<!-- review-capture:<key> -->` that embeds at least one raw.githubusercontent.com image.

const KEY_RE = /^(pr|issue)\d+$/
const RAW_PREFIX = 'https://raw.githubusercontent.com/'

export function assertKey(key) {
  if (!KEY_RE.test(String(key))) throw new Error(`invalid capture key "${key}" (want pr<N> or issue<N>)`)
  return String(key)
}

export function captureRef(key) {
  return `refs/review-captures/${assertKey(key)}`
}

export function captureMarker(key) {
  return `<!-- review-capture:${assertKey(key)} -->`
}

export function rawImageUrl({ repo, sha, file }) {
  return `${RAW_PREFIX}${repo}/${sha}/${file}`
}

const surfaceOf = (file) => String(file).replace(/\.png$/i, '')

export function captureCommentBody({ key, repo, sha, files = [], artifactUrl, reasons }) {
  const marker = captureMarker(key)
  if (!files.length) {
    return `${marker}\n📷 no usable screenshot: ${reasons || 'none captured'}\n`
  }
  const lines = [marker, '📷 **Preview screenshot**', '']
  for (const f of files) lines.push(`![${surfaceOf(f)}](${rawImageUrl({ repo, sha, file: f })})`, '')
  const detail = []
  if (artifactUrl) detail.push(`Download: ${artifactUrl}`)
  if (reasons) detail.push(`Log: ${reasons}`)
  if (detail.length) lines.push('<details><summary>Details</summary>', '', ...detail, '', '</details>')
  return lines.join('\n') + '\n'
}

export function hasCaptureEvidence(comments = []) {
  return (comments || []).some((c) => {
    if (c?.user?.type !== 'Bot') return false
    const body = String(c.body || '')
    if (!body.includes('<!-- review-capture:')) return false
    const re = /!\[[^\]]*\]\(([^)\s]+)\)/g
    let m
    while ((m = re.exec(body))) if (m[1].startsWith(RAW_PREFIX)) return true
    return false
  })
}
