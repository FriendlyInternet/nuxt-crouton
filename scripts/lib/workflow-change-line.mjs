// Ensures a PR that edits .github/workflows/** carries a `Workflow-change:` body line (#3469).
// Self-contained (node: imports only) — the finish step runs a copy from $RUNNER_TEMP.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LINE_RE = /^[ \t]*Workflow-change:/im

export function workflowFiles(files) {
  const out = []
  for (const f of files || []) {
    const p = String(f).trim()
    if (p.startsWith('.github/workflows/') && !out.includes(p)) out.push(p)
  }
  return out
}

export function ensureWorkflowChangeLine({ body, files, title, issue }) {
  const text = body || ''
  const workflows = workflowFiles(files)
  if (!workflows.length || LINE_RE.test(text)) return { body: text, added: false, workflows }
  const names = workflows.map(w => `\`${w.split('/').pop()}\``).join(', ')
  const t = String(title || '').replace(/\s*\(review feedback\)\s*$/, '').trim()
  const line = `Workflow-change: ${t} — edits ${names} (#${issue})`
  return { body: `${text.replace(/\s+$/, '')}\n\n${line}\n`, added: true, workflows }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

function main() {
  const pr = arg('pr')
  try {
    const j = JSON.parse(execFileSync('gh', ['pr', 'view', pr, '--json', 'body,files'], { encoding: 'utf8' }))
    const r = ensureWorkflowChangeLine({
      body: j.body, files: (j.files || []).map(f => f.path), title: arg('title'), issue: arg('issue'),
    })
    if (!r.added) {
      console.log(`workflow-change: unchanged (${r.workflows.length ? 'line present' : 'no workflow files'})`)
      return
    }
    const f = join(mkdtempSync(join(tmpdir(), 'wfc-')), 'body.md')
    writeFileSync(f, r.body)
    execFileSync('gh', ['pr', 'edit', pr, '--body-file', f], { stdio: 'inherit' })
    console.log(`workflow-change: added (${r.workflows.map(w => w.split('/').pop()).join(', ')})`)
  } catch (e) {
    console.log(`::warning::workflow-change line skipped: ${e.message}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
