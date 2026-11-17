// diagnosis-marker.mjs — the hidden marker on a fix-bot 🩺 Diagnosis comment (#3667).
//
// `<!-- diagnosis:v1 sha=<head sha> check=<url-encoded check name> round=<n> -->` — the check name is
// URI-encoded because e.g. `Deploy Apps (Cloudflare Workers)` has spaces. `round` (#3668) is the
// review round (1, or 2 after a rejected first diagnosis); a marker without it is round 1. The gate
// uses hasDiagnosis() to post at most one diagnosis per (sha, check); the workflow's check step uses
// it to notice an agent that posted none. Pure.

const RE = /<!--\s*diagnosis:v1\s+sha=(\S+)\s+check=(\S+?)(?:\s+round=(\d+))?\s*-->/

/** @param {{ sha:string, check:string, round?:number }} p */
export function diagnosisMarker({ sha, check, round }) {
  const r = round ? ` round=${Number(round)}` : ''
  return `<!-- diagnosis:v1 sha=${sha} check=${encodeURIComponent(String(check))}${r} -->`
}

/** @returns {{ sha:string, check:string, round:number } | null} */
export function parseDiagnosisMarker(body) {
  const m = RE.exec(String(body || ''))
  if (!m) return null
  let check
  try { check = decodeURIComponent(m[2]) } catch { return null }
  return { sha: m[1], check, round: m[3] ? Number(m[3]) : 1 }
}

/** True when some comment carries a diagnosis marker for exactly this sha AND check (AND round, when given). */
export function hasDiagnosis(comments = [], { sha, check, round }) {
  return comments.some(c => {
    const p = parseDiagnosisMarker(c?.body)
    return !!p && p.sha === sha && p.check === check && (!round || p.round === Number(round))
  })
}
