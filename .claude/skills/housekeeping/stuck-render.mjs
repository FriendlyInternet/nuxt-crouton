// Pure renderer for the two stuck-PR sections (#3317). Returns [heading, lines[]] pairs;
// empty input yields no sections. Imported by render.mjs.
const link = (n, t, url) => `[#${n}](${url}) — ${t}`

export function renderStuckSections(data) {
  const out = []
  if (data.epicPrsNoCi?.length) {
    out.push([
      '🚧 Epic PRs with no CI',
      [
        'Open `epic/*` → `main` PRs with no `CI Gate` check-run on the head commit:',
        ...data.epicPrsNoCi.map((p) => `- ${link(p.number, p.title, p.url)} — ${p.ageDays}d old, no CI Gate run — resume or close?`)
      ]
    ])
  }
  if (data.okedPrsConflicting?.length) {
    out.push([
      '⚔️ Approved but conflicting',
      [
        'Open PRs the owner approved (`ok`) that now have merge conflicts, so they can never merge:',
        ...data.okedPrsConflicting.map((p) => `- ${link(p.number, p.title, p.url)} — ok given ${p.okAgeDays}d ago, now conflicting — resume or close?`)
      ]
    ])
  }
  if (data.staleWorkThis === null) {
    out.push(['🪦 Forgotten work-this labels', ['_Run data unavailable this run — skipped._']])
  } else if (data.staleWorkThis?.length) {
    const age = (h) => (h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`)
    out.push([
      '🪦 Forgotten work-this labels',
      [
        'Open tickets carrying `work-this` for over an hour with no open `work-<n>` PR and no worker run in the last hour, so nothing is building them. Re-run with `gh workflow run work-issue-pidev.yml -f issue=<N>` (add `-f mode=plan` for a plan-first ticket), or remove the label if the work is done. Don\'t remove and re-add the label to re-run it (#2990).',
        ...data.staleWorkThis.map(
          (i) =>
            `- ${link(i.number, i.title, i.url)} — \`work-this\` for ${age(i.labelAgeHours)}, no worker run in the last hour` +
            (i.inProgress ? ' · ⛔ also `status:in-progress` — traffic control counts this as live' : '')
        )
      ]
    ])
  }
  return out
}
