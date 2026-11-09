// Prints `v1` or nothing for a new epic branch (#3462). Usage: node scripts/epic-version.mjs <issue>
// Env: REPO, PIPELINE_DEFAULT. When v1 comes from the default, stamps the pipeline:v1 label. Never fails.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { chooseEpicVersion } from './lib/pipeline-version.mjs'

const gh = (args) => execFileSync('gh', [...args, ...(process.env.REPO ? ['--repo', process.env.REPO] : [])], { encoding: 'utf8' })

function main(issue) {
  try {
    const labels = gh(['issue', 'view', issue, '--json', 'labels', '-q', '.labels[].name']).split('\n').filter(Boolean)
    const version = chooseEpicVersion({ labels, defaultVersion: process.env.PIPELINE_DEFAULT })
    if (version === 'v1' && !labels.includes('pipeline:v1')) {
      try { gh(['issue', 'edit', issue, '--add-label', 'pipeline:v1']) } catch {}
    }
    if (version) console.log(version)
  } catch {}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv[2])
