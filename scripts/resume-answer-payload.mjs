#!/usr/bin/env node
// resume-answer-payload.mjs — WS5 of epic #1182 (#1191).
//
// When an agent blocks with a scannable handoff (the `ask-human` skill, #1189), the owner
// may answer *in the medium the question came in*: a top-level reply, an inline PR *review*
// comment on a schema `.md`, a `🎯 Preview feedback` comment from crouton-feedback, or an
// edited Excalidraw diagram. `resume-on-comment.yml` fires on the reply but, by default, the
// resuming agent only sees the top-level thread — so an in-medium answer is invisible to it.
//
// This gathers the answer from EVERY surface and prints a compact markdown payload the resume
// prompt injects, so the fresh session continues with the actual answer in context — not just
// the trigger. Deterministic, dependency-free (Node 22 fetch + the Actions token), and it
// NEVER throws: on any gap it degrades to a note so the resume still runs.
//
// Usage (from the workflow):  node scripts/resume-answer-payload.mjs <issue> > .resume-answer.md
//   env: GITHUB_TOKEN (or GH_TOKEN), GITHUB_REPOSITORY=owner/repo
//   arg: issue number (falls back to $ISSUE)

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const repo = process.env.GITHUB_REPOSITORY || 'FriendlyInternet/nuxt-crouton'
const [owner, name] = repo.split('/')
const issue = Number(process.argv[2] || process.env.ISSUE || 0)

const MAX = 1200 // clamp any single body so the injected payload can't blow the prompt budget
const clip = (s) => {
  const t = String(s || '').trim().replace(/\r/g, '')
  return t.length > MAX ? t.slice(0, MAX) + ' …[clipped]' : t
}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'resume-answer-payload',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}

// Emit the payload + exit 0 no matter what — a missing surface must not fail the resume.
function emit(lines) {
  process.stdout.write(['## Answer payload (collected this run)', '', ...lines, ''].join('\n'))
  process.exit(0)
}

if (!issue) emit(['_No issue number given — resume from the top-level thread only._'])
if (!token) emit(['_No token available — resume from the top-level thread only._'])

try {
  const out = []

  // (1) The latest human (non-bot) issue comment = the trigger / plain-text answer.
  const comments = await gh(`/repos/${owner}/${name}/issues/${issue}/comments?per_page=100`)
  const humanComments = comments.filter((c) => c.user && c.user.type !== 'Bot')
  const latest = humanComments[humanComments.length - 1]
  if (latest) {
    out.push(`**Latest reply — @${latest.user.login}:**`, '', `> ${clip(latest.body).replace(/\n/g, '\n> ')}`, '')
  }

  // Linked PRs (via the issue timeline cross-references) — where in-medium answers live.
  const timeline = await gh(`/repos/${owner}/${name}/issues/${issue}/timeline?per_page=100`)
  const prNums = [
    ...new Set(
      timeline
        .filter((e) => e.event === 'cross-referenced' && e.source?.issue?.pull_request)
        .map((e) => e.source.issue.number)
    ),
  ]

  let diagramEdited = ''
  for (const n of prNums) {
    // (2) Inline PR *review* comments (e.g. on a committed schema `.md`) — the resume agent
    // does NOT read these by default; surface path + line + body.
    let reviewComments = []
    try {
      reviewComments = await gh(`/repos/${owner}/${name}/pulls/${n}/comments?per_page=100`)
    } catch {}
    const humanReviews = reviewComments.filter((c) => c.user && c.user.type !== 'Bot')
    if (humanReviews.length) {
      out.push(`**PR #${n} — inline review comments:**`)
      for (const c of humanReviews.slice(-10)) {
        out.push(`- \`${c.path}${c.line ? ':' + c.line : ''}\` — ${clip(c.body)}`)
      }
      out.push('')
    }

    // (3) `🎯 Preview feedback` comments (crouton-feedback names the source file) — on the PR.
    let prComments = []
    try {
      prComments = await gh(`/repos/${owner}/${name}/issues/${n}/comments?per_page=100`)
    } catch {}
    const feedback = prComments.filter((c) => /🎯/.test(c.body || ''))
    if (feedback.length) {
      out.push(`**PR #${n} — 🎯 preview feedback:**`)
      for (const c of feedback.slice(-10)) out.push(`- ${clip(c.body)}`)
      out.push('')
    }

    // (4) Edited-diagram flag: an Excalidraw round-trip re-attaches a PNG / bumps the
    // `.graph.json`. Heuristic — if any surface references an excalidraw/diagram artifact,
    // tell the resume to decode it via ticket-excalidraw-import.
    const haystack = [...humanReviews, ...feedback].map((c) => c.body || '').join('\n')
    if (/excalidraw|\.graph\.json|ticket-diagram|edited the diagram/i.test(haystack)) {
      diagramEdited = `an Excalidraw diagram looks edited on PR #${n}`
    }
  }

  out.push(
    diagramEdited
      ? `**Edited diagram:** ${diagramEdited} — run \`node scripts/ticket-excalidraw-import.mjs <attached-png>\` to decode the scene before acting on it.`
      : `**Edited diagram:** none detected.`
  )

  if (out.length === 1) out.unshift('_No in-medium answer found beyond the top-level thread._', '')
  emit(out)
} catch (err) {
  emit([`_Could not fully collect the answer payload (${String(err.message || err)}); resume from the top-level thread._`])
}
