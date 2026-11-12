// diagram-branch.mjs — save a design-hold diagram scene to the fixed `diagrams` branch (#3690), so
// the ✏️ Edit link in the hold comment opens a scene the editor can load AND save back.
//
// REST only (`gh api`, #2708) through an injected `exec('gh', [...args])` — array args, no shell.
// The write is the contents-API GET-sha-then-PUT the editor itself uses for its saves: a normal
// commit on top of the branch, never a force-push. Re-holds overwrite the same path.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DIAGRAM_BRANCH, DIAGRAM_SLUG_RE, isRefusedBranch } from './diagram-edit-link.mjs'

const errText = e => `${e?.message || ''}\n${e?.stderr || ''}`
const isStatus = (e, code, word) => new RegExp(`\\b${code}\\b${word ? `|${word}` : ''}`, 'i').test(errText(e))
const is404 = e => isStatus(e, 404, 'Not Found')

function ensureBranch(exec, repo, branch) {
  try {
    exec('gh', ['api', `repos/${repo}/git/ref/heads/${branch}`, '-q', '.object.sha'])
    return
  } catch (e) {
    if (!is404(e)) throw e
  }
  const def = exec('gh', ['api', `repos/${repo}`, '-q', '.default_branch'])
  const sha = exec('gh', ['api', `repos/${repo}/git/ref/heads/${def}`, '-q', '.object.sha'])
  try {
    exec('gh', ['api', '--method', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${sha}`])
  } catch (e) {
    // A parallel hold created it first — the branch exists, which is all we need.
    if (!(isStatus(e, 422) && /already exists/i.test(errText(e)))) throw e
  }
}

function fileSha(exec, repo, path, branch) {
  try {
    return exec('gh', ['api', `repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, '-q', '.sha']) || undefined
  } catch (e) {
    if (is404(e)) return undefined
    throw e
  }
}

/**
 * Commit `file` to `writeups/diagrams/<slug>.excalidraw` on `branch` (default `diagrams`), creating
 * the branch from the default branch when missing. Throws before any call for `main`/empty branch
 * or a slug the editor would reject. Returns { branch, path }.
 */
export function saveDiagramScene({ exec, repo, slug, file, issue, tmpDir, branch = DIAGRAM_BRANCH }) {
  if (isRefusedBranch(branch)) throw new Error(`refusing to save a diagram to branch '${branch}'`)
  if (typeof slug !== 'string' || !DIAGRAM_SLUG_RE.test(slug)) throw new Error(`bad diagram slug '${slug}'`)
  branch = String(branch).trim()
  const path = `writeups/diagrams/${slug}.excalidraw`
  ensureBranch(exec, repo, branch)
  const content = readFileSync(file).toString('base64')
  const bodyFile = join(tmpDir, `diagram-put-${slug}.json`)
  const put = sha => {
    const body = { message: `docs(root): diagram scene ${slug} for #${issue} (#3690)`, content, branch }
    if (sha) body.sha = sha
    // --input, not -f content=…: a big scene can pass the 128 KB single-argument limit.
    writeFileSync(bodyFile, JSON.stringify(body))
    exec('gh', ['api', '--method', 'PUT', `repos/${repo}/contents/${path}`, '--input', bodyFile])
  }
  try {
    put(fileSha(exec, repo, path, branch))
  } catch (e) {
    if (!isStatus(e, 409)) throw e
    // The file changed underneath us — re-read its sha once and retry once.
    put(fileSha(exec, repo, path, branch))
  }
  return { branch, path }
}
