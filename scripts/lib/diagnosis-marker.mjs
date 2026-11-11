// diagnosis-marker.mjs — the hidden marker on a fix-bot 🩺 Diagnosis comment (#3667).
//
// `<!-- diagnosis:v1 sha=<head sha> check=<url-encoded check name> -->` — the check name is
// URI-encoded because e.g. `Deploy Apps (Cloudflare Workers)` has spaces. The gate uses
// hasDiagnosis() to post at most one diagnosis per (sha, check); the workflow's check step uses it
// to notice an agent that posted none. Pure.

const RE = /<!--\s*diagnosis:v1\s+sha=(\S+)\s+check=(\S+)\s*-->/

/** @param {{ sha:string, check:string }} p */
export function diagnosisMarker({ sha, check }) {
  return `<!-- diagnosis:v1 sha=${sha} check=${encodeURIComponent(String(check))} -->`
}

/** @returns {{ sha:string, check:string } | null} */
export function parseDiagnosisMarker(body) {
  const m = RE.exec(String(body || ''))
  if (!m) return null
  let check
  try { check = decodeURIComponent(m[2]) } catch { return null }
  return { sha: m[1], check }
}

/** True when some comment carries a diagnosis marker for exactly this sha AND check. */
export function hasDiagnosis(comments = [], { sha, check }) {
  return comments.some(c => {
    const p = parseDiagnosisMarker(c?.body)
    return !!p && p.sha === sha && p.check === check
  })
}
