// Pure scoring for the Ask-Claude answer set (#3169). No network.
const has = (text, needle) => text.toLowerCase().includes(String(needle).toLowerCase())

function collectKeys(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach(v => collectKeys(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.add(k); collectKeys(v, out) }
  }
  return out
}

/** Parse every ```json block in an answer; unparseable blocks are skipped. */
export function extractJsonBlocks(text) {
  const blocks = []
  for (const m of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) {
    try { blocks.push(JSON.parse(m[1])) } catch { /* not JSON */ }
  }
  return blocks
}

/** Commands used as `crouton <cmd>` inside code spans/fences of an answer. */
export function extractCliCommands(text) {
  const out = []
  for (const m of text.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)) {
    for (const c of m[0].matchAll(/(?:^|[\s`$])crouton(?:-generate)?\s+([a-z][\w-]*)/g)) out.push(c[1])
  }
  return out
}

function checkMentions(q, answer, failures) {
  for (const n of q.mustMention || []) if (!has(answer, n)) failures.push(`missing: ${n}`)
  for (const n of q.mustNotMention || []) if (has(answer, n)) failures.push(`forbidden: ${n}`)
}

function checkCliCommands(answer, ctx, failures) {
  if (ctx.cliCommands) {
    for (const c of new Set(extractCliCommands(answer))) {
      if (!ctx.cliCommands.includes(c)) failures.push(`unknown CLI command: crouton ${c}`)
    }
  }
}

function checkValidSchemas(q, blocks, ctx, failures) {
  const results = blocks.map(b => ctx.validateSchema({ schema: b }))
  const valid = blocks.filter((_, i) => results[i].valid)
  if (!valid.length) failures.push(`no valid schema in answer: ${results.flatMap(r => r.errors).join('; ')}`)
  const keys = new Set(valid.flatMap(b => [...collectKeys(b)]))
  for (const k of q.schemaForbiddenKeys || []) if (keys.has(k)) failures.push(`schema uses forbidden key: ${k}`)
}

function checkSchema(q, answer, ctx, failures) {
  if (q.kind === 'schema') {
    const blocks = extractJsonBlocks(answer).filter(b => b && typeof b === 'object' && !Array.isArray(b))
    if (!blocks.length) failures.push('no parseable JSON schema in answer')
    else if (typeof ctx.validateSchema !== 'function') failures.push('no schema validator supplied')
    else {
      checkValidSchemas(q, blocks, ctx, failures)
    }
  }
}

/**
 * @param ctx.validateSchema real validator (handleValidateSchema from crouton-mcp); required for kind:'schema'
 * @param ctx.cliCommands real CLI command names; when given, every `crouton <cmd>` in the answer must be one
 * @returns {{ id: string, pass: boolean, failures: string[] }}
 */
export function scoreAnswer(q, answer, ctx = {}) {
  const failures = []
  checkMentions(q, answer, failures)
  checkCliCommands(answer, ctx, failures)
  checkSchema(q, answer, ctx, failures)
  return { id: q.id, pass: failures.length === 0, failures }
}

export function summarize(results) {
  const passed = results.filter(r => r.pass).length
  return { passed, total: results.length, score: results.length ? passed / results.length : 0 }
}
