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
  return out
}
