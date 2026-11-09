#!/usr/bin/env node
// #3208: where does a `work-this` issue go? An `epic` is split, not built.
// Usage: node scripts/epic-route.mjs "<comma-joined labels>"  → JSON {route, build, dispatch}
import { fileURLToPath } from 'node:url'

export function epicRoute(labels) {
  const list = Array.isArray(labels) ? labels : String(labels ?? '').split(',').map((l) => l.trim())
  if (list.includes('epic')) {
    return { route: 'splitter', build: false, dispatch: { workflow: 'decompose-on-issue-pidev.yml', harness: 'pi' } }
  }
  return { route: 'worker', build: true, dispatch: null }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(epicRoute(process.argv[2] ?? '')))
}
